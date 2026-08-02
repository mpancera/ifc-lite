/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Which room is this point in", cached per model.
 *
 * `existingSpacesByStorey` re-reads every storey's spaces out of the STEP
 * source and rebuilds their world footprints — fine once, far too much to
 * repeat on every placement click. The result only changes when the parsed
 * file changes, so it is cached against the store object itself: a newly
 * loaded model is a new object and gets a fresh entry, and nothing has to
 * remember to invalidate.
 *
 * Coordinate frames line up: `existingSpacesByStorey` returns polygons in
 * model-world metres (placement frame applied, length unit scaled), and a
 * placement position arrives as model-world XY metres via
 * `rendererPointToIfcStoreyLocal` (only its Z is storey-relative). A
 * georeferenced, rotated building is therefore handled without special
 * casing — the same rotation is baked into both sides.
 */

import { existingSpacesByStorey, type ExistingSpaceEntry } from '@ifc-lite/create';
import type { IfcDataStore } from '@ifc-lite/parser';
import { resolveContainingSpace } from './resolveContainingSpace';

const cache = new WeakMap<object, Map<number, ExistingSpaceEntry[]>>();

/** Spaces per storey for this store, computed once per loaded model. */
export function spacesByStorey(store: IfcDataStore): Map<number, ExistingSpaceEntry[]> {
  const cached = cache.get(store);
  if (cached) return cached;
  let built: Map<number, ExistingSpaceEntry[]>;
  try {
    built = existingSpacesByStorey(store);
  } catch {
    // A model whose spaces can't be read (no source buffer, unusual
    // representations) must not block placement — it just means no room can
    // be resolved, and callers fall back to the storey.
    built = new Map();
  }
  cache.set(store, built);
  return built;
}

/**
 * The `IfcSpace` on `storeyExpressId` containing `position` (model-world XY
 * metres), or `null` when the storey has no spaces, none contain the point
 * (a corridor with no modelled room), or the spaces can't be read.
 */
export function resolveSpaceForPlacement(
  store: IfcDataStore | null | undefined,
  storeyExpressId: number,
  position: readonly [number, number, number],
): number | null {
  if (!store) return null;
  const spaces = spacesByStorey(store).get(storeyExpressId);
  if (!spaces || spaces.length === 0) return null;
  return resolveContainingSpace([position[0], position[1]], spaces);
}
