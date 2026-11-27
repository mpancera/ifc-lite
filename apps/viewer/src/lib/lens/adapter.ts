/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Creates a {@link LensDataProvider} from the viewer's data sources.
 *
 * Bridges the abstract provider interface to IfcDataStore + federation:
 * - Multi-model: iterates all models, translates global IDs
 * - Legacy single-model: uses offset = 0
 */

import type { LensDataProvider, PropertySetInfo, ClassificationInfo } from '@ifc-lite/lens';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';
import {
  extractEntityAttributesOnDemand,
  extractTypePropertiesOnDemand,
  extractTypeQuantitiesOnDemand,
  extractClassificationsOnDemand,
  extractMaterialsOnDemand,
  extractAllMaterialsOnDemand,
  mergeInheritedPropertySets,
  mergeInheritedQuantitySets,
} from '@ifc-lite/parser';
import { resolveCapturedEntityScope, resolveEntityPredefinedType } from '@ifc-lite/rules';
import { lensMaterialNames } from '@ifc-lite/rules';
import {
  ownPropertySetsFor,
  typePropertySetsFor,
  quantitySetsFor,
  mutatedAttributeValue,
} from '@ifc-lite/rules';
import { toGlobalIdFromModels } from '@/store/globalId';
import { readZones } from '@/lib/ifcZones/membership';
import { themeOfZone } from '@/lib/ifcZones/themes';
import { authoredEntities } from '@/lib/mutations/authoredEntities';
import { groupBucketValue } from '@ifc-lite/lens';
import type { FederatedModel } from '@/store/types';
import { computeMaxExpressId, effectiveRows, resolveGlobalId, type ModelEntry, type ModelRef } from './adapter-entities.js';
import { effectiveGroupIds, effectiveGroupRecord, effectiveGroups, type EffectiveGroups } from './adapter-groups.js';

/** `expressId`'s type-inherited psets, mutation-aware (#5207); mirrors
 *  `filter-evaluate.ts`'s `getInheritedTypePsets`. */
function resolveTypePropertySets(
  store: IfcDataStore,
  expressId: number,
  mutationView: MutablePropertyView | undefined,
): PropertySetInfo[] {
  if (!store.relationships) return [];
  const typeIds = store.relationships.getRelated(expressId, RelationshipType.DefinesByType, 'inverse');
  if (typeIds.length === 0) return [];
  const typeId = typeIds[0];
  const base = (store.source && store.source.length > 0
    ? extractTypePropertiesOnDemand(store, expressId)?.properties ?? []
    : (store.properties?.getForEntity?.(typeId) ?? [])) as Parameters<typeof typePropertySetsFor>[0];
  return typePropertySetsFor(base, typeId, mutationView) as PropertySetInfo[];
}

/** An authored entity the overlay contributes, indexed by federated global id. */
interface OverlayEntity {
  type: string;
  attributes: unknown[];
  modelId: string;
  expressId: number;
}

/** Positional index of each named attribute in an `IfcRoot`-derived entity. */
const OVERLAY_ATTR_INDEX: Record<string, number> = {
  GlobalId: 0, Name: 2, Description: 3, ObjectType: 4, Tag: 7,
};

/**
 * Create a LensDataProvider for the viewer's federated models.
 *
 * @param models - Loaded federated models (may be empty in legacy mode)
 * @param legacyDataStore - Single-model data store (fallback)
 * @param mutationViews - Live per-model overlay, keyed by model id (#5207);
 *   omitted or missing an entry reads base-only, unchanged from before.
 * @param resolveRef - The viewer store's `resolveGlobalIdFromModels` callback.
 *   Live federated callers pass it so overlay-allocated ids above a model's
 *   parsed range resolve back to that model. Source-only callers may omit it.
 */
