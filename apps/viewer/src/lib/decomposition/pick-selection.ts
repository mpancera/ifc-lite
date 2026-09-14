/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a click in the viewport should actually select.
 *
 * The picker answers with the mesh under the cursor, which for a curtain wall
 * is an `IfcPlate` and for a stair an `IfcStairFlight`. Almost nobody means the
 * pane; they mean the wall. The tree already resolves it this way — a click on
 * a decomposing assembly there selects the whole and its parts together
 * (upstream #1133) — so today the same element answers differently depending on
 * where it was clicked. This makes the viewport agree with the tree.
 *
 * # Why the parts come along
 *
 * A whole that only aggregates carries no mesh of its own. Highlighting it
 * alone would light up nothing at all, so the parts are what the renderer gets
 * — exactly what the tree does for the same reason.
 *
 * But the parts are NOT the selection: they are how an invisible thing is shown.
 * So the model-aware channel gets the WHOLE and nothing else, and a tool acting
 * on the selection acts on one curtain wall rather than on forty panes. The
 * status bar says "1 gewählt", which is the truth of what was picked.
 *
 * # Alt or Shift means what you clicked
 *
 * Two modifiers, not one. Shift is what other viewers use and what a user
 * reaches for first; Alt is the fallback for the window managers that swallow
 * it. Neither collides: Shift+DRAG pans, but this runs on a click that did not
 * move, and Alt is unbound in the mouse path.
 */

import { collectAggregatedDescendants, RelationshipType } from '@ifc-lite/data';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import type { EntityRef } from '@/store/types';
import { SPATIAL_STRUCTURE_TYPES } from './whole-of';
import { liftToWholes } from './lift-to-whole';

export interface PickSelection {
  /** The element the properties panel and every tool should see. */
  ref: EntityRef;
  /** Renderer-space ids to highlight: the whole plus whatever carries its mesh. */
  globalIds: number[];
}

/** What the model can answer about one element, for {@link pickSelectionFor}. */
export interface DecompositionLookup {
  /** The aggregate parent as the file states it — spatial parents included. */
  aggregateParentOf: (expressId: number) => number | null;
  typeOf: (expressId: number) => string | null;
  /** Everything the whole decomposes into, at any depth. */
  descendantsOf: (expressId: number) => number[];
  toGlobal: (expressId: number) => number;
}

/**
 * The resolution itself, over callbacks rather than a store.
 *
 * Answers the picked element unchanged when it is nobody's part — which is
 * most clicks — so the caller can keep its plain single-selection path for
 * that case and never pays for the walk.
 */
export function pickSelectionFor(
  local: EntityRef,
  lookup: DecompositionLookup,
  opts: { exact: boolean } = { exact: false },
): PickSelection {
  const self: PickSelection = { ref: local, globalIds: [lookup.toGlobal(local.expressId)] };
  if (opts.exact) return self;

  const { targets } = liftToWholes([local.expressId], (id) => {
    const parent = lookup.aggregateParentOf(id);
    // Site, building and storey decompose through the same relation. Walking
    // into them would "select" the storey when a wall was clicked.
    if (parent === null) return null;
    return SPATIAL_STRUCTURE_TYPES.has(lookup.typeOf(parent) ?? '') ? null : parent;
  });

  const whole = targets[0] ?? local.expressId;
  if (whole === local.expressId) return self;

  // The whole goes LAST: `setSelectedEntityIds` keys the primary highlight off
  // the final id, the same trick the tree uses to keep the assembly row lit.
  return {
    ref: { modelId: local.modelId, expressId: whole },
    globalIds: [...lookup.descendantsOf(whole).map(lookup.toGlobal), lookup.toGlobal(whole)],
  };
}

/**
 * Resolve a picked global id into the selection it stands for.
 *
 * Returns `null` when the id resolves to no loaded model — the caller then
 * falls back to its plain single-selection path.
 */
export function resolvePickSelection(
  globalId: number,
  opts: { exact: boolean } = { exact: false },
): PickSelection | null {
  const state = useViewerStore.getState();
  const local = state.resolveGlobalIdFromModels(globalId) ?? state.fromGlobalId(globalId);
  if (!local) return null;

  const ref: EntityRef = { modelId: local.modelId, expressId: local.expressId };
  const dataStore = state.models.get(local.modelId)?.ifcDataStore;
  if (!dataStore) return { ref, globalIds: [globalId] };

  const relationships = dataStore.relationships;
  return pickSelectionFor(ref, {
    aggregateParentOf: (id) => {
      const parents = relationships?.getRelated(id, RelationshipType.Aggregates, 'inverse') ?? [];
      return parents.length > 0 ? parents[0] : null;
    },
    typeOf: (id) => dataStore.entities?.getTypeName?.(id) ?? null,
    descendantsOf: (id) => collectAggregatedDescendants(relationships, id),
    toGlobal: (id) => toGlobalIdFromModels(state.models, local.modelId, id),
  }, opts);
}
