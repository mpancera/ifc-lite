/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Resolves which existing `IfcSpace` (if any) contains a 2D placement
 * point — the geometric half of F5's auto "is in space" relation. Pair
 * with `@ifc-lite/create`'s `existingSpacesByStorey(store).get(storeyId)`
 * for the `spaces` argument.
 *
 * Not yet wired into the Add Element flow: today's builders (`sensor.ts`,
 * `library-element.ts`) always contain new elements in the *storey* via
 * `IfcRelContainedInSpatialStructure`. Retargeting that to the resolved
 * space when one is found is a small, well-understood change (standard
 * IFC usage — an element can be directly contained in an `IfcSpace`
 * instead of its storey) but changes what F3 already ships, so it's held
 * back pending review rather than silently altered.
 */

import { pointInPolygon, type Point2D } from '@/lib/polygon-clip';
import type { ExistingSpaceEntry } from '@ifc-lite/create';

/**
 * Returns the `spaceExpressId` of the first space entry whose polygon
 * contains `point`, or `null` if the point falls in none of them (e.g.
 * a corridor with no modelled `IfcSpace`, or a storey with none at all).
 * Spaces are not expected to overlap; the first match wins if they do.
 */
export function resolveContainingSpace(
  point: Point2D,
  spaces: readonly ExistingSpaceEntry[],
): number | null {
  for (const entry of spaces) {
    if (pointInPolygon(entry.polygon as Point2D[], point)) {
      return entry.spaceExpressId;
    }
  }
  return null;
}
