/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where a dragged corner lands.
 *
 * A room outline dragged by hand is never right: the corner sits 30 mm off the
 * wall, the room schedule is wrong by a hundredth, and the space boundary that
 * gets derived from it touches nothing. So the corner is pulled onto what is
 * already drawn — the wall lines of the section cut and the corners of the
 * room's own outline.
 *
 * # Corners before lines
 * A corner is a stronger statement than a line: two walls meet THERE, and
 * somebody aiming near that point means it. Only when no corner is in range
 * does the drag fall to the nearest point on a line, which is what "drag the
 * room out to that wall" needs.
 *
 * # Where the corners come from
 * Not from a list — from the lines themselves. A section cut hands over wall
 * FACES, and the corner where two walls meet is the point where two of those
 * faces cross. It is usually nobody's endpoint: the faces run past each other,
 * or stop a few millimetres short. So the candidates are the endpoints of the
 * lines in reach AND the crossings of their infinite extensions, kept only
 * where the crossing actually lies on (or a hair off) both. Snapping to
 * endpoints alone is what leaves the one point a plan is really drawn around
 * unreachable.
 *
 * # Tolerance is a screen distance
 * Snapping within a fixed number of metres would be unusable at both ends of
 * the zoom — grabby when zoomed out, useless when zoomed in. The caller
 * converts pixels to metres with the current scale, so the reach stays the same
 * on screen whatever the zoom.
 *
 * Pure — no store, no React.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';

/** A line the drag can snap to, in drawing space. */
export interface SnapSegment {
  readonly a: Point2D;
  readonly b: Point2D;
}

export type SnapKind = 'vertex' | 'edge';

export interface SnapResult {
  readonly at: Point2D;
  readonly kind: SnapKind;
}

/** The point on segment `a→b` closest to `p`, clamped to the segment. */
export function closestOnSegment(p: Point2D, a: Point2D, b: Point2D): Point2D {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * Where the infinite lines through `a→b` and `c→d` cross, or `null` when they
 * are parallel.
 *
 * Infinite rather than segment-to-segment on purpose: two wall faces meeting at
 * a corner routinely stop short of each other or run past, and the corner a
 * person sees is the crossing either way. The caller decides how far off the
 * segments it will still accept.
 */
export function lineIntersection(
  a: Point2D, b: Point2D, c: Point2D, d: Point2D,
): Point2D | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s2 = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s2.y - r.y * s2.x;
  // Parallel — including the two halves of one straight wall, which have no
  // corner between them and must not invent one.
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c.x - a.x) * s2.y - (c.y - a.y) * s2.x) / denom;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** Distance from a point to a segment. */
function distanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const q = closestOnSegment(p, a, b);
  return Math.hypot(q.x - p.x, q.y - p.y);
}

/**
 * The corners worth offering near `at`: line endpoints, and the crossings of
 * the lines in reach.
 *
 * Segments are filtered by reach FIRST, which is what keeps this cheap and is
 * also exactly right: a crossing within `tolerance` of `at` lies on both
 * lines, so both are within `tolerance` of `at` too.
 */
export function cornerCandidates(
  at: Point2D,
  segments: readonly SnapSegment[],
  tolerance: number,
): Point2D[] {
  const near = segments.filter((seg) => distanceToSegment(at, seg.a, seg.b) <= tolerance);
  const out: Point2D[] = [];
  for (const seg of near) {
    out.push(seg.a, seg.b);
  }
  for (let i = 0; i < near.length; i += 1) {
    for (let j = i + 1; j < near.length; j += 1) {
      const hit = lineIntersection(near[i].a, near[i].b, near[j].a, near[j].b);
      if (!hit) continue;
      // Only where the crossing is really at the corner: a hair off the end of
      // each face is the normal case, halfway across the room is not.
      if (distanceToSegment(hit, near[i].a, near[i].b) > tolerance) continue;
      if (distanceToSegment(hit, near[j].a, near[j].b) > tolerance) continue;
      out.push(hit);
    }
  }
  return out;
}

export interface SnapInput {
  /** Lines already drawn — the section cut's wall lines. */
  readonly segments: readonly SnapSegment[];
  /**
   * Extra points that snap harder than any line — the outline's own other
   * corners, so a room can be closed square on itself. The lines' own corners
   * are derived, not passed in; see {@link cornerCandidates}.
   */
  readonly points: readonly Point2D[];
  /** Reach, in the same units as the geometry (metres). */
  readonly tolerance: number;
}

/**
 * Where `at` should actually land, or `null` when nothing is in reach.
 *
 * `null` rather than returning the input unchanged: the caller draws the snap
 * differently from a free drag, and "nothing to snap to" is the state that
 * says so.
 */
export function snapPoint(at: Point2D, input: SnapInput): SnapResult | null {
  const { tolerance } = input;
  if (!(tolerance > 0)) return null;

  let best: { at: Point2D; d: number } | null = null;
  const corners = [
    ...input.points,
    ...cornerCandidates(at, input.segments, tolerance),
  ];
  for (const point of corners) {
    const d = Math.hypot(point.x - at.x, point.y - at.y);
    if (d <= tolerance && (best === null || d < best.d)) best = { at: point, d };
  }
  if (best) return { at: { x: best.at.x, y: best.at.y }, kind: 'vertex' };

  let bestEdge: { at: Point2D; d: number } | null = null;
  for (const segment of input.segments) {
    const candidate = closestOnSegment(at, segment.a, segment.b);
    const d = Math.hypot(candidate.x - at.x, candidate.y - at.y);
    if (d <= tolerance && (bestEdge === null || d < bestEdge.d)) {
      bestEdge = { at: candidate, d };
    }
  }
  return bestEdge ? { at: bestEdge.at, kind: 'edge' } : null;
}

/**
 * The lines worth snapping to, out of everything the drawing holds.
 *
 * Filtered to the CUT lines — what the section actually passes through, which
 * is the walls at cut height. Projected outlines and hidden lines describe
 * things above or below the cut, and a room corner pulled onto the edge of a
 * roof overhang is worse than no snap at all.
 */
export function snapSegmentsFrom(
  lines: ReadonlyArray<{
    readonly line: { readonly start: Point2D; readonly end: Point2D };
    readonly category?: string;
  }>,
  categories: ReadonlySet<string>,
): SnapSegment[] {
  const out: SnapSegment[] = [];
  for (const entry of lines) {
    if (entry.category !== undefined && !categories.has(entry.category)) continue;
    out.push({ a: entry.line.start, b: entry.line.end });
  }
  return out;
}
