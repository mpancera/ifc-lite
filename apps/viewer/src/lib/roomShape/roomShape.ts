/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A room's outline, edited by its corners.
 *
 * A room is drawn once and then the building changes around it — a wall comes
 * out, a partition moves — and until now the only answer was to delete the room
 * and draw it again. That loses everything hanging off it: its number, the zone
 * it was painted into, the detectors contained in it. Moving a corner keeps all
 * of that, which is the whole point.
 *
 * # Corners and edges are both handles
 * Dragging a corner moves it. Dragging the middle of an edge inserts a corner
 * there and moves that — the standard way to take a rectangle to an L without a
 * separate "add point" mode. Nothing here decides which was grabbed; that is
 * {@link nearestHandle}, so the hit test is testable on its own.
 *
 * # Coordinates
 * Drawing space throughout: x is world x, y is world z, in metres — the frame
 * `planPick.ts` pins. Nothing here knows about the plan's rotation, because a
 * rotated plan is a turned picture and a room's shape is a fact about the
 * building.
 *
 * Pure — no store, no React, no IFC.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';

/** A polygon needs three corners; below that it is a line. */
export const MIN_VERTICES = 3;

/** What the cursor is over. */
export type RoomHandle =
  | { readonly kind: 'vertex'; readonly index: number }
  | { readonly kind: 'edge'; readonly index: number; readonly at: Point2D };

/** Absolute area of a closed polygon, by the shoelace formula. */
export function polygonArea(points: readonly Point2D[]): number {
  if (points.length < MIN_VERTICES) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** The midpoint of every edge, indexed by the edge's first corner. */
export function edgeMidpoints(points: readonly Point2D[]): Point2D[] {
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });
}

/**
 * The handle under a point, or `null`.
 *
 * Corners win over edge midpoints at equal distance: on a short edge the two
 * are almost on top of each other, and the corner is the one somebody aiming
 * at that spot means — inserting a corner where one already is would be a
 * degenerate edge.
 */
export function nearestHandle(
  points: readonly Point2D[],
  at: Point2D,
  tolerance: number,
): RoomHandle | null {
  let best: { index: number; d: number } | null = null;
  for (let i = 0; i < points.length; i += 1) {
    const d = Math.hypot(points[i].x - at.x, points[i].y - at.y);
    if (d <= tolerance && (best === null || d < best.d)) best = { index: i, d };
  }
  if (best) return { kind: 'vertex', index: best.index };

  const mids = edgeMidpoints(points);
  let bestEdge: { index: number; d: number; at: Point2D } | null = null;
  for (let i = 0; i < mids.length; i += 1) {
    const d = Math.hypot(mids[i].x - at.x, mids[i].y - at.y);
    if (d <= tolerance && (bestEdge === null || d < bestEdge.d)) {
      bestEdge = { index: i, d, at: mids[i] };
    }
  }
  return bestEdge ? { kind: 'edge', index: bestEdge.index, at: bestEdge.at } : null;
}

/** The outline with one corner moved. */
export function moveVertex(
  points: readonly Point2D[],
  index: number,
  to: Point2D,
): Point2D[] {
  if (index < 0 || index >= points.length) return [...points];
  const next = [...points];
  next[index] = { x: to.x, y: to.y };
  return next;
}

/**
 * The outline with a corner inserted in the middle of edge `index`.
 *
 * Returns the new list AND where the new corner sits in it, because the caller
 * is mid-drag and has to keep hold of the thing it just made.
 */
export function insertVertex(
  points: readonly Point2D[],
  index: number,
  at: Point2D,
): { points: Point2D[]; index: number } {
  const next = [...points];
  const insertAt = index + 1;
  next.splice(insertAt, 0, { x: at.x, y: at.y });
  return { points: next, index: insertAt };
}

/**
 * The outline with one corner removed, or `null` when it would stop being a
 * polygon.
 *
 * `null` rather than a silent no-op: a delete that does nothing looks like a
 * broken key, and the caller can say why.
 */
export function removeVertex(
  points: readonly Point2D[],
  index: number,
): Point2D[] | null {
  if (points.length <= MIN_VERTICES) return null;
  if (index < 0 || index >= points.length) return null;
  return points.filter((_, i) => i !== index);
}

/**
 * Whether an outline is safe to write back to the model.
 *
 * Two rules, both learned from what a dragged corner can produce: a polygon
 * needs three corners, and it must not cross itself. A self-crossing footprint
 * extrudes into a solid whose volume is nonsense and whose area is the
 * difference of two lobes — a number that looks plausible on a room schedule
 * and is wrong.
 */
export function outlineProblem(points: readonly Point2D[]): string | null {
  if (points.length < MIN_VERTICES) return 'Ein Raum braucht mindestens drei Ecken.';
  // Crossing is checked BEFORE the area: a bow tie's two lobes cancel to zero
  // by the shoelace formula, so the area test would catch it and then explain
  // it as something else entirely.
  if (selfIntersects(points)) return 'Der Umriss überschneidet sich selbst.';
  if (polygonArea(points) < 1e-6) return 'Die Ecken liegen auf einer Linie.';
  return null;
}

/** Whether two segments cross, ignoring shared endpoints. */
function segmentsCross(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const side = (p: Point2D, q: Point2D, r: Point2D): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function selfIntersects(points: readonly Point2D[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Neighbouring edges share a corner; the strict-crossing test above
      // already lets that through, so only the wrap-around pair is skipped.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(
        points[i], points[(i + 1) % n],
        points[j], points[(j + 1) % n],
      )) return true;
    }
  }
  return false;
}
