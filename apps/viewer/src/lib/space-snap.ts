/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Snapping for the 2D Space Sketch editor — shared by both dragging existing
 * room vertices and drawing new room corners, so every node behaves the same.
 *
 * Candidates, in priority order (nearest within `tol` wins per tier):
 *   1. Corners — room vertices, building-line endpoints, and WALL ENDS.
 *   2. Perpendicular — the foot of the perpendicular from `anchor` onto a wall
 *      axis, so a wall can be carried to its neighbour at a right angle.
 *   3. On-wall — projection onto the nearest building segment.
 *
 * A wall end is the middle of the wall's end face — the point its axis stops
 * at. It is the one position on a free-standing wall end that is defensible,
 * and until now it was unreachable: a wall that bounds no room has no node in
 * the plate, so there was nothing there to snap to even though the wall is
 * plainly on screen.
 * Both work in the room (model-metre) frame, the same frame the underlay lines
 * and room outlines already live in.
 *
 * Ortho (Shift) DOMINATES snap: when `ortho` is set the point is locked to the
 * horizontal/vertical line through `anchor` and snapping only moves it ALONG that
 * line (to a corner's aligned coordinate, or where the line crosses a wall) — it
 * can never break the straight constraint. Without Shift, snap is free in 2D.
 */

export type Pt = [number, number];

export type SnapKind = 'vertex' | 'wallEnd' | 'perp' | 'line' | 'none';

export interface SnapOptions {
  /** Corner targets — existing room vertices. */
  vertices?: ReadonlyArray<Pt>;
  /** Building wall lines (room frame); endpoints snap as corners, bodies as on-wall. */
  segments?: ReadonlyArray<readonly [Pt, Pt]>;
  /** Wall ENDS — the middle of each wall's end face, i.e. where its axis stops. */
  axisEnds?: ReadonlyArray<Pt>;
  /** Wall axes to drop a perpendicular onto, from `anchor`. */
  perpLines?: ReadonlyArray<readonly [Pt, Pt]>;
  /** Snap radius in world (metre) units. */
  tol: number;
  /** Constrain to horizontal/vertical from `anchor` before snapping. */
  ortho?: boolean;
  /** Reference point for ortho (e.g. the previous drawn corner or drag start). */
  anchor?: Pt | null;
}

export interface SnapResult {
  pt: Pt;
  kind: SnapKind;
}

/** Closest point on segment a→b to p (clamped to the segment). */
function projectOnSeg(p: Pt, a: readonly [number, number], b: readonly [number, number]): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * dx, a[1] + t * dy];
}

export interface AlignResult {
  pt: Pt;
  /** Reference point whose X the result aligned to (vertical guide), if any. */
  vRef: Pt | null;
  /** Reference point whose Y the result aligned to (horizontal guide), if any. */
  hRef: Pt | null;
}

/**
 * Alignment / object-snap tracking: independently snap `p`'s X to the nearest
 * reference point's X (a vertical guide) and its Y to the nearest reference's Y
 * (a horizontal guide). Lets a drawn corner lock under/level-with an earlier
 * corner — e.g. the closing point aligns vertically with the first point — so
 * rectangles close cleanly. X and Y snap independently, so the result can sit at
 * the intersection of two different references' axes.
 */
export function alignToAxes(p: Pt, refs: ReadonlyArray<Pt>, tol: number): AlignResult {
  let x = p[0], y = p[1];
  let vRef: Pt | null = null, hRef: Pt | null = null;
  let bestVX = tol, bestHY = tol;
  for (const r of refs) {
    const dx = Math.abs(r[0] - p[0]);
    if (dx < bestVX) { bestVX = dx; x = r[0]; vRef = r; }
    const dy = Math.abs(r[1] - p[1]);
    if (dy < bestHY) { bestHY = dy; y = r[1]; hRef = r; }
  }
  return { pt: [x, y], vRef, hRef };
}

/**
 * Snap ALONG the ortho line through `anchor` (Shift held): the point stays on the
 * horizontal/vertical line, and only the free coordinate is snapped — to a nearby
 * corner's aligned coordinate (so the new node lines up with an existing one) or
 * to where the ortho line crosses a wall. Never breaks the straight constraint.
 */
