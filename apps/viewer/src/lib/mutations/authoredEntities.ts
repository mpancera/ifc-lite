/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Overlay-created entities as they stand *now*.
 *
 * `MutablePropertyView.getNewEntities()` returns each entity with the
 * attributes it was created with. Later edits do not go back into that record —
 * they live in two OTHER maps: `setPositionalAttribute` writes by index,
 * `setAttribute` writes by name (`'Description'`, `'Name'`, …). So an entity
 * that was created and then edited reads back stale from `getNewEntities()`,
 * while the STEP exporter (which merges all three) writes the edited values. A
 * reader that skips the merge therefore disagrees with the file it exports.
 *
 * Both edit channels are real and in daily use: the zone panel writes
 * positionally, the properties panel and list cells write by name. Merging only
 * one is how a renamed zone shows its old name in half the UI.
 *
 * `placement-core` already merges the two for the single entity it walks; this
 * does the same for the whole set, which is what any feature that scans
 * authored entities by type needs — zones, systems, relationships.
 *
 * Cost is one array copy per *edited* entity: untouched entities are handed
 * back as they are.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';

/**
 * Where each named `IfcRoot` attribute sits in the STEP argument list.
 * `Tag` is `IfcElement`'s, at 7 — the same table the list overlay uses.
 */
const ATTR_INDEX: Readonly<Record<string, number>> = {
  GlobalId: 0, Name: 2, Description: 3, ObjectType: 4, Tag: 7,
};

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
    const positional = view.getPositionalMutationsForEntity(entity.expressId);
    const named = view.getAttributeMutationsForEntity(entity.expressId);
    if ((!positional || positional.size === 0) && named.length === 0) {
      out.push(entity);
      continue;
    }

    const attributes = entity.attributes.slice();
    if (positional) {
      for (const [index, value] of positional) attributes[index] = value;
    }
    // Named edits last: they are the later channel in every flow that uses
    // both (author a zone positionally, then retype its Description in a
    // list cell), and an attribute the caller named explicitly is the more
    // specific statement of intent.
    for (const { name, value } of named) {
      const index = ATTR_INDEX[name];
      if (index !== undefined) attributes[index] = value;
    }
    out.push({ expressId: entity.expressId, type: entity.type, attributes });
  }

  return out;
}
