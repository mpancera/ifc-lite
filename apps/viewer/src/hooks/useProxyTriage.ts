/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The active model's proxies, read into the shape the grouping needs.
 *
 * Six facts per element, from four different places in the file, because no
 * single one of them is present in every model — see `lib/proxyTriage` for
 * which axis carries what authority.
 *
 * # Only while the panel is open
 * Layer and shared-geometry membership are not indexed by the store, so both
 * are walked out of the raw entities. On a model with several thousand proxies
 * that is real work, and it would be wasted on every user who never opens the
 * triage. The `enabled` flag is the switch.
 *
 * # Elements already retyped drop out
 * The proxy list is taken from `entities.getTypeName`, which reflects the
 * mutation overlay. So an element decided in this session stops being a proxy
 * as soon as it is written, and the list shortens as the work gets done —
 * which is also what makes "wie viele noch" an honest number.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import { extractAllEntityAttributes } from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';
import type { ProxyElement } from '@/lib/proxyTriage/proxyGroups';
import { useViewerStore } from '@/store';

/** The class this whole feature is about. */
const PROXY_TYPE = 'IfcBuildingElementProxy';

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  return s === '$' || s === '*' ? '' : s;
}

/** A named attribute of an entity, overlay first so an edit shows at once. */
function attribute(
  store: IfcDataStore,
  expressId: number,
  name: string,
  overlay?: { getAttributeMutationsForEntity(id: number): Array<{ name: string; value: string }> },
): string {
  const mutated = overlay?.getAttributeMutationsForEntity(expressId)
    ?.find((a) => a.name === name)?.value;
  if (mutated !== undefined) return text(mutated);
  return text(extractAllEntityAttributes(store, expressId).find((a) => a.name === name)?.value);
}

/**
 * Attributes the named reader does not carry, taken by position.
 *
 * `extractAllEntityAttributes` returns `Name` and `Description` for a proxy
 * and nothing else — checked against a real model, where it gave two entries
 * for an entity holding nine. `ObjectType` and `Representation` are the two
 * this needs, and both sit at a fixed index for every descendant of
 * `IfcProduct`: `IfcRoot` contributes 0–3, `IfcObject` adds `ObjectType` at 4,
 * `IfcProduct` adds `ObjectPlacement` at 5 and `Representation` at 6. That
 * layout is the same in IFC2X3 and IFC4, which is what makes reading by
 * position safe here and nowhere near the end of the list.
 */
const OBJECT_TYPE_INDEX = 4;
const REPRESENTATION_INDEX = 6;

function positional(store: IfcDataStore, expressId: number, index: number): unknown {
  return store.getEntity?.(expressId)?.attributes?.[index];
}

/**
 * Element id to presentation-layer name.
 *
 * Walked backwards, from the 22-odd layers to their assigned items, rather
 * than forwards from every element: a layer names its members, an element does
 * not name its layer, and the backward walk is two orders of magnitude
 * shorter. The items a layer lists are REPRESENTATIONS, so the map is built
 * against representation ids and resolved per element afterwards.
 */
function layerNames(store: IfcDataStore): Map<number, string> {
  const byRepresentation = new Map<number, string>();
  for (const [type, ids] of store.entityIndex?.byType ?? []) {
    if (type.toUpperCase() !== 'IFCPRESENTATIONLAYERASSIGNMENT') continue;
    for (const id of ids) {
      const entity = store.getEntity?.(id);
      if (!entity?.attributes) continue;
      const name = text(entity.attributes[0]);
      if (!name) continue;
      for (const value of entity.attributes) {
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (typeof item === 'number') byRepresentation.set(item, name);
        }
      }
    }
  }
  return byRepresentation;
}

/**
 * The `IfcRepresentationMap` an element's shape is an instance of.
 *
 * Two elements pointing at one map are the same block placed twice — the only
 * statement of sameness in a file whose author gave no types. Elements whose
 * geometry is written out in full have no map and no answer here, which is
 * correct: nothing says they are alike.
 */
function blockOf(store: IfcDataStore, shapeId: number): string | null {
  const shape = store.getEntity?.(shapeId);
  if (!shape?.attributes) return null;
  for (const value of shape.attributes) {
    const representations = Array.isArray(value) ? value : [value];
    for (const repId of representations) {
      if (typeof repId !== 'number') continue;
      const representation = store.getEntity?.(repId);
      if (!representation?.attributes) continue;
      for (const items of representation.attributes) {
        if (!Array.isArray(items)) continue;
        for (const itemId of items) {
          if (typeof itemId !== 'number') continue;
          const item = store.getEntity?.(itemId);
          if (item?.type?.toUpperCase() !== 'IFCMAPPEDITEM') continue;
          const source = item.attributes?.find((a) => typeof a === 'number');
          if (typeof source === 'number') return `map-${source}`;
        }
      }
    }
  }
  return null;
}