function snapAlongOrtho(
  p: Pt,
  anchor: Pt,
  vertices: ReadonlyArray<Pt>,
  segments: ReadonlyArray<readonly [Pt, Pt]>,
  tol: number,
): SnapResult {
  const horizontal = Math.abs(p[0] - anchor[0]) >= Math.abs(p[1] - anchor[1]);
  const free = horizontal ? 0 : 1; // coordinate that varies along the line
  const fixed = horizontal ? 1 : 0; // coordinate pinned to the anchor
  const fixedVal = anchor[fixed];
  const target = p[free];
  let best = target, bestD = tol;
  let kind: SnapKind = 'none';
  // (a) align the free coord with a nearby corner (room vertex or wall endpoint).
  const alignTo = (q: Pt) => {
    const d = Math.abs(q[free] - target);
    if (d < bestD) { bestD = d; best = q[free]; kind = 'vertex'; }
  };
  for (const q of vertices) alignTo(q);
  for (const seg of segments) { alignTo(seg[0]); alignTo(seg[1]); }
  // (b) where the ortho line (fixed = fixedVal) crosses a wall segment.
  for (const seg of segments) {
    const fa = seg[0][fixed], fb = seg[1][fixed];
    const denom = fb - fa;
    if (Math.abs(denom) < 1e-9 || (fa - fixedVal) * (fb - fixedVal) > 0) continue; // parallel / no crossing
    const t = (fixedVal - fa) / denom;
    if (t < 0 || t > 1) continue;
    const cross = seg[0][free] + t * (seg[1][free] - seg[0][free]);
    const d = Math.abs(cross - target);
    if (d < bestD) { bestD = d; best = cross; kind = 'line'; }
  }
  const pt: Pt = horizontal ? [best, fixedVal] : [fixedVal, best];
  return { pt, kind };
}

export function snapPoint(p: Pt, opts: SnapOptions): SnapResult {
  const { vertices = [], segments = [], axisEnds = [], perpLines = [], tol, ortho = false, anchor = null } = opts;
  // Shift held → ortho dominates: snap only along the straight line.
  if (ortho && anchor) return snapAlongOrtho(p, anchor, vertices, segments, tol);
  const base: Pt = [p[0], p[1]];

  // 1. Corner snap — room vertices, segment endpoints, wall ends. Scalar
  // trackers (not a `Pt | null`) so TS control-flow doesn't narrow the
  // accumulator to `never`.
  let bestX = 0, bestY = 0, bestD = tol, foundCorner = false;
  let cornerKind: SnapKind = 'vertex';
  const consider = (qx: number, qy: number, kind: SnapKind) => {
    const d = Math.hypot(qx - base[0], qy - base[1]);
    if (d < bestD) { bestD = d; bestX = qx; bestY = qy; foundCorner = true; cornerKind = kind; }
  };
  // Wall ends first, so that where one coincides with a room corner the more
  // specific name is the one reported.
  for (const q of axisEnds) consider(q[0], q[1], 'wallEnd');
  for (const q of vertices) consider(q[0], q[1], 'vertex');
  for (const seg of segments) { consider(seg[0][0], seg[0][1], 'vertex'); consider(seg[1][0], seg[1][1], 'vertex'); }
  if (foundCorner) return { pt: [bestX, bestY], kind: cornerKind };

  // 2. Perpendicular from the anchor onto a wall axis — how a wall is carried
  // across to the one it should meet. The foot is taken on the INFINITE line:
  // the whole point is to reach an axis the wall stops short of, and clamping
  // to the drawn extent would refuse exactly that.
  if (anchor) {
    let pX = 0, pY = 0, pD = tol, foundPerp = false;
    for (const line of perpLines) {
      const dx = line[1][0] - line[0][0], dy = line[1][1] - line[0][1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) continue;
      const t = ((anchor[0] - line[0][0]) * dx + (anchor[1] - line[0][1]) * dy) / len2;
      const fx = line[0][0] + t * dx, fy = line[0][1] + t * dy;
      // The foot must not be the anchor itself — that is not a direction.
      if (Math.hypot(fx - anchor[0], fy - anchor[1]) < 1e-6) continue;
      const d = Math.hypot(fx - base[0], fy - base[1]);
      if (d < pD) { pD = d; pX = fx; pY = fy; foundPerp = true; }
    }
    if (foundPerp) return { pt: [pX, pY], kind: 'perp' };
  }

  // 3. On-wall snap — nearest segment projection.
  let projX = 0, projY = 0, projD = tol, foundLine = false;
  for (const seg of segments) {
    const q = projectOnSeg(base, seg[0], seg[1]);
    const d = Math.hypot(q[0] - base[0], q[1] - base[1]);
    if (d < projD) { projD = d; projX = q[0]; projY = q[1]; foundLine = true; }
  }
  if (foundLine) return { pt: [projX, projY], kind: 'line' };

  // 4. No snap — the ortho-adjusted (or raw) point.
  return { pt: base, kind: 'none' };
}
