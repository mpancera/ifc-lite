/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { findEnclosedAreas } from './enclosed-areas.js';
import { SegmentGrid, cellSizeFor } from './spatial-hash.js';
import type { SegmentLike } from './spatial-hash.js';

const seg = (x1: number, y1: number, x2: number, y2: number): SegmentLike => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

/** A grid of n×m rooms of size w×h, walls as single axes. */
function grid(n: number, m: number, w = 4, h = 3): SegmentLike[] {
  const out: SegmentLike[] = [];
  for (let i = 0; i <= n; i++) out.push(seg(i * w, 0, i * w, m * h));
  for (let j = 0; j <= m; j++) out.push(seg(0, j * h, n * w, j * h));
  return out;
}

describe('SegmentGrid', () => {
  it('finds neighbours by box and by point, each once', () => {
    const segs = [seg(0, 0, 10, 0), seg(5, -5, 5, 5), seg(50, 50, 60, 50)];
    const g = new SegmentGrid(segs, 2);
    expect(g.queryBox(4, -1, 6, 1).sort()).toEqual([0, 1]);
    expect(g.queryPoint({ x: 55, y: 50 }, 0.1)).toEqual([2]);
    expect(g.queryPoint({ x: 100, y: 100 }, 1)).toEqual([]);
  });

  it('picks a cell size from the extent, never below ten snaps', () => {
    expect(cellSizeFor([seg(0, 0, 128, 0)], 0.05)).toBeCloseTo(1, 9);
    expect(cellSizeFor([seg(0, 0, 1, 0)], 0.05)).toBeCloseTo(0.5, 9);
  });
});

describe('findEnclosedAreas', () => {
  it('finds every room of a grid and drops the outer face', () => {
    const r = findEnclosedAreas(grid(3, 2));
    expect(r.faces).toHaveLength(6);
    expect(r.faces.every((f) => Math.abs(f.area - 12) < 1e-9)).toBe(true);
    expect(r.stats.outerFaces).toBe(1);
    expect(r.dangling).toEqual([]);
  });

  it('closes corners that miss by less than the snap tolerance', () => {
    const r = findEnclosedAreas([seg(0, 0, 4.03, 0), seg(4, -0.02, 4, 3), seg(4.02, 3, 0, 3.01), seg(0, 3, 0, 0.03)], { snapTolerance: 0.05 });
    expect(r.faces).toHaveLength(1);
    expect(r.faces[0].area).toBeCloseTo(12, 0);
  });

  it('reports a leak instead of a room when a gap is wider than the snap', () => {
    const r = findEnclosedAreas([seg(0, 0, 4, 0), seg(4, 0, 4, 3), seg(4, 3, 0, 3), seg(0, 3, 0, 0.5)]);
    expect(r.faces).toHaveLength(0);
    expect(r.dangling).toHaveLength(2);
  });

  it('splits a wall at a T-junction', () => {
    // Outer rectangle plus one partition that ends on the long wall's interior.
    const r = findEnclosedAreas([...grid(1, 1, 8, 3), seg(4, 0, 4, 3)]);
    expect(r.faces).toHaveLength(2);
  });

  it('splits crossing strokes', () => {
    const r = findEnclosedAreas([...grid(1, 1, 8, 6), seg(4, -1, 4, 7), seg(-1, 3, 9, 3)]);
    expect(r.faces).toHaveLength(4);
    expect(r.dangling).toHaveLength(4);
  });

  it('rejects a wall cavity as narrow, a closet as small, and says so', () => {
    const cavity = [seg(0, 0, 6, 0), seg(6, 0, 6, 0.2), seg(6, 0.2, 0, 0.2), seg(0, 0.2, 0, 0)];
    const closet = [seg(10, 10, 10.8, 10), seg(10.8, 10, 10.8, 10.8), seg(10.8, 10.8, 10, 10.8), seg(10, 10.8, 10, 10)];
    const r = findEnclosedAreas([...cavity, ...closet, ...grid(1, 1, 4, 3).map((s) => seg(s.a.x + 20, s.a.y, s.b.x + 20, s.b.y))]);
    expect(r.faces).toHaveLength(1);
    expect(r.rejected.map((f) => f.reason).sort()).toEqual(['narrow', 'small']);
  });

  it('drops hatching strokes before it starts', () => {
    const hatch = Array.from({ length: 200 }, (_, i) => seg(1 + i * 0.01, 1, 1.005 + i * 0.01, 1.005));
    const r = findEnclosedAreas([...grid(1, 1), ...hatch]);
    expect(r.stats.droppedShort).toBe(200);
    expect(r.faces).toHaveLength(1);
  });

  it('stays fast on a dense drawing', () => {
    // 40 × 30 rooms as double-line walls: ~5 000 strokes, dense crossings.
    const segs: SegmentLike[] = [];
    for (let i = 0; i <= 40; i++) for (const o of [0, 0.2]) segs.push(seg(i * 4 + o, 0, i * 4 + o, 90));
    for (let j = 0; j <= 30; j++) for (const o of [0, 0.2]) segs.push(seg(0, j * 3 + o, 160, j * 3 + o));
    const r = findEnclosedAreas(segs);
    expect(r.stats.timeMs).toBeLessThan(3000);
    expect(r.faces.length).toBe(40 * 30);
    // Every cavity between the double lines is reported, not kept: the
    // crossings cut them into 0.2 × 2.8 m strips, which fall under the area floor.
    expect(r.rejected.length).toBeGreaterThan(1000);
    expect(r.rejected.every((f) => f.width < 0.35)).toBe(true);
  });
});
