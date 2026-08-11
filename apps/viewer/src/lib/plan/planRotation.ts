/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning the plan so you can work orthogonally on a building that was
 * modelled with a north deviation.
 *
 * # The rotation belongs to the VIEW, never to the model
 * Nothing here changes a coordinate that gets written. The drawing keeps its
 * world coordinates; only the mapping from drawing space to screen space gains
 * an angle. That is what makes the rest fall out for free: picking, placing and
 * committing an annotation all run through the same screen→drawing mapping, so
 * undoing the angle once there means every one of them still lands in true
 * world coordinates. A rotation applied to the model instead would write turned
 * coordinates on every placement and quietly invalidate the georeferencing.
 *
 * It also means the DXF export needs no special case: it writes the drawing,
 * and the drawing was never turned.
 *
 * # One angle for the project
 * A north deviation is a property of the building, not of a storey, so paging
 * floors must not change it.
 */

/** A point in drawing (or screen) space. */
export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** Rotate about the origin. Positive is the screen's own sense of positive. */
export function rotatePoint(p: Point2, angleRad: number): Point2 {
  if (angleRad === 0) return { x: p.x, y: p.y };
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/**
 * The angle that lays `from → to` onto the nearest axis.
 *
 * One line is all the information there is: unlike the DXF alignment — which
 * solves scale AND rotation AND translation between two different drawings —
 * there is exactly one unknown here. So the second line of that gesture would
 * carry a single number, and that number is almost always "horizontal".
 *
 * Snapping to the axis the line is ALREADY NEARER tidies the gesture up
 * instead of overruling it: a wall drawn roughly vertically becomes vertical,
 * not horizontal. Same rule the underlay alignment settled on.
 *
 * Returns `null` for a degenerate line, which is a mis-click rather than an
 * instruction to rotate by an arbitrary amount.
 */
export function rotationToNearestAxis(from: Point2, to: Point2): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;

  const angle = Math.atan2(dy, dx);
  // Distance to the nearest multiple of 90°, signed, in (-45°, +45°].
  const quarter = Math.PI / 2;
  const snapped = Math.round(angle / quarter) * quarter;
  // Rotating the VIEW by the negative of the line's deviation brings the line
  // onto the axis — the line turns with the drawing, so the correction is the
  // opposite of its error.
  return -(angle - snapped);
}

/**
 * The angle that lays `from → to` onto a chosen direction.
 *
 * The fallback for aligning to something that is not an axis — a site
 * boundary, a neighbouring building — where the second line earns its place.
 */
export function rotationToDirection(from: Point2, to: Point2, target: number): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  return normalizeAngle(target - Math.atan2(dy, dx));
}

/**
 * A compass bearing, as the maths here needs it.
 *
 * People give a direction on a plan as a bearing: **0° is up, and it grows
 * clockwise** — 90° points right, 180° down, 270° left. The trigonometry
 * underneath measures from the +x axis instead, so 0° points RIGHT. The two
 * differ by a quarter turn, and taking one for the other lays an alignment
 * line ninety degrees away from where it was asked to go — which looks like a
 * sign error but is a vocabulary error.
 *
 * Screen y grows downward, so `atan2` angles already increase clockwise on
 * screen and the whole conversion is one offset.
 */
export function bearingToAngle(bearingRad: number): number {
  return bearingRad - Math.PI / 2;
}

/** The inverse, for readouts. */
export function angleToBearing(angleRad: number): number {
  return angleRad + Math.PI / 2;
}

/** Fold a bearing into [0, 360), the range a compass reading is read in. */
export function normalizeBearing(bearingRad: number): number {
  const twoPi = Math.PI * 2;
  const b = bearingRad % twoPi;
  return b < 0 ? b + twoPi : b;
}

/** Fold an angle into (-π, π], so a readout never shows 350° for -10°. */
export function normalizeAngle(angleRad: number): number {
  const twoPi = Math.PI * 2;
  let a = angleRad % twoPi;
  if (a > Math.PI) a -= twoPi;
  if (a <= -Math.PI) a += twoPi;
  return a;
}

/**
 * The axis-aligned bounds of a rotated rectangle.
 *
 * Fitting a turned plan to the viewport has to measure the turned extent: the
 * unrotated bounds of a 45°-turned building understate its width by up to 40%,
 * and the plan would be framed with its corners cut off.
 */
export function rotatedBounds(
  bounds: { min: Point2; max: Point2 },
  angleRad: number,
): { min: Point2; max: Point2 } {
  if (angleRad === 0) return bounds;
  const corners: Point2[] = [
    { x: bounds.min.x, y: bounds.min.y },
    { x: bounds.max.x, y: bounds.min.y },
    { x: bounds.max.x, y: bounds.max.y },
    { x: bounds.min.x, y: bounds.max.y },
  ].map((c) => rotatePoint(c, angleRad));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
