/**
 * Walls from double lines (stage C4).
 *
 * A single stroke is not a building element (a plan line has no thickness,
 * and the writer refuses to invent one). Two parallel strokes a wall's width
 * apart, overlapping along their length, are: the pair is the wall's two
 * faces, the midline is its axis, the distance its thickness. That is the
 * only way a wall enters the draft; strokes that find no partner stay what
 * they are — the stroke network the rooms were found in.
 *
 * Deterministic like everything here: the candidate id is derived from the
 * two strokes' handles, so a re-run over the same plan yields the same wall.
 */

import { candidateId } from '../ids/stable-id.js';
import { SegmentGrid, cellSizeFor, type SegmentLike } from '../topology/spatial-hash.js';
import type { Candidate, Point2, Route } from '../types.js';

export interface WallStroke extends SegmentLike {
  /** Stable handle of the stroke in its source; derived from the geometry when the source has none. */
  handle?: string;
  layer?: string;
  /** How much the layer vouches for this being a wall stroke, 0–1. Default 0.85. */
  layerFactor?: number;
}

export interface WallOptions {
  sourceFile: string;
  storeyGlobalId?: string;
  route?: Exclude<Route, 'unavailable'>;
  /** Thinnest and thickest wall accepted, in metres. Default 0.06–0.6. */
  thicknessRangeM?: [number, number];
  /** Strokes shorter than this are not wall faces. Default 0.4 m. */
  minLengthM?: number;
  /** The overlap of the two faces along the wall, as a fraction of the shorter stroke. Default 0.5. */
  minOverlap?: number;
  /** How far from parallel the two faces may be. Default 2°. */
  angleToleranceDeg?: number;
}

export interface WallResult {
  candidates: Candidate[];
  /** Strokes that found a partner (two per wall). */
  paired: number;
  /** Wall strokes that found none. */
  unpaired: number;
}

function len(s: SegmentLike): number {
  return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
}

function handleOf(s: WallStroke): string {
  if (s.handle) return s.handle;
  const r = (v: number) => v.toFixed(3);
  return `seg@${r(s.a.x)},${r(s.a.y)}-${r(s.b.x)},${r(s.b.y)}`;
}

export function wallsFromDoubleLines(strokes: readonly WallStroke[], opts: WallOptions): WallResult {
  const [minT, maxT] = opts.thicknessRangeM ?? [0.06, 0.6];
  const minLength = opts.minLengthM ?? 0.4;
  const minOverlap = opts.minOverlap ?? 0.5;
  const sinTol = Math.sin(((opts.angleToleranceDeg ?? 2) * Math.PI) / 180);

  const list = strokes.filter((s) => s.kind !== 'divider' && len(s) >= minLength);
  const grid = new SegmentGrid(list, cellSizeFor(list, maxT));
  const dir = list.map((s) => {
    const l = len(s);
    return { x: (s.b.x - s.a.x) / l, y: (s.b.y - s.a.y) / l, l };
  });
  const used = new Set<number>();
  const candidates: Candidate[] = [];
  const scratch: number[] = [];

  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue;
    const si = list[i];
    const u = dir[i];
    const n = { x: -u.y, y: u.x };
    const box = {
      minX: Math.min(si.a.x, si.b.x) - maxT,
      minY: Math.min(si.a.y, si.b.y) - maxT,
      maxX: Math.max(si.a.x, si.b.x) + maxT,
      maxY: Math.max(si.a.y, si.b.y) + maxT,
    };
    let best: { j: number; overlap: number; s: number; e: number; d: number } | null = null;
    scratch.length = 0;
    for (const j of grid.queryBox(box.minX, box.minY, box.maxX, box.maxY, scratch)) {
      if (j === i || used.has(j)) continue;
      const v = dir[j];
      if (Math.abs(u.x * v.y - u.y * v.x) > sinTol) continue;
      const sj = list[j];
      const da = (sj.a.x - si.a.x) * n.x + (sj.a.y - si.a.y) * n.y;
      const db = (sj.b.x - si.a.x) * n.x + (sj.b.y - si.a.y) * n.y;
      const d = (da + db) / 2;
      const ad = Math.abs(d);
      if (ad < minT || ad > maxT) continue;
      const ta = (sj.a.x - si.a.x) * u.x + (sj.a.y - si.a.y) * u.y;
      const tb = (sj.b.x - si.a.x) * u.x + (sj.b.y - si.a.y) * u.y;
      const s = Math.max(0, Math.min(ta, tb));
      const e = Math.min(u.l, Math.max(ta, tb));
      const overlap = e - s;
      if (overlap < minOverlap * Math.min(u.l, v.l)) continue;
      if (!best || overlap > best.overlap) best = { j, overlap, s, e, d };
    }
    if (!best) continue;
    used.add(i);
    used.add(best.j);
    const sj = list[best.j];
    const half = Math.abs(best.d) / 2;
    const shift = { x: (n.x * best.d) / 2, y: (n.y * best.d) / 2 };
    const p = (t: number): Point2 => ({ x: si.a.x + u.x * t + shift.x, y: si.a.y + u.y * t + shift.y });
    const overlapRatio = best.overlap / Math.max(u.l, dir[best.j].l);
    const thickness = Math.abs(best.d);
    const reasons: Record<string, number> = {
      overlap: Math.round((0.6 + 0.4 * overlapRatio) * 100) / 100,
      thickness: thickness >= 0.08 && thickness <= 0.45 ? 1 : 0.75,
      layer: Math.round((((si.layerFactor ?? 0.85) + (sj.layerFactor ?? 0.85)) / 2) * 100) / 100,
    };
    const confidence = Object.values(reasons).reduce((a, b) => a * b, 1);
    const handles = [handleOf(si), handleOf(sj)].sort();
    candidates.push({
      id: candidateId(opts.sourceFile, opts.storeyGlobalId, handles),
      type: 'wall',
      geometry: [p(best.s), p(best.e)],
      thickness: half,
      confidence: Math.round(confidence * 10000) / 10000,
      confidenceReasons: reasons,
      source: { ...(si.layer ? { layer: si.layer } : {}), handles },
      route: opts.route ?? 'vector',
    });
  }
  return { candidates, paired: used.size, unpaired: list.length - used.size };
}
