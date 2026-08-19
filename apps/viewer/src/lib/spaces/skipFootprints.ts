/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which rooms already on a storey should stop the detector emitting another
 * one on top of them.
 *
 * The generator skips a detected region whose centroid falls inside a footprint
 * it is handed. The question this answers is which footprints those are — and
 * the whole subtlety is the word "already".
 *
 * A room the user deleted this session is still in the parsed store: the
 * deletion is a tombstone in the overlay, not a rewrite of the source buffer.
 * Counting it would turn "delete the wrong rooms, then detect again" — the
 * ordinary way to redo a floor — into "detect again and get nothing", with no
 * explanation offered.
 */

// The detector's own point type — a parallel definition here would be one
// more place to keep in step with it.
import type { AutoSpaceVec2 as Vec2 } from '@ifc-lite/create';

/** An existing room as `existingSpacesByStorey` reports it. */
export interface ExistingRoom {
  readonly spaceExpressId: number;
  readonly polygon: Vec2[];
}

export function footprintsToSkip(
  existing: readonly ExistingRoom[],
  isDeleted: (expressId: number) => boolean,
): Vec2[][] {
  const out: Vec2[][] = [];
  for (const room of existing) {
    if (isDeleted(room.spaceExpressId)) continue;
    out.push(room.polygon);
  }
  return out;
}

export default footprintsToSkip;
