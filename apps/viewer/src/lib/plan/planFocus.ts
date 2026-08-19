/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Bringing one element into the middle of the plan, without changing the zoom.
 *
 * Framing (fit the element to the window) is the wrong move for working down a
 * list: every row would jump to a different scale, so the drawing never settles
 * and the reader loses the sense of size they had a second ago. Panning keeps
 * the scale and moves the paper, which is what somebody does by hand.
 */

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface PlanTransform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation?: number;
}

/** Bounding box of a set of points, or `null` for none. */
export function boundsOf(points: readonly Point2D[]): {
  min: Point2D; max: Point2D; centre: Point2D;
} | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

/**
 * The transform that puts `point` in the middle of a `width × height` view,
 * keeping the scale and the rotation of the one passed in.
 *
 * The forward mapping is `screen = rotate(world · scale) + offset`, the exact
 * inverse of `planScreenToDrawing`; solving it for the offset that lands the
 * point on the centre is this.
 */
export function centreOn(
  transform: PlanTransform,
  point: Point2D,
  width: number,
  height: number,
): PlanTransform {
  const rotation = transform.rotation ?? 0;
  const sx = point.x * transform.scale;
  const sy = point.y * transform.scale;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const rx = rotation === 0 ? sx : sx * c - sy * s;
  const ry = rotation === 0 ? sy : sx * s + sy * c;
  return { ...transform, x: width / 2 - rx, y: height / 2 - ry };
}

export default centreOn;
