/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Overlay-created entities as they stand *now*.
 *
 * `MutablePropertyView.getNewEntities()` returns each entity with the
 * attributes it was created with. Later edits do not go back into that record —
 * `setPositionalAttribute` keeps its overrides in a separate map. So an entity
 * that was created and then edited reads back stale from `getNewEntities()`,
 * while the STEP exporter (which merges both) writes the edited values. A
 * reader that skips the merge therefore disagrees with the file it exports.
 *
 * `placement-core` already merges the two for the single entity it walks; this
 * does the same for the whole set, which is what any feature that scans
 * authored entities by type needs — zones, systems, relationships.
 *
 * Cost is one array copy per *edited* entity: untouched entities are handed
 * back as they are.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';

/** An overlay entity with its current attribute values. */
export interface AuthoredEntity {
  expressId: number;
  type: string;
  attributes: readonly unknown[];
}

/**
 * Every entity this session authored, with positional edits applied.
 *
 * Deleting an overlay entity drops it from the set outright (no tombstone —
 * tombstones are for entities that exist in the file), so there is nothing to
 * filter out here.
 */
export function authoredEntities(view: MutablePropertyView): AuthoredEntity[] {
  const out: AuthoredEntity[] = [];

  for (const entity of view.getNewEntities()) {
    const edits = view.getPositionalMutationsForEntity(entity.expressId);
    if (!edits || edits.size === 0) {
      out.push(entity);
      continue;
    }

    const attributes = entity.attributes.slice();
    for (const [index, value] of edits) attributes[index] = value;
    out.push({ expressId: entity.expressId, type: entity.type, attributes });
  }

  return out;
}
