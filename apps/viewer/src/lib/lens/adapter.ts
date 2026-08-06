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
  extractPropertiesOnDemand,
  extractTypePropertiesOnDemand,
  extractQuantitiesOnDemand,
  extractClassificationsOnDemand,
  extractMaterialsOnDemand,
  extractAllMaterialsOnDemand,
} from '@ifc-lite/parser';
import { resolveEntityPredefinedType } from '@/lib/entity-predefined-type';
import { readZones } from '@/lib/ifcZones/membership';
import { groupBucketValue } from '@ifc-lite/lens';
import { resolveOverlayDefiningTypeId } from '@/lib/mutations/overlayTypeLink';
import { lensMaterialNames } from '@/lib/lens-material-names';
import { toGlobalIdFromModels } from '@/store/globalId';
import type { FederatedModel } from '@/store/types';

interface ModelEntry {
  id: string;
  name: string;
  ifcDataStore: IfcDataStore;
  idOffset: number;
  maxExpressId: number;
}

/** Scan entity array to find the actual maximum expressId */
function computeMaxExpressId(dataStore: IfcDataStore): number {
  const entities = dataStore.entities;
  if (!entities || entities.count === 0) return 0;
  let max = 0;
  for (let i = 0; i < entities.count; i++) {
    if (entities.expressId[i] > max) max = entities.expressId[i];
  }
  return max;
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
 * @param mutationViews - Per-model authoring overlays. Supplied, elements
 *   placed and attributes edited this session take part in colouring; omitted,
 *   the provider reads the parsed file exactly as before.
 */
export function createLensDataProvider(
  models: Map<string, FederatedModel>,
  legacyDataStore: IfcDataStore | null,
  mutationViews?: Map<string, MutablePropertyView>,
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
    });
  }

  // ── Authoring overlay ──
  // Elements placed and attributes edited this session live in the mutation
  // overlay, not in the parsed store the rest of this adapter reads. Index them
  // by federated global id once, so every accessor below is an O(1) lookup.
  const overlayById = new Map<number, OverlayEntity>();
  const overlayTombstones = new Set<number>();
  /** modelId → (local expressId → the zones it was painted into this session). */
  const overlayZonesByModel = new Map<string, Map<number, Array<{ id: number; name?: string; type: string; objectType?: string }>>>();
  /** Auto-colour bucket value → the zone's own colour, for `getValueColor`. */
  const zoneColourByValue = new Map<string, string>();
  const offsets = new Map(entries.map((entry) => [entry.id, { idOffset: entry.idOffset }]));
  if (mutationViews) {
    for (const entry of entries) {
      const view = mutationViews.get(entry.id);
      if (!view) continue;
      const toGlobal = (expressId: number) => toGlobalIdFromModels(offsets, entry.id, expressId);
      // Authoring an element also creates its placement/profile/solid entities.
      // Only the product is registered against a storey, and only products may
      // reach the colour map — otherwise auto-colour legend counts are inflated
      // by geometry plumbing that never renders.
      const isProduct = (expressId: number) =>
        entry.ifcDataStore.spatialHierarchy?.elementToStorey.has(expressId) ?? false;
      for (const entity of view.getNewEntities()) {
        if (!isProduct(entity.expressId)) continue;
        overlayById.set(toGlobal(entity.expressId), {
          type: entity.type,
          attributes: entity.attributes,
          modelId: entry.id,
          expressId: entity.expressId,
        });
      }
      for (const expressId of view.getTombstones()) overlayTombstones.add(toGlobal(expressId));

      // Zones painted this session and their members. Indexed per model
      // because express ids are local to one file.
      const zones = readZones(view.getNewEntities());
      const perModel = new Map<number, Array<{ id: number; name?: string; type: string; objectType?: string }>>();
      for (const zone of zones) {
        const ref = {
          id: zone.expressId,
          name: zone.name || undefined,
          type: 'IfcZone',
          objectType: zone.objectType || undefined,
        };
        // Keyed by the bucket the engine will actually form, not by the name —
        // an unnamed zone buckets as `IfcZone #id` and still deserves its colour.
        if (zone.colour) zoneColourByValue.set(groupBucketValue(ref), zone.colour);
        for (const memberId of zone.memberIds) {
          const list = perModel.get(memberId) ?? [];
          list.push(ref);
          perModel.set(memberId, list);
        }
      }
      overlayZonesByModel.set(entry.id, perModel);
    }
  }

  /** Zones the overlay assigns to this element, or an empty list. */
  function overlayGroupsOf(
    modelId: string,
    expressId: number,
  ): ReadonlyArray<{ id: number; name?: string; type: string; objectType?: string }> {
    return overlayZonesByModel.get(modelId)?.get(expressId) ?? [];
  }

  /**
   * An entity's own property sets, with authored ones merged in.
   * `MutablePropertyView.getForEntity` already returns base ∪ overlay (its base
   * extractor is wired to the same on-demand path), so it replaces the plain
   * extractor wholesale rather than layering on top of it.
   */
  function instancePropertySets(entry: ModelEntry, expressId: number): PropertySetInfo[] {
    const view = mutationViews?.get(entry.id);
    if (view) return view.getForEntity(expressId) as PropertySetInfo[];
    return extractPropertiesOnDemand(entry.ifcDataStore, expressId) as PropertySetInfo[];
  }

  /**
   * Property sets on the `IfcXxxType` an element was typed by THIS session.
   * The parsed store's relationship graph is built once at load, so an
   * `IfcRelDefinesByType` authored now is invisible to `extractTypeProperties-
   * OnDemand` and the type's defaults (a catalogue product's technical data)
   * would never reach the occurrence.
   */
  function overlayTypePropertySets(entry: ModelEntry, expressId: number): PropertySetInfo[] {
    const view = mutationViews?.get(entry.id);
    const typeId = resolveOverlayDefiningTypeId(view, expressId);
    return typeId === null ? [] : (view!.getForEntity(typeId) as PropertySetInfo[]);
  }

  /** The overlay's value for a named attribute, or `undefined` to fall through. */
  function overlayAttribute(globalId: number, attrName: string): string | undefined {
    const resolved = resolveGlobalId(globalId, entries);
    const view = resolved ? mutationViews?.get(resolved.entry.id) : undefined;
    if (resolved && view) {
      for (const m of view.getAttributeMutationsForEntity(resolved.expressId)) {
        if (m.name === attrName) return m.value || undefined;
      }
    }
    const authored = overlayById.get(globalId);
    if (!authored) return undefined;
    if (attrName === 'Type') return authored.type;
    if (attrName === 'PredefinedType') {
      const last = authored.attributes[authored.attributes.length - 1];
      return typeof last === 'string' && /^\.[A-Z0-9_]+\.$/.test(last) ? last.slice(1, -1) : undefined;
    }
    const index = OVERLAY_ATTR_INDEX[attrName];
    if (index === undefined) return undefined;
    const raw = authored.attributes[index];
    return typeof raw === 'string' && raw ? raw : undefined;
  }

  return {
    getEntityCount(): number {
      let count = 0;
      for (const entry of entries) {
        count += entry.ifcDataStore.entities?.count ?? 0;
      }
      return count + overlayById.size;
    },

    forEachEntity(callback: (globalId: number, modelId: string) => void): void {
      const models = new Map(entries.map((entry) => [entry.id, { idOffset: entry.idOffset }]));
      for (const entry of entries) {
        const entities = entry.ifcDataStore.entities;
        if (!entities) continue;
        for (let i = 0; i < entities.count; i++) {
          const expressId = entities.expressId[i];
          const globalId = toGlobalIdFromModels(models, entry.id, expressId);
          if (overlayTombstones.has(globalId)) continue;
          callback(globalId, entry.id);
        }
      }
      for (const [globalId, authored] of overlayById) callback(globalId, authored.modelId);
    },

    getEntityType(globalId: number): string | undefined {
      const authored = overlayById.get(globalId);
      if (authored) return authored.type;
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return undefined;
      return resolved.entry.ifcDataStore.entities?.getTypeName?.(resolved.expressId);
    },

    getPropertyValue(
      globalId: number,
      propertySetName: string,
      propertyName: string,
    ): unknown {
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return undefined;
      const store = resolved.entry.ifcDataStore;
      const id = resolved.expressId;

      // On-demand extraction path: pre-built table is empty for client-parsed
      // stores, so iterate the same psets we expose via getPropertySets.
      if (store.onDemandPropertyMap && store.source?.length > 0) {
        const instancePsets = instancePropertySets(resolved.entry, id);
        for (const pset of instancePsets) {
          if (pset.name !== propertySetName) continue;
          for (const prop of pset.properties) {
            if (prop.name === propertyName) return prop.value;
          }
        }
        // Fall through to type-inherited psets (Pset_*Common is typically
        // attached to IfcSpaceType / IfcWallType, not the instance).
        const typeProps = extractTypePropertiesOnDemand(store, id)?.properties ?? [];
        const inherited = typeProps.length > 0
          ? (typeProps as PropertySetInfo[])
          : overlayTypePropertySets(resolved.entry, id);
        for (const pset of inherited) {
          if (pset.name !== propertySetName) continue;
          for (const prop of pset.properties) {
            if (prop.name === propertyName) return prop.value;
          }
        }
        return undefined;
      }

      return store.properties?.getPropertyValue?.(id, propertySetName, propertyName);
    },

    getPropertySets(globalId: number): PropertySetInfo[] {
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return [];
      const store = resolved.entry.ifcDataStore;
      const id = resolved.expressId;

      // Properties are extracted lazily — the pre-built table is empty unless
      // server-parsed. Mirror the quantity path and use the on-demand extractor,
      // which itself falls back to the eager table when no on-demand map exists.
      if (store.onDemandPropertyMap && store.source?.length > 0) {
        const instancePsets = instancePropertySets(resolved.entry, id);
        // Merge type-inherited psets (Pset_*Common lives on the type entity
        // for occurrences). Instance psets take precedence on name conflict.
        const typeProps = extractTypePropertiesOnDemand(store, id)?.properties ?? [];
        const inherited = typeProps.length > 0
          ? (typeProps as PropertySetInfo[])
          : overlayTypePropertySets(resolved.entry, id);
        if (inherited.length === 0) return instancePsets;

        const seen = new Set(instancePsets.map((p) => p.name));
        const merged = instancePsets.slice();
        for (const pset of inherited) {
          if (!seen.has(pset.name)) merged.push(pset);
        }
        return merged;
      }

      const psets = store.properties?.getForEntity?.(id);
      if (!psets) return [];
      return psets as PropertySetInfo[];
    },

    getEntityAttribute(globalId: number, attrName: string): string | undefined {
      // An edited or authored value wins; everything else falls through to the
      // parsed file, so an unedited model reads exactly as it did before.
      const fromOverlay = overlayAttribute(globalId, attrName);
      if (fromOverlay !== undefined) return fromOverlay;
      if (overlayById.has(globalId)) return undefined;

      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return undefined;
      const store = resolved.entry.ifcDataStore;
      const id = resolved.expressId;

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
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return undefined;
      const store = resolved.entry.ifcDataStore;
      const id = resolved.expressId;

      // On-demand quantity extraction
      if (store.onDemandQuantityMap && store.source?.length > 0) {
        const qsets = extractQuantitiesOnDemand(store, id);
        for (const qset of qsets) {
          if (qset.name === qsetName) {
            for (const q of qset.quantities) {
              if (q.name === quantName) return q.value;
            }
          }
        }
        return undefined;
      }

      // Fallback: pre-built quantity tables
      const qsets = store.quantities?.getForEntity?.(id);
      if (!qsets) return undefined;
      for (const qset of qsets) {
        if (qset.name === qsetName) {
          for (const q of qset.quantities) {
            if (q.name === quantName) return q.value;
          }
        }
      }
      return undefined;
    },

    getClassifications(globalId: number): ClassificationInfo[] {
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return [];
      const store = resolved.entry.ifcDataStore;
      return extractClassificationsOnDemand(store, resolved.expressId);
    },

    getQuantitySets(globalId: number): ReadonlyArray<{
      name: string;
      quantities: ReadonlyArray<{ name: string }>;
    }> {
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return [];
      const store = resolved.entry.ifcDataStore;
      const id = resolved.expressId;

      // On-demand quantity extraction
      if (store.onDemandQuantityMap && store.source?.length > 0) {
        return extractQuantitiesOnDemand(store, id);
      }

      // Fallback: pre-built quantity tables
      const qsets = store.quantities?.getForEntity?.(id);
      if (!qsets) return [];
      return qsets as ReadonlyArray<{ name: string; quantities: ReadonlyArray<{ name: string }> }>;
    },

    getMaterialName(globalId: number): string | undefined {
      const resolved = resolveGlobalId(globalId, entries);
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
      const resolved = resolveGlobalId(globalId, entries);
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
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return undefined;
      return resolved.entry.id;
    },

    getModelName(modelId: string): string | undefined {
      const entry = entries.find(e => e.id === modelId);
      return entry?.name ?? modelId;
    },

    getEntityGroups(globalId: number): ReadonlyArray<{ id: number; name?: string; type: string; objectType?: string }> {
      const resolved = resolveGlobalId(globalId, entries);
      if (!resolved) return [];
      const store = resolved.entry.ifcDataStore;
      if (!store.relationships) return [];
      // Inverse IfcRelAssignsToGroup: entity → the groups/zones it belongs to.
      const groupIds = store.relationships.getRelated(resolved.expressId, RelationshipType.AssignsToGroup, 'inverse');
      if (!groupIds || groupIds.length === 0) return [];
      const out: Array<{ id: number; name?: string; type: string; objectType?: string }> = [];
      for (const gid of groupIds) {
        const name = store.entities?.getName(gid);
        // Canonical IfcPascalCase so the "By Zone" lens can match `IfcZone`
        // deterministically; `byId.get(gid).type` is the raw STEP token. (#1075)
        const type = store.entities?.getTypeName?.(gid) || store.entityIndex?.byId.get(gid)?.type || 'Unknown';
        // ObjectType carries the system designation for unnamed groups; the
        // lens legend falls back to it when Name/LongName are empty. (#1075)
        const objectType = store.entities?.getObjectType?.(gid);
        out.push({ id: gid, name: name || undefined, type, objectType: objectType || undefined });
      }
      // The parsed graph predates this session, so a zone painted just now is
      // invisible to it — the same overlay blindness that hid authored elements
      // from Lists, Solo and the Relationships tab. Merge what the overlay
      // says on top.
      for (const group of overlayGroupsOf(resolved.entry.id, resolved.expressId)) {
        if (!out.some((g) => g.id === group.id)) out.push(group);
      }
      return out;
    },

    /**
     * A zone dictates its own colour, so painting keeps it stable.
     *
     * Only the `group` source has an opinion: everything else leaves the
     * palette alone. The colour lives in the zone's Description as a
     * `ZoneDisplay=` token — see `lib/ifcZones/zoneDisplay.ts`.
     */
    getValueColor(value: string, source: string): string | null {
      if (source !== 'group') return null;
      return zoneColourByValue.get(value) ?? null;
    },
  };
}

/**
 * Resolve a global ID to (entry, local expressId).
 * O(m) where m = model count (typically 1–5).
 * Reuses a single result object to avoid per-call allocation during
 * hot-loop lens evaluation (100k+ calls).
 */
const _resolved = { entry: null as unknown as ModelEntry, expressId: 0 };

function resolveGlobalId(
  globalId: number,
  entries: ModelEntry[],
): typeof _resolved | null {
  for (const entry of entries) {
    const localId = globalId - entry.idOffset;
    if (localId >= 0 && localId <= entry.maxExpressId) {
      _resolved.entry = entry;
      _resolved.expressId = localId;
      return _resolved;
    }
  }
  return null;
}
