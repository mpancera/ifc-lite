/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A uniform grid over segments. Every segment is filed under each cell its
 * bounding box touches; a query walks the cells of a box (or the cells
 * around a point) and returns the ids found there, each once.
 *
 * This is what turns the room finder from cubic to near-linear on a real
 * drawing: a floor plan has thousands of short strokes, and each one only
 * ever meets its few neighbours. Nothing here is clever; the cell size is
 * the whole tuning knob and {@link cellSizeFor} picks it from the extent.
 */

import type { Point2 } from '../types.js';

export interface SegmentLike {
  a: Point2;
  b: Point2;
  /**
   * What the stroke stands for: a wall, or a divider that separates two
   * spaces without a wall (an open-plan boundary). Unknown means wall.
   */
  kind?: 'wall' | 'divider';
}

export class SegmentGrid {
  private readonly cells = new Map<string, number[]>();
  private readonly segs: SegmentLike[];
  readonly cellSize: number;
  private stamp = 0;
  private readonly seen: Int32Array;

  constructor(segs: SegmentLike[], cellSize: number) {
    this.segs = segs;
    this.cellSize = Math.max(cellSize, 1e-9);
    this.seen = new Int32Array(segs.length).fill(-1);
    for (let i = 0; i < segs.length; i++) this.insert(i);
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private insert(i: number): void {
    const s = this.segs[i];
    const x0 = Math.floor(Math.min(s.a.x, s.b.x) / this.cellSize);
    const x1 = Math.floor(Math.max(s.a.x, s.b.x) / this.cellSize);
    const y0 = Math.floor(Math.min(s.a.y, s.b.y) / this.cellSize);
    const y1 = Math.floor(Math.max(s.a.y, s.b.y) / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(i);
        else this.cells.set(k, [i]);
      }
    }
  }

  /** Ids of segments whose bounding box may touch the box, each once. */
  queryBox(minX: number, minY: number, maxX: number, maxY: number, out: number[] = []): number[] {
    const stamp = ++this.stamp;
    const x0 = Math.floor(minX / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const y0 = Math.floor(minY / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const i of bucket) {
          if (this.seen[i] === stamp) continue;
          this.seen[i] = stamp;
          out.push(i);
        }
      }
    }
    return out;
  }

  /** Ids of segments near a point, within `radius`. */
  queryPoint(p: Point2, radius: number, out: number[] = []): number[] {
    return this.queryBox(p.x - radius, p.y - radius, p.x + radius, p.y + radius, out);
  }
}

/**
 * A cell size for a drawing: about a hundred cells across the longer side,
 * but never smaller than the snap tolerance times ten, so a query around a
 * point stays a handful of cells.
 */
export function cellSizeFor(segs: readonly SegmentLike[], snap: number): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segs) {
    for (const p of [s.a, s.b]) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY, 1e-6);
  return Math.max(extent / 128, snap * 10);
}
