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
 * The rule: THE MODEL-AWARE CHANNELS ARE THE SELECTION WHEN THEY HOLD ANYTHING;
 * the highlight is what we fall back on.
 *
 * Reading the highlight at all is what makes bulk picks work — "Select all
 * IfcColumn" and "Select same storey" write only global ids, and an action that
 * read the model-aware channels alone moved one of a hundred and thirteen lit
 * columns and reported success.
 *
 * Preferring the model-aware channels is what keeps a whole from being mistaken
 * for its parts. Clicking a curtain wall lights up its forty panes, because a
 * whole that only aggregates carries no mesh and would otherwise be invisible —
 * but the selection is one curtain wall, and that is what the model-aware
 * channel says. Unioning the two would report forty-one.
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

  for (const str of s.selectedEntitiesSet) {
    const ref = stringToEntityRef(str);
    // `stringToEntityRef` answers -1 for a malformed key rather than throwing;
    // passing that on would have a caller edit express id -1.
    if (ref.expressId > 0) byKey.set(str, ref);
  }
  for (const ref of s.selectedEntities) {
    if (ref.expressId > 0) byKey.set(key(ref), ref);
  }
  if (byKey.size > 0) return [...byKey.values()];

  // Nothing model-aware was recorded: fall back to what is lit up.
  for (const globalId of s.selectedEntityIds ?? []) {
    const ref = s.resolveGlobalIdFromModels?.(globalId) ?? s.fromGlobalId?.(globalId);
    // A highlight whose model has been unloaded resolves to nothing. Dropping
    // it is right: an edit cannot reach an entity no longer here.
    if (ref && ref.expressId > 0) byKey.set(key(ref), ref);
  }
  if (byKey.size > 0) return [...byKey.values()];

  if (s.selectedEntity && s.selectedEntity.expressId > 0) {
    byKey.set(key(s.selectedEntity), s.selectedEntity);
  }
  return [...byKey.values()];
}
