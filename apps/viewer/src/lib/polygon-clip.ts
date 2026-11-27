/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Canonical IFC edit logic shared with the headless modelling API (#6232).
export * from '../../../../packages/create/src/in-store/edit/polygon-clip.js';

import type { Point2D } from '../../../../packages/create/src/in-store/edit/polygon-clip.js';

/**
 * Fork: is `p` strictly inside `polygon` (ray-cast). Kept here for the fork's
 * placement and room-lookup code after upstream moved this module to
 * `@ifc-lite/create` without it.
 */
export function pointInPolygon(polygon: Point2D[], p: Point2D): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  let j = polygon.length - 1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      (a[1] > p[1]) !== (b[1] > p[1]) &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] + 1e-12) + a[0];
    if (intersects) inside = !inside;
    j = i;
  }
  return inside;
}
