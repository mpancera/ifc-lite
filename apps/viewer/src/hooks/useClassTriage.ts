/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The active model's elements sitting on a class that says too little.
 *
 * The sibling of `useProxyTriage`, and deliberately the same shape: both feed
 * `lib/proxyTriage/proxyGroups`, so the panel that works one can work the
 * other. What differs is only which elements are collected — no class at all
 * there, a Zwischenklasse or an abstract class here.
 *
 * # Which classes, decided once per bucket
 * `entityIndex.byType` is already grouped by class, so the expensive question
 * ("is this class too generic") is asked once per bucket rather than once per
 * element. On a model with ten thousand pipe segments that is one lookup
 * instead of ten thousand.
 *
 * # Already-explained elements drop out
 * Same rule as the proxy triage: an `ObjectType` is the author saying what the
 * thing is. Whether they set it here or in their CAD, the question has been
 * answered and asking again is the nagging this is meant to remove.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import { extractAllEntityAttributes } from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';
import type { ProxyElement } from '@/lib/proxyTriage/proxyGroups';
import { genericClassKind, type GenericClassKind } from '@/lib/classTriage/genericClasses';
import { readOverlayRelations } from '@/lib/classTriage/overlayRelations';
import { useViewerStore } from '@/store';

/** `IfcObject.ObjectType` — index 4 for every product. See `useProxyTriage`. */
const OBJECT_TYPE_INDEX = 4;

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  return s === '$' || s === '*' ? '' : s;
}

function attribute(store: IfcDataStore, expressId: number, name: string): string {
  return text(extractAllEntityAttributes(store, expressId).find((a) => a.name === name)?.value);
}

function relatedName(
  store: IfcDataStore,
  expressId: number,
  relation: RelationshipType,
): string | null {
  const target = store.relationships?.getRelated(expressId, relation, 'inverse')?.[0];
  if (target === undefined) return null;
  return text(store.entities?.getName(target)) || null;
}

export interface ClassTriageSource {
  readonly elements: readonly ProxyElement[];
  readonly hasModel: boolean;
  /** Elements on a generic class whose author already said what they are. */
  readonly alreadyStated: number;
  /** Which of the two kinds each class in {@link elements} is. */
  readonly kindByClass: ReadonlyMap<string, GenericClassKind>;
}

export function useClassTriage(
  enabled: boolean,
  /** See {@link useProxyTriage} — a view change, not a write. */
  includeStated = false,
): ClassTriageSource {
  const models = useViewerStore((state) => state.models);
  const activeModelId = useViewerStore((state) => state.activeModelId);
  const mutationViews = useViewerStore((state) => state.mutationViews);
  // In-place overlay mutation: the Map identity never changes, so the version
  // counter is the only thing that can tell this memo an element was retyped.
  const mutationVersion = useViewerStore((state) => state.mutationVersion);

  return useMemo(() => {
    const model = (activeModelId ? models.get(activeModelId) : null)
      ?? [...models.values()][0];
    const store = model?.ifcDataStore;
    const empty = { elements: [], hasModel: !!store, alreadyStated: 0, kindByClass: new Map() };
    if (!enabled || !store || !model) return empty;

    const overlay = mutationViews.get(model.id);
    // What THIS session assigned wins over the parsed index, which never sees
    // overlay-authored relationships.
    const fresh = readOverlayRelations(
      overlay?.getNewEntities?.() ?? [],
      (id) => text(overlay?.getNewEntity?.(id)?.attributes?.[2])
        || text(store.entities?.getName(id)),
    );
    const elements: ProxyElement[] = [];
    const kindByClass = new Map<string, GenericClassKind>();
    let alreadyStated = 0;

    for (const [storageType, ids] of store.entityIndex?.byType ?? []) {
      if (ids.length === 0) continue;

      // The canonical name, the same way the tree and the inspector get it.
      const named = store.entities?.getTypeName(ids[0]);
      const canonical = named && named !== 'Unknown' ? named : storageType;
      const kind = genericClassKind(canonical);
      if (!kind) continue;
      kindByClass.set(canonical, kind);

      for (const expressId of ids) {
        // An element retyped in this session is no longer on this class, and
        // the overlay is where that shows first.
        const current = store.entities?.getTypeName(expressId);
        if (current && current !== 'Unknown' && genericClassKind(current) === null) continue;

        const stated = overlay?.getAttributeMutationsForEntity(expressId)
          ?.find((a) => a.name === 'ObjectType')?.value
          ?? store.getEntity?.(expressId)?.attributes?.[OBJECT_TYPE_INDEX];
        if (text(stated)) {
          alreadyStated += 1;
          if (!includeStated) continue;
        }

        elements.push({
          expressId,
          ifcClass: current && current !== 'Unknown' ? current : canonical,
          name: attribute(store, expressId, 'Name'),
          description: attribute(store, expressId, 'Description'),
          typeName: fresh.typeOf.get(expressId)
            ?? relatedName(store, expressId, RelationshipType.DefinesByType),
          system: fresh.systemOf.get(expressId)
            ?? relatedName(store, expressId, RelationshipType.AssignsToGroup),
          // Layer and shared geometry are deliberately not read here. They cost
          // a full walk of the raw entities, and on the models this targets the
          // class itself plus the type or system already cuts the pile — the
          // proxy triage needs them because a proxy has nothing else.
          layer: null,
          geometryKey: null,
        });
      }
    }

    return { elements, hasModel: true, alreadyStated, kindByClass };
  }, [enabled, includeStated, models, activeModelId, mutationViews, mutationVersion]);
}
