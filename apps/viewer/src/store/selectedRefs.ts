/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What is selected right now — from whichever channel it arrived through.
 *
 * There are FOUR, and they are not the same store field:
 *
 * - `selectedEntityIds` — global ids, the set the RENDERER highlights. Every
 *   bulk pick that came from somewhere other than a list writes here: "Select
 *   all IfcColumn" and "Select same storey" in the context menu, the compare
 *   panel's rows, a group's members.
 * - `selectedEntitiesSet` — Ctrl/Shift-click in the viewport, in the hierarchy
 *   and in the result lists, i.e. every Explorer-style multi-select
 *   (`useEntityListMultiSelect`, `selectElementsInZone`). Keyed strings.
 * - `selectedEntities` — the array the unified-storey path and the properties
 *   panel fill.
 * - `selectedEntity` — a plain single click reaches none of the above.
 *
 * The convention is that a bulk selection drives the highlight channel AND the
 * model-aware one; several producers only ever managed the first. Rather than
 * chase each of them, this reads what the user can SEE selected — the highlight
 * is the promise the screen makes — and resolves it back to model-local refs.
 *
 * An action that reads one channel is not obviously broken, which is the
 * problem: it greys out while six walls are lit up, or it moves one of a
 * hundred and thirteen highlighted columns and reports success.
 */

import { stringToEntityRef, type EntityRef } from './types.js';

/** Just the selection fields, so this stays testable without a store. */
export interface SelectionChannels {
  selectedEntity: EntityRef | null;
  selectedEntities: readonly EntityRef[];
  selectedEntitiesSet: ReadonlySet<string>;
  /** Renderer-space ids; needs one of the resolvers below to be usable. */
  selectedEntityIds?: ReadonlySet<number>;
  /** The store's canonical resolver — sees overlay-allocated ids too. */
  resolveGlobalIdFromModels?: (globalId: number) => EntityRef | null;
  /** The federation registry's, for a model that left `models` but is still
   *  registered. Consulted only when the canonical one comes up empty. */
  fromGlobalId?: (globalId: number) => EntityRef | null;
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

  for (const globalId of s.selectedEntityIds ?? []) {
    const ref = s.resolveGlobalIdFromModels?.(globalId) ?? s.fromGlobalId?.(globalId);
    // A highlight whose model has been unloaded resolves to nothing. Dropping
    // it is right: an edit cannot reach an entity no longer here.
    if (ref && ref.expressId > 0) byKey.set(key(ref), ref);
  }
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
