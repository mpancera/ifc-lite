/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Finding things in the loaded model by NAME, for clips to point at.
 *
 * # Why by name and not by express id
 * The demo model is regenerated whenever the underlying data is corrected,
 * and express ids do not survive that. Names do: the storey called "00" is
 * the ground floor in every version of the file. A clip written against ids
 * would silently point at a different element after the next export, which is
 * the worst kind of wrong in a video -- it still plays.
 *
 * # Nothing here throws
 * A lookup that fails returns null, and the beat that asked simply does not
 * perform. A clip should degrade to a missing action, never to a stack trace
 * over a running recorder; the fault surfaces on the end card instead.
 */

import type { EntityRef, ViewerState } from '@/store';

/** Case- and whitespace-insensitive, because storey names carry stray spaces. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The storey with this name, searching every loaded model in insertion order.
 * A federated project can hold the same storey name twice (architecture and
 * services), and the first is the right answer: models load in the order the
 * clip loaded them, so it is the one the clip put there first.
 */
export function findStoreyByName(state: ViewerState, name: string): EntityRef | null {
  for (const [modelId, model] of state.models) {
    const store = model.ifcDataStore;
    const ids = store?.entityIndex?.byType?.get('IFCBUILDINGSTOREY');
    if (!ids) continue;
    for (const expressId of ids) {
      const storeyName = store?.entities?.getName?.(expressId);
      if (storeyName && sameName(storeyName, name)) return { modelId, expressId };
    }
  }
  return null;
}

/** Every storey name in load order -- for a clip that wants "the first one". */
export function listStoreyNames(state: ViewerState): string[] {
  const names: string[] = [];
  for (const model of state.models.values()) {
    const store = model.ifcDataStore;
    const ids = store?.entityIndex?.byType?.get('IFCBUILDINGSTOREY') ?? [];
    for (const expressId of ids) {
      const name = store?.entities?.getName?.(expressId);
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * The first entity of an IFC type across the loaded models, e.g. a smoke
 * sensor to click on. Pass the type as written in IFC; the index keys are
 * upper case and the lookup normalises for you.
 */
export function findFirstOfType(state: ViewerState, ifcType: string): EntityRef | null {
  const key = ifcType.toUpperCase();
  for (const [modelId, model] of state.models) {
    const ids = model.ifcDataStore?.entityIndex?.byType?.get(key);
    if (ids && ids.length > 0) return { modelId, expressId: ids[0] };
  }
  return null;
}

/** How many models carry parsed data -- the proof that federation happened. */
export function loadedModelCount(state: ViewerState): number {
  return [...state.models.values()].filter((m) => m.ifcDataStore).length;
}

/** No load in flight and at least `count` models parsed. */
export function modelsSettled(state: ViewerState, count = 1): boolean {
  return loadedModelCount(state) >= count && !state.loading && !state.geometryStreamingActive;
}
