/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Which room is this point in", cached per model.
 *
 * `existingSpacesByStorey` re-reads every storey's spaces out of the STEP
 * source and rebuilds their world footprints — fine once, far too much to
 * repeat on every placement click. So the result is cached, and the cache is
 * invalidated by the authoring session's own version counter.
 *
 * # The session's rooms count too
 * A room created a moment ago lives in the mutation overlay, not in the parsed
 * file, and `existingSpacesByStorey` only sees it when the overlay is handed
 * in. It was not, and the consequence was measured in a screenflow: rooms
 * detected from traced walls, five devices placed into them one beat later,
 * and every device contained in the STOREY. The room was right there on screen
 * and the file said nothing about it.
 *
 * # Why the cache needs a stamp and not just the store object
 * The store object is stable for the life of a loaded model, so a WeakMap keyed
 * on it alone would answer with the room set as it was before the session
 * created any rooms — the same staleness, one layer further in. `stamp` is the
 * viewer's `mutationVersion`, which changes on every authoring action.
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
import type { MutablePropertyView } from '@ifc-lite/mutations';
import { resolveContainingSpace } from './resolveContainingSpace';

interface CacheEntry {
  stamp: number;
  overlay: MutablePropertyView | null;
  value: Map<number, ExistingSpaceEntry[]>;
}

const cache = new WeakMap<object, CacheEntry>();

/**
 * Spaces per storey for this store, parsed plus authored.
 *
 * `stamp` is any number that changes when the overlay changes (the viewer
 * passes `mutationVersion`). Callers with no authoring session omit both and
 * get the parsed rooms with a permanent cache, as before.
 */
export function spacesByStorey(
  store: IfcDataStore,
  overlay?: MutablePropertyView | null,
  stamp = 0,
): Map<number, ExistingSpaceEntry[]> {
  const view = overlay ?? null;
  const cached = cache.get(store);
  if (cached && cached.stamp === stamp && cached.overlay === view) return cached.value;
  let built: Map<number, ExistingSpaceEntry[]>;
  try {
    built = existingSpacesByStorey(store, view ?? undefined);
  } catch {
    // A model whose spaces can't be read (no source buffer, unusual
    // representations) must not block placement — it just means no room can
    // be resolved, and callers fall back to the storey.
    built = new Map();
  }
  cache.set(store, { stamp, overlay: view, value: built });
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
  overlay?: MutablePropertyView | null,
  stamp = 0,
): number | null {
  if (!store) return null;
  const spaces = spacesByStorey(store, overlay, stamp).get(storeyExpressId);
  if (!spaces || spaces.length === 0) return null;
  return resolveContainingSpace([position[0], position[1]], spaces);
}
