/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What is selected right now — from whichever channel it arrived through.
 *
 * There are THREE, and they are not the same store field:
 *
 * - `selectedEntitiesSet` — Ctrl/Shift-click in the viewport, in the hierarchy
 *   and in the result lists, i.e. every Explorer-style multi-select
 *   (`useEntityListMultiSelect`, `selectElementsInZone`). Keyed strings.
 * - `selectedEntities` — the array the unified-storey path and the properties
 *   panel fill.
 * - `selectedEntity` — a plain single click reaches neither of the above.
 *
 * An action that reads only one of them is not obviously broken, which is the
 * problem: it greys out while six walls are visibly highlighted, or it moves
 * one of them and reports success. Reading all three is the only honest answer
 * to "what did the user pick", so it lives in one place instead of being
 * rediscovered per panel.
 */

import { stringToEntityRef, type EntityRef } from './types.js';

/** Just the selection fields, so this stays testable without a store. */
export interface SelectionChannels {
  selectedEntity: EntityRef | null;
  selectedEntities: readonly EntityRef[];
  selectedEntitiesSet: ReadonlySet<string>;
}

const key = (ref: EntityRef) => `${ref.modelId}:${ref.expressId}`;

/**
 * Every selected entity, deduplicated, primary selection last.
 *
 * The primary is only a FALLBACK: while a multi-selection exists it is one of
 * its members anyway, and promoting it would reorder the result for no reason.
 */
export function selectedEntityRefs(s: SelectionChannels): EntityRef[] {
  const byKey = new Map<string, EntityRef>();
  for (const str of s.selectedEntitiesSet) {
    const ref = stringToEntityRef(str);
    // `stringToEntityRef` answers -1 for a malformed key rather than throwing;
    // passing that on would have a caller edit express id -1.
    if (ref.expressId > 0) byKey.set(str, ref);
  }
  for (const ref of s.selectedEntities) {
    if (ref.expressId > 0) byKey.set(key(ref), ref);
  }
  if (byKey.size === 0 && s.selectedEntity && s.selectedEntity.expressId > 0) {
    byKey.set(key(s.selectedEntity), s.selectedEntity);
  }
  return [...byKey.values()];
}
