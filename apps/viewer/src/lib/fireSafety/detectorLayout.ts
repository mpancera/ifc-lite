/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where the detectors go in a room, and where the call points go in a corridor.
 *
 * ## The grid
 *
 * Four metres, Marc's number (2026-09-16), applied on the BUILDING'S axes —
 * storey-local x and y, which is the frame the rooms are written in. A grid
 * laid out on the world axes would run diagonally across a building that is
 * turned on its site, and every detector would sit at an angle to the ceiling
 * it hangs from.
 *
 * The grid is CENTRED on the room rather than started from a corner. A grid
 * anchored at a corner leaves a strip of up to four metres unprotected at the
 * far side of every room; centring shares the leftover between two sides, and
 * on a room narrower than the spacing it puts the single detector in the
 * middle, which is where it belongs.
 *
 * ## What this does not know
 *
 * Ceiling height, beams, ventilation, sloped roofs and detector type all
 * change real spacing, and none of them are here. This is a layout on a plan,
 * for a concept — the number of detectors and roughly where they hang. It is
 * not a design, and a room whose ceiling is 6 m high will need a second look
 * that nothing here will prompt.
 */

/** A point in the storey's own XY, metres. */
export interface PlanPoint {
  x: number;
  y: number;
}

export interface DetectorLayoutOptions {
  /** Grid pitch in metres. */
  spacing: number;
  /**
   * How far a detector must stay off a wall, metres.
   *
   * Half a metre is the usual requirement and the reason a grid point can be
   * inside the room and still be rejected: a detector in the corner reads the
   * corner, not the room.
   */
  wallClearance: number;
}

export const DEFAULT_DETECTOR_LAYOUT: DetectorLayoutOptions = {
  spacing: 4,
  wallClearance: 0.5,
};

/** Whether `p` is inside the polygon — ray cast, boundary counts as outside. */
function inside(polygon: readonly PlanPoint[], p: PlanPoint): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

/** Distance from `p` to the nearest edge of the polygon. */
function distanceToEdge(polygon: readonly PlanPoint[], p: PlanPoint): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** The polygon's own centre of area — where a single detector goes. */
export function polygonCentroid(polygon: readonly PlanPoint[]): PlanPoint {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-12) {
    // Degenerate ring — fall back to the average vertex, which is at least
    // inside the hull and never NaN.
    const n = polygon.length || 1;
    return {
      x: polygon.reduce((s, p) => s + p.x, 0) / n,
      y: polygon.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

/**
 * Detector positions for one room, in the storey's own XY.
 *
 * Never empty for a room with a real outline: a room that takes no grid point
 * — a narrow corridor, an L whose arms are under the clearance — still gets
 * one detector, at its centroid, pulled inside if the centroid of a concave
 * room falls outside it. A room with no detector is a hole in the coverage,
 * and a hole that arises from a spacing rule is the kind nobody notices.
 */
export function layOutDetectors(
  polygon: readonly PlanPoint[],
  options: DetectorLayoutOptions = DEFAULT_DETECTOR_LAYOUT,
): PlanPoint[] {
  if (polygon.length < 3) return [];
  const { spacing, wallClearance } = options;
  if (!(spacing > 0)) return [];

  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Centred: `count` cells across the extent, and the leftover shared between
  // the two sides rather than all left at one end.
  const countX = Math.max(1, Math.ceil((maxX - minX) / spacing));
  const countY = Math.max(1, Math.ceil((maxY - minY) / spacing));
  const startX = (minX + maxX) / 2 - ((countX - 1) * spacing) / 2;
  const startY = (minY + maxY) / 2 - ((countY - 1) * spacing) / 2;

  const points: PlanPoint[] = [];
  for (let iy = 0; iy < countY; iy += 1) {
    for (let ix = 0; ix < countX; ix += 1) {
      const p = { x: startX + ix * spacing, y: startY + iy * spacing };
      if (!inside(polygon, p)) continue;
      if (distanceToEdge(polygon, p) < wallClearance) continue;
      points.push(p);
    }
  }

  if (points.length > 0) return points;

  const centre = polygonCentroid(polygon);
  return [inside(polygon, centre) ? centre : nearestInteriorPoint(polygon, centre)];
}

/**
 * A point inside the polygon, near `from`.
 *
 * For the concave room whose centroid falls outside it — an L, a U. Sampling
 * the bounding box is crude and it is bounded work on a shape that is already
 * a room outline; the alternative (a proper pole-of-inaccessibility) is a lot
 * of machinery to place one detector slightly better.
 */
function nearestInteriorPoint(polygon: readonly PlanPoint[], from: PlanPoint): PlanPoint {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const steps = 16;
  let best: PlanPoint | null = null;
  let bestDistance = Infinity;
  for (let iy = 0; iy <= steps; iy += 1) {
    for (let ix = 0; ix <= steps; ix += 1) {
      const p = {
        x: minX + ((maxX - minX) * ix) / steps,
        y: minY + ((maxY - minY) * iy) / steps,
      };
      if (!inside(polygon, p)) continue;
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if (d < bestDistance) { bestDistance = d; best = p; }
    }
  }
  // A polygon so thin that nothing samples inside it: the first vertex is a
  // place a person can see and move, which beats no detector at all.
  return best ?? polygon[0];
}

/** Where a manual call point sits: a position, and the wall it faces along. */
export interface CallPointPlacement {
  at: PlanPoint;
  /** Unit vector along the wall, for orienting the symbol. */
  along: PlanPoint;
  /** Metres above the storey floor. */
  height: number;
}

/** Mounting height for a manual call point — Marc's number. */
export const CALL_POINT_HEIGHT_M = 1.2;

/** How far off the wall face the device sits, so it is not inside the wall. */
const CALL_POINT_INSET_M = 0.15;

/**
 * A manual call point for one corridor room.
 *
 * On the LONGEST wall, at its midpoint, set slightly in from the face.
 *
 * The real rule puts call points at the exits, and the exits are not in this
 * data: nothing here reads doors. So this marks the corridor, not the way out
 * of it, and a door-aware pass is the next step rather than a refinement of
 * this one. Said plainly because a call point on the wrong wall looks as
 * finished as one on the right wall.
 */
export function layOutCallPoint(polygon: readonly PlanPoint[]): CallPointPlacement | null {
  if (polygon.length < 3) return null;

  let bestLength = 0;
  let bestA: PlanPoint | null = null;
  let bestB: PlanPoint | null = null;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > bestLength) { bestLength = length; bestA = a; bestB = b; }
  }
  if (!bestA || !bestB || bestLength < 1e-9) return null;

  const along = { x: (bestB.x - bestA.x) / bestLength, y: (bestB.y - bestA.y) / bestLength };
  // Into the room, not out of it: the inward normal is whichever of the two
  // lands inside. Tested rather than assumed, because a polygon's winding is
  // not something a room outline promises.
  const mid = { x: (bestA.x + bestB.x) / 2, y: (bestA.y + bestB.y) / 2 };
  const candidates = [
    { x: mid.x - along.y * CALL_POINT_INSET_M, y: mid.y + along.x * CALL_POINT_INSET_M },
    { x: mid.x + along.y * CALL_POINT_INSET_M, y: mid.y - along.x * CALL_POINT_INSET_M },
  ];
  const at = candidates.find((p) => inside(polygon, p)) ?? mid;

  return { at, along, height: CALL_POINT_HEIGHT_M };
}
