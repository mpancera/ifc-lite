/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading one element's facts out of a loaded model, for the magic wand.
 *
 * Split from `criteria.ts` on purpose: the matching is pure and tested against
 * a fact table, and this is the half that knows where each fact lives in an
 * IFC store. Every read here is per element and lazy — `collectSmartSelection`
 * decides what it needs and in which order.
 */

import { RelationshipType } from '@ifc-lite/data';
import { extractAllMaterialsOnDemand, type IfcDataStore } from '@ifc-lite/parser';
import { lensMaterialNames } from '@/lib/lens-material-names';
import { resolveEntityPredefinedType } from '@/lib/entity-predefined-type';
import type { Fact, SmartCriterion, SmartSelectSources } from './criteria';

/**
 * The elements the wand may return: everything with geometry.
 *
 * The wand is driven by clicking a thing in the view, so what it hands back
 * should be things that could have been clicked. Openings, type objects and
 * the spatial skeleton carry no mesh and stay out — including them would grow
 * the answer with entities the user cannot see selected.
 */
function* pickableElements(store: IfcDataStore): Generator<number> {
  const entities = store.entities;
  for (let i = 0; i < entities.count; i++) {
    // `hasGeometry` takes an EXPRESS ID, not the row index — the columnar
    // arrays are indexed, the accessors are not. Feeding it `i` answers false
    // for nearly everything, which reads as "nothing else is the same".
    const expressId = entities.expressId[i];
    if (!entities.hasGeometry(expressId)) continue;
    yield expressId;
  }
}

export function smartSelectSources(store: IfcDataStore): SmartSelectSources {
  const hierarchy = store.spatialHierarchy;
  const relationships = store.relationships;

  const fact = (expressId: number, criterion: SmartCriterion): Fact => {
    switch (criterion) {
      case 'class':
        return store.entities.getTypeName(expressId) || null;
      case 'storey':
        return hierarchy?.elementToStorey.get(expressId) ?? null;
      case 'room':
        return hierarchy?.getContainingSpace(expressId) ?? null;
      case 'type': {
        // Through the relationship graph rather than the columnar
        // `definedByType`, which the IFCX path never fills.
        const types = relationships?.getRelated(expressId, RelationshipType.DefinesByType, 'inverse');
        return types && types.length > 0 ? types[0] : null;
      }
      case 'predefinedType':
        return resolveEntityPredefinedType(store, expressId) ?? null;
      case 'material': {
        // The NAMES, sorted and joined: two walls with the same layers in the
        // same file still point at different material entities, and a layer
        // set that lists its layers in another order is the same build-up.
        const names = extractAllMaterialsOnDemand(store, expressId).flatMap(lensMaterialNames);
        if (names.length === 0) return null;
        return [...new Set(names)].sort().join(' | ');
      }
    }
  };

  // A FRESH generator per iteration: handing out one generator object would
  // make the second click of a session scan an exhausted iterator and answer
  // "nothing else is the same".
  return { candidates: { [Symbol.iterator]: () => pickableElements(store) }, fact };
}
