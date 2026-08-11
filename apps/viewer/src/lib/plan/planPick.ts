/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a click in a plan hits.
 *
 * # Why this is a hit test and not a raycast
 * The requirement in #50 is that picking follows the CUT, not depth — in a
 * floor plan the slab overhead is nearest the eye, so a depth-sorted pick hands
 * back the ceiling for every click, which is the single symptom that gives a
 * fake plan mode away. Here the question does not arise: the drawing already
 * contains only what the cut produced, and every line and polygon in it carries
 * the `entityId` it came from. So "what is on this floor" is not something the
 * pick has to be argued into — it is the only thing there is to hit.
 *
 * # The ranking
 * Cut geometry outranks projected geometry. Both are legitimately on the plan —
 * a table below the cut is drawn and should be clickable — but the cut is the
 * thing being worked on, so where a wall's cut face and the floor slab beneath
 * it overlap (which is everywhere), the wall wins. Within a tier, a containing
 * area beats a nearby line, and a smaller area beats a larger one so a column
 * embedded in a wall is reachable at all.
 *
 * All coordinates are DRAWING space. The caller converts from the screen with
 * the same transform the canvas paints with, and passes a tolerance in drawing
 * units (a screen-pixel tolerance divided by the zoom) so the grab radius stays
 * constant on screen at every zoom level.
 */

import type { Drawing2D, DrawingLine, DrawingPolygon, Point2D } from '@ifc-lite/drawing-2d';

export interface PlanPickTarget {
  /** Express id local to the model the geometry came from. */
  readonly entityId: number;
  /** Which model, for federation. */
  readonly modelIndex: number;
  readonly ifcType: string;
  /** Whether the hit was on the cut itself or on something drawn below it. */
  readonly tier: 'cut' | 'projection';
}