/** Name of the first entity a relationship leads to, e.g. a type or a system. */
function relatedName(
  store: IfcDataStore,
  expressId: number,
  relation: RelationshipType,
): string | null {
  const ids = store.relationships?.getRelated(expressId, relation, 'inverse');
  const target = ids?.[0];
  if (target === undefined) return null;
  const name = store.entities?.getName(target);
  return text(name) || null;
}

export interface ProxyTriageSource {
  readonly elements: readonly ProxyElement[];
  /** Present so a panel can say "kein Modell geladen" rather than "keine Proxys". */
  readonly hasModel: boolean;
  /**
   * Proxies whose author already said what they are, and which are therefore
   * not in {@link elements}.
   *
   * Counted rather than dropped in silence: "3643 Proxys, davon 1 erklärt" is
   * a different model from "3642 Proxys", and the difference is the whole
   * point of letting an author declare one deliberately.
   */
  readonly alreadyStated: number;
}

export function useProxyTriage(enabled: boolean): ProxyTriageSource {
  const models = useViewerStore((state) => state.models);
  const activeModelId = useViewerStore((state) => state.activeModelId);
  const mutationViews = useViewerStore((state) => state.mutationViews);
  // The overlay is mutated IN PLACE, so `mutationViews` is the same Map object
  // before and after a write and cannot serve as a dependency. Without the
  // counter the list stayed at its opening length while elements were being
  // decided out of it — the one number the panel exists to move.
  const mutationVersion = useViewerStore((state) => state.mutationVersion);

  return useMemo(() => {
    const model = (activeModelId ? models.get(activeModelId) : null)
      ?? [...models.values()][0];
    const store = model?.ifcDataStore;
    if (!enabled || !store || !model) return { elements: [], hasModel: !!store, alreadyStated: 0 };

    const overlay = mutationViews.get(model.id);
    const layers = layerNames(store);

    const elements: ProxyElement[] = [];
    let alreadyStated = 0;
    for (const [type, ids] of store.entityIndex?.byType ?? []) {
      if (type.toUpperCase() !== 'IFCBUILDINGELEMENTPROXY') continue;
      for (const expressId of ids) {
        // The overlay's answer, so an element decided a moment ago is gone.
        const current = store.entities?.getTypeName(expressId);
        if (current && current !== 'Unknown' && current !== PROXY_TYPE) continue;

        // An `ObjectType` is the author saying what this is. Whether they set
        // it in this panel or in their CAD, the question has been answered and
        // asking again would be the nagging Marc asked this feature not to do.
        const stated = overlay?.getAttributeMutationsForEntity(expressId)
          ?.find((a) => a.name === 'ObjectType')?.value
          ?? positional(store, expressId, OBJECT_TYPE_INDEX);
        if (text(stated)) { alreadyStated += 1; continue; }

        const shape = positional(store, expressId, REPRESENTATION_INDEX);
        const shapeId = typeof shape === 'number' ? shape : null;
        elements.push({
          expressId,
          name: attribute(store, expressId, 'Name', overlay),
          description: attribute(store, expressId, 'Description', overlay),
          typeName: relatedName(store, expressId, RelationshipType.DefinesByType),
          system: relatedName(store, expressId, RelationshipType.AssignsToGroup),
          layer: shapeId === null ? null : layerOf(store, shapeId, layers),
          geometryKey: shapeId === null ? null : blockOf(store, shapeId),
        });
      }
    }

    return { elements, hasModel: true, alreadyStated };
  }, [enabled, models, activeModelId, mutationViews, mutationVersion]);
}

/** A shape's layer, via any of the representations the shape holds. */
function layerOf(
  store: IfcDataStore,
  shapeId: number,
  layers: ReadonlyMap<number, string>,
): string | null {
  const direct = layers.get(shapeId);
  if (direct) return direct;
  const shape = store.getEntity?.(shapeId);
  if (!shape?.attributes) return null;
  for (const value of shape.attributes) {
    const representations = Array.isArray(value) ? value : [value];
    for (const repId of representations) {
      if (typeof repId !== 'number') continue;
      const name = layers.get(repId);
      if (name) return name;
    }
  }
  return null;
}