export function createLensDataProvider(
  models: Map<string, FederatedModel>,
  legacyDataStore: IfcDataStore | null,
  mutationViews?: ReadonlyMap<string, MutablePropertyView>,
  resolveRef?: (globalId: number) => ModelRef | null,
): LensDataProvider {
  // Build a flat array for fast iteration
  const entries: ModelEntry[] = [];
  if (models.size > 0) {
    for (const [, model] of models) {
      if (model.ifcDataStore) {
        entries.push({
          id: model.id,
          name: model.name,
          ifcDataStore: model.ifcDataStore,
          idOffset: model.idOffset ?? 0,
          maxExpressId: model.maxExpressId ?? 0,
          mutationView: mutationViews?.get(model.id),
        });
      }
    }
  } else if (legacyDataStore) {
    entries.push({
      id: 'legacy',
      name: 'Model',
      ifcDataStore: legacyDataStore,
      idOffset: 0,
      maxExpressId: computeMaxExpressId(legacyDataStore),
      mutationView: mutationViews?.get('legacy'),
    });
  }

  const groupOverlays = new Map<string, EffectiveGroups | null>();

  // Fork: zones painted this session (overlay), per model, and their colours.
  const paintedZones = new Map<string, Set<number>>();
  const paintedZoneIds = (modelId: string, view: MutablePropertyView | undefined): Set<number> => {
    let ids = paintedZones.get(modelId);
    if (!ids) {
      ids = new Set(view ? readZones(authoredEntities(view)).map((zone) => zone.expressId) : []);
      paintedZones.set(modelId, ids);
    }
    return ids;
  };
  let zoneColourByValue: Map<string, string> | null = null;
  const zoneColours = (): Map<string, string> => {
    if (zoneColourByValue) return zoneColourByValue;
    zoneColourByValue = new Map();
    for (const view of mutationViews?.values() ?? []) {
      for (const zone of readZones(authoredEntities(view))) {
        if (!zone.colour) continue;
        const ref = { id: zone.expressId, name: zone.name || undefined, type: 'IfcZone', objectType: zone.objectType || undefined };
        zoneColourByValue.set(groupBucketValue(ref), zone.colour);
      }
    }
    return zoneColourByValue;
  };

  // Lens evaluation reads several fields inside forEachEntity's callback.
  // Carry that exact model-local ref through the callback so a million-row
  // lens does not ask modelSlice to sort the federation for every field read.
  const current = { entry: null as unknown as ModelEntry, expressId: 0 };
  let currentGlobalId: number | null = null;
  const resolve = (globalId: number) => currentGlobalId === globalId
    ? current
    : resolveGlobalId(globalId, entries, models.size > 0 ? resolveRef : undefined);

  return {
    resolveCapturedScope(scope) {
      const candidates = resolveCapturedEntityScope(scope, [...models].map(([id, model]) => ({
        id, filterIdentity: model.sourceFingerprint, sourceContentHash: model.sourceContentHash,
        store: model.ifcDataStore, mutationView: mutationViews?.get(id),
      })));
      return new Set([...candidates].flatMap(([modelId, ids]) => [...ids].map(id => toGlobalIdFromModels(models, modelId, id))));
    },
    getEntityCount(): number {
      let count = 0;
      for (const entry of entries) {
        for (const _row of effectiveRows(entry)) count++;
      }
      return count + overlayById.size;
    },

    forEachEntity(callback: (globalId: number, modelId: string) => void): void {
      const models = new Map(entries.map((entry) => [entry.id, { idOffset: entry.idOffset }]));
      for (const entry of entries) {
        for (const { expressId } of effectiveRows(entry)) {
          const globalId = toGlobalIdFromModels(models, entry.id, expressId);
          currentGlobalId = globalId;
          current.entry = entry;
          current.expressId = expressId;
          callback(globalId, entry.id);
        }
      }
      for (const [globalId, authored] of overlayById) callback(globalId, authored.modelId);
    },

    getEntityType(globalId: number): string | undefined {
      const resolved = resolve(globalId);
      if (!resolved) return undefined;
      const { mutationView, ifcDataStore } = resolved.entry;
      return mutationView?.getEntityTypeMutation(resolved.expressId)?.newType
        ?? mutationView?.getNewEntity(resolved.expressId)?.type
        ?? ifcDataStore.entities?.getTypeName?.(resolved.expressId);
    },

    getPropertyValue(
      globalId: number,
      propertySetName: string,
      propertyName: string,
    ): unknown {
      const resolved = resolve(globalId);
      if (!resolved) return undefined;
      const { ifcDataStore: store, mutationView } = resolved.entry;
      const id = resolved.expressId;
      const findValue = (psets: PropertySetInfo[]): unknown => {
        for (const pset of psets) {
          if (pset.name !== propertySetName) continue;
          for (const prop of pset.properties) {
            if (prop.name === propertyName) return prop.value;
          }
        }
        return undefined;
      };

      // Mutation-aware (#5207) via filter-evaluate-mutations.ts's
      // ownPropertySetsFor, which handles both extraction modes internally.
      if (mutationView || (store.onDemandPropertyMap && store.source?.length > 0)) {
        const own = findValue(ownPropertySetsFor(store, id, mutationView) as PropertySetInfo[]);
        if (own !== undefined) return own;
        // Type-inherited (Pset_*Common is typically on IfcSpaceType/IfcWallType).
        return findValue(resolveTypePropertySets(store, id, mutationView));
      }

      return store.properties?.getPropertyValue?.(id, propertySetName, propertyName);
    },

    getPropertySets(globalId: number): PropertySetInfo[] {
      const resolved = resolve(globalId);
      if (!resolved) return [];
      const { ifcDataStore: store, mutationView } = resolved.entry;
      const id = resolved.expressId;

      // Properties are extracted lazily — the pre-built table is empty unless
      // server-parsed, falling back to the eager table when no on-demand map
      // exists. Mutation-aware (#5207) via ownPropertySetsFor. Instance
      // properties win per PROPERTY, not per set (#1913).
      if (mutationView || (store.onDemandPropertyMap && store.source?.length > 0)) {
        const instancePsets = ownPropertySetsFor(store, id, mutationView) as PropertySetInfo[];
        return mergeInheritedPropertySets(instancePsets, resolveTypePropertySets(store, id, mutationView));
      }

      const psets = store.properties?.getForEntity?.(id);
      if (!psets) return [];
      return psets as PropertySetInfo[];
    },

    getEntityAttribute(globalId: number, attrName: string): string | undefined {
      const resolved = resolve(globalId);
      if (!resolved) return undefined;
      const { ifcDataStore: store, mutationView } = resolved.entry;
      const id = resolved.expressId;

      // Live edit wins (#5207), same lookup filter-evaluate.ts uses.
      const edited = mutatedAttributeValue(mutationView, id, attrName);
      if (edited !== undefined) return edited;

      // Fast path: columnar attributes stored during initial parse
      switch (attrName) {
        case 'Name':
          return store.entities.getName(id) || undefined;
        case 'Description': {
          const desc = store.entities.getDescription?.(id);
          if (desc) return desc;
          break;
        }
        case 'ObjectType': {
          const ot = store.entities.getObjectType?.(id);
          if (ot) return ot;
          break;
        }
        case 'PredefinedType':
          // No columnar accessor — resolve from the source buffer (#1364).
          return resolveEntityPredefinedType(store, id);
        case 'Tag':
          // Tag is not stored in columnar — always on-demand
          break;
        case 'GlobalId':
          return store.entities.getGlobalId(id) || undefined;
        case 'Type':
          return store.entities.getTypeName?.(id) || undefined;
      }

      // Slow path: on-demand extraction from source buffer
      if (store.source?.length > 0 && store.entityIndex) {
        const attrs = extractEntityAttributesOnDemand(store, id);
        switch (attrName) {
          case 'Name': return attrs.name || undefined;
          case 'Description': return attrs.description || undefined;
          case 'ObjectType': return attrs.objectType || undefined;
          case 'Tag': return attrs.tag || undefined;
        }
      }
      return undefined;
    },

    getQuantityValue(
      globalId: number,
      qsetName: string,
      quantName: string,
    ): number | string | undefined {
      const resolved = resolve(globalId);
      if (!resolved) return undefined;
      const { ifcDataStore: store, mutationView } = resolved.entry;
      const id = resolved.expressId;
      const findIn = (qsets: ReadonlyArray<{ name: string; quantities: ReadonlyArray<{ name: string; value: number | string }> }>) => {
        for (const qset of qsets) {
          if (qset.name !== qsetName) continue;
          for (const q of qset.quantities) {
            if (q.name === quantName) return q.value;
          }
        }
        return undefined;
      };

      // Mutation-aware occurrence read (#5207). Type-inherited quantities
      // stay base-only below: search's own qtysFor has no type-quantity
      // overlay to mirror, so this doesn't out-run that model.
      const own = findIn(quantitySetsFor(store, id, mutationView));
      if (own !== undefined) return own;

      // Type-inherited qsets (Qto_*BaseQuantities is sometimes attached to
      // the IfcTypeProduct rather than the occurrence) — base-only.
      if (store.onDemandQuantityMap && store.source?.length > 0) {
        const typeQtys = extractTypeQuantitiesOnDemand(store, id);
        return typeQtys ? findIn(typeQtys.quantities) : undefined;
      }
      const typeIds = store.relationships?.getRelated(id, RelationshipType.DefinesByType, 'inverse') ?? [];
      const typeId = typeIds[0];
      if (typeId === undefined) return undefined;
      return findIn(store.quantities?.getForEntity?.(typeId) ?? []);
    },

    getClassifications(globalId: number): ClassificationInfo[] {
      const resolved = resolve(globalId);
      if (!resolved) return [];
      const store = resolved.entry.ifcDataStore;
      return extractClassificationsOnDemand(store, resolved.expressId, resolved.entry.mutationView);
    },

    getQuantitySets(globalId: number): ReadonlyArray<{
      name: string;
      quantities: ReadonlyArray<{ name: string }>;
    }> {
      const resolved = resolve(globalId);
      if (!resolved) return [];
      const { ifcDataStore: store, mutationView } = resolved.entry;
      const id = resolved.expressId;

      // Occurrence qsets, mutation-aware (#5207); merged with type-inherited
      // qsets, base-only (see getQuantityValue), occurrence wins per QUANTITY.
      const instanceQsets = quantitySetsFor(store, id, mutationView) as ReadonlyArray<{ name: string; quantities: ReadonlyArray<{ name: string }> }>;
      let typeQsets: ReadonlyArray<{ name: string; quantities: ReadonlyArray<{ name: string }> }> = [];
      if (store.onDemandQuantityMap && store.source?.length > 0) {
        const typeQtys = extractTypeQuantitiesOnDemand(store, id);
        typeQsets = (typeQtys?.quantities ?? []) as typeof typeQsets;
      } else {
        const typeIds = store.relationships?.getRelated(id, RelationshipType.DefinesByType, 'inverse') ?? [];
        const typeId = typeIds[0];
        typeQsets = typeId !== undefined
          ? (store.quantities?.getForEntity?.(typeId) ?? []) as typeof typeQsets
          : [];
      }
      return mergeInheritedQuantitySets(instanceQsets, typeQsets);
    },

    getMaterialName(globalId: number): string | undefined {
      const resolved = resolve(globalId);
      if (!resolved) return undefined;
      const store = resolved.entry.ifcDataStore;
      // Primary association only — this accessor is single-valued by contract.
      // extractMaterialsOnDemand resolves just the primary def (cheaper than
      // resolving every association and discarding the rest).
      const info = extractMaterialsOnDemand(store, resolved.expressId);
      if (!info) return undefined;
      // Return the top-level material name, or first layer/constituent name
      if (info.name) return info.name;
      if (info.layers?.length) return info.layers[0].materialName;
      if (info.constituents?.length) return info.constituents[0].materialName;
      if (info.profiles?.length) return info.profiles[0].materialName;
      if (info.materials?.length) return info.materials[0]?.name;
      return undefined;
    },

    getMaterialNames(globalId: number): string[] {
      const resolved = resolve(globalId);
      if (!resolved) return [];
      const store = resolved.entry.ifcDataStore;
      // Union across ALL associations (elements may carry several).
      const seen = new Set<string>();
      for (const info of extractAllMaterialsOnDemand(store, resolved.expressId)) {
        for (const n of lensMaterialNames(info)) seen.add(n);
      }
      return [...seen];
    },

    getModelId(globalId: number): string | undefined {
      const resolved = resolve(globalId);
      if (!resolved) return undefined;
      return resolved.entry.id;
    },

    getModelName(modelId: string): string | undefined {
      const entry = entries.find(e => e.id === modelId);
      return entry?.name ?? modelId;
    },

    getEntityGroups(
      globalId: number,
      filter?: string,
    ): ReadonlyArray<{ id: number; name?: string; type: string; objectType?: string }> {
      const resolved = resolve(globalId);
      if (!resolved) return [];
      const { ifcDataStore: store, mutationView: view } = resolved.entry;
      if (!groupOverlays.has(resolved.entry.id)) {
        groupOverlays.set(resolved.entry.id, effectiveGroups(store, view));
      }
      const groups = effectiveGroupIds(store, view, resolved.expressId, groupOverlays.get(resolved.entry.id) ?? null)
        .map((id) => effectiveGroupRecord(store, view, id));
      // Fork: zones painted this session come FIRST. Auto-colour picks the first
      // IfcZone it finds, and a painted room is usually already in a zone the
      // file shipped with.
      const painted = paintedZoneIds(resolved.entry.id, view);
      const ordered = painted.size > 0
        ? [...groups.filter((g) => painted.has(g.id)), ...groups.filter((g) => !painted.has(g.id))]
        : groups;
      if (!filter) return ordered;
      // Fork: the filter is a zone-theme id; keep only the zones about it.
      return ordered.filter((g) => themeOfZone(g.objectType)?.id === filter);
    },

    /** Fork: a zone dictates its own colour (`ZoneDisplay=` token), so painting keeps it stable. */
    getValueColor(value: string, source: string): string | null {
      if (source !== 'group') return null;
      return zoneColours().get(value) ?? null;
    },
  };
}