/** Signed doubled area; only the magnitude and sign of the ring matter here. */
function ringArea(points: readonly Point2D[]): number {
  let sum = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Crossing-number test. Points exactly on an edge are not guaranteed either
 * way, which is fine: the line tier catches an edge click within tolerance.
 */
function pointInRing(p: Point2D, ring: readonly Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Inside the outer ring and outside every hole.
 *
 * The holes matter: a cut through a wall with a door in it has the opening as a
 * hole, and clicking through the doorway should not select the wall — the wall
 * is not there.
 */
function pointInPolygon(p: Point2D, polygon: { outer: Point2D[]; holes: Point2D[][] }): boolean {
  if (!pointInRing(p, polygon.outer)) return false;
  for (const hole of polygon.holes) {
    if (pointInRing(p, hole)) return false;
  }
  return true;
}

/** Distance from a point to a segment, degenerate segments included. */
function distanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The smallest polygon containing the point, or null. */
function pickPolygon(
  polygons: readonly DrawingPolygon[],
  p: Point2D,
  wantCut: boolean,
): DrawingPolygon | null {
  let best: DrawingPolygon | null = null;
  let bestArea = Infinity;
  for (const poly of polygons) {
    if (poly.isCut !== wantCut) continue;
    if (!pointInPolygon(p, poly.polygon)) continue;
    // Smallest wins: a column drawn inside a wall's cut face is otherwise
    // unreachable, since the wall contains every point the column does.
    const area = ringArea(poly.polygon.outer);
    if (area < bestArea) {
      bestArea = area;
      best = poly;
    }
  }
  return best;
}

/** The nearest line within tolerance, or null. */
function pickLine(
  lines: readonly DrawingLine[],
  p: Point2D,
  tolerance: number,
  categories: ReadonlySet<string>,
): DrawingLine | null {
  let best: DrawingLine | null = null;
  let bestDistance = tolerance;
  for (const line of lines) {
    if (!categories.has(line.category)) continue;
    // A line the hidden-line pass removed is drawn dashed or not at all;
    // picking something the drawing does not really show is a lie about
    // what was clicked.
    if (line.visibility === 'hidden') continue;
    const d = distanceToSegment(p, line.line.start, line.line.end);
    if (d <= bestDistance) {
      bestDistance = d;
      best = line;
    }
  }
  return best;
}

const CUT_CATEGORIES: ReadonlySet<string> = new Set(['cut']);
/**
 * Everything else the plan actually draws below the cut. `hidden` is excluded
 * as a category as well as a visibility state — both mean "occluded", and
 * neither is something the user is pointing at.
 */
const PROJECTION_CATEGORIES: ReadonlySet<string> = new Set([
  'projection',
  'silhouette',
  'crease',
  'boundary',
]);

/**
 * The element under `point`, or `null` where the plan is empty.
 *
 * `tolerance` is the grab radius in drawing units — screen pixels divided by
 * the current zoom, so it feels the same at every scale.
 */
export function pickInPlan(
  drawing: Drawing2D,
  point: Point2D,
  tolerance: number,
): PlanPickTarget | null {
  const cutPoly = pickPolygon(drawing.cutPolygons, point, true);
  if (cutPoly) {
    return { entityId: cutPoly.entityId, modelIndex: cutPoly.modelIndex, ifcType: cutPoly.ifcType, tier: 'cut' };
  }

  const cutLine = pickLine(drawing.lines, point, tolerance, CUT_CATEGORIES);
  if (cutLine) {
    return { entityId: cutLine.entityId, modelIndex: cutLine.modelIndex, ifcType: cutLine.ifcType, tier: 'cut' };
  }

  // Only now does anything below the cut get a say.
  const projPoly =
    pickPolygon(drawing.projectionPolygons, point, false) ??
    pickPolygon(drawing.projectionPolygons, point, true);
  if (projPoly) {
    return { entityId: projPoly.entityId, modelIndex: projPoly.modelIndex, ifcType: projPoly.ifcType, tier: 'projection' };
  }

  const projLine = pickLine(drawing.lines, point, tolerance, PROJECTION_CATEGORIES);
  if (projLine) {
    return { entityId: projLine.entityId, modelIndex: projLine.modelIndex, ifcType: projLine.ifcType, tier: 'projection' };
  }

  return null;
}

/**
 * Screen point to drawing point, for the plan's own transform.
 *
 * A plan is always the 'down' axis, where the canvas maps both axes with the
 * same positive scale — no flips. Kept here beside the pick so the two cannot
 * be given different ideas about where the cursor is.
 */
export function planScreenToDrawing(
  screenX: number,
  screenY: number,
  transform: { x: number; y: number; scale: number },
): Point2D {
  return {
    x: (screenX - transform.x) / transform.scale,
    y: (screenY - transform.y) / transform.scale,
  };
}

/**
 * A point on the plan, as a point in the renderer's world.
 *
 * The section cutter projects a down-cut with `getProjectionAxes('y')`, which
 * is `{ u: 'x', v: 'z' }`, and `projectTo2D` writes `{ x: u, y: v }` — so
 * drawing x IS world x and drawing y IS world z, with NO negation.
 *
 * That last clause is the trap. A neighbouring comment in the generation hook
 * describes `worldZ = -(2D y)`, but it is about the SYMBOLIC representation
 * path, where WASM negates Z into the 2D y axis to match the cutter's
 * handedness. Applying that rule here would mirror every placement about the
 * building's X axis — plausible-looking output landing on the wrong side of
 * the plan. Verified against real geometry: a cut wall whose plan centroid is
 * y = -3.905 has a mesh centroid at world z = -3.900.
 *
 * `worldY` is the height to place at; the caller passes the cut or the storey
 * floor. Placement currently discards it (a new element sits at its storey's
 * own datum, exactly as in 3D), but the point is a world point and lying about
 * one of its components would be a trap for the next reader.
 */
export function planPointToRenderer(
  point: Point2D,
  worldY: number,
): { x: number; y: number; z: number } {
  return { x: point.x, y: worldY, z: point.y };
}
