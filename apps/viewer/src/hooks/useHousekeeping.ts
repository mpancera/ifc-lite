/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading the active model into the shape the Prüfplan checks.
 *
 * # What each element is, decided once
 * The checks turn on whether something is an ordinary element, a room, a piece
 * of the spatial tree, or an opening — and getting that wrong is not a detail:
 * an opening is an `IfcElement` that legitimately sits in no storey, so a
 * containment check that did not know would report every door reveal in the
 * model. The answer comes from the schema registry rather than a hand-written
 * list of class names, so it stays right for classes nobody thought of.
 *
 * # Only while the panel is open
 * Two relationship lookups and a buffer read per product is real work on a
 * large model, and it would be wasted on everyone who never opens the plan.
 *
 * # Georeferencing is not re-read here
 * `extractGeoreferencingOnDemand` and `useGeorefFindings` already do it, and
 * the second one folds in the user's own georeferencing edits. Calling them is
 * how the plan and the georeferencing panel are guaranteed to agree.
 */

import { useEffect, useMemo, useState } from 'react';
import type { GeoreferenceInfo, IfcDataStore } from '@ifc-lite/parser';
import {
  extractGeoreferencingOnDemand,
  getAllAttributesForEntity,
  getInheritanceChainForEntity,
} from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';
import { mergeProjectedCRS, mergeMapConversion } from '@/lib/geo/effective-georef';
import { useGeorefFindings } from '@/lib/geo/useGeorefFindings';
import type { ElementKind, HousekeepingElement } from '@/lib/housekeeping/modelChecks';
import { runHousekeeping, type GeorefKind } from '@/lib/housekeeping/runHousekeeping';
import type { HousekeepingResult } from '@/lib/housekeeping/findings';
import { loadAcceptedFindings, storeAcceptedFindings } from '@/lib/housekeeping/acceptedFindings';
import { useProxyTriage } from '@/hooks/useProxyTriage';
import { useViewerStore } from '@/store';

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  return s === '$' || s === '*' ? '' : s;
}

/**
 * What a class is, for the checks.
 *
 * Order matters, and each step is a trap avoided: `IfcSpace` inherits from
 * `IfcSpatialStructureElement`, so asking about the structure first would file
 * every room as part of the tree and never check it. `IfcOpeningElement`
 * inherits from `IfcElement` through `IfcFeatureElement`, so asking about
 * elements first would demand a storey for every opening. `null` means the
 * class is not a product at all — a relationship, a property set, a point —
 * and there is nothing here to check.
 */
export function classifyElementKind(typeName: string): ElementKind | null {
  const chain = [typeName, ...getInheritanceChainForEntity(typeName)];
  if (chain.includes('IfcSpace')) return 'space';
  if (chain.includes('IfcFeatureElement')) return 'feature';
  if (chain.includes('IfcSpatialStructureElement')) return 'structure';
  if (chain.includes('IfcElement')) return 'element';
  return null;
}

/**
 * How the model states where it is.
 *
 * `source` is the extractor's own word for which path found the answer, and
 * `siteLocation` is the IFC2X3 fallback: reference angles on `IfcSite` and no
 * coordinate operation at all. Reading `hasGeoreference` alone would flatten
 * that into the same "yes" a full `IfcMapConversion` earns.
 */
function georefKind(info: GeoreferenceInfo | null): GeorefKind {
  if (!info?.hasGeoreference) return 'none';
  return info.source === 'siteLocation' ? 'site-location' : 'map-conversion';
}

/** Index of `LongName` in a class's attribute list, or `null` if it has none. */
function longNameIndex(typeName: string): number | null {
  const index = getAllAttributesForEntity(typeName).findIndex((a) => a.name === 'LongName');
  return index >= 0 ? index : null;
}

/** `Name` sits at 2 for every `IfcRoot`, which every product is. */
const NAME_INDEX = 2;

/** What one storage-type bucket needs, worked out once for the whole bucket. */
interface TypeFacts {
  readonly canonical: string;
  readonly kind: ElementKind;
  readonly longNameIndex: number | null;
}

function typeFacts(store: IfcDataStore, storageType: string, sampleId: number): TypeFacts | null {
  // `getTypeName` is how the rest of the app names a class, so the plan speaks
  // the same language as the tree and the inspector.
  const named = store.entities?.getTypeName(sampleId);
  const canonical = named && named !== 'Unknown' ? named : storageType;
  const kind = classifyElementKind(canonical);
  if (!kind) return null;
  return { canonical, kind, longNameIndex: longNameIndex(canonical) };
}

/**
 * Whether an element is anywhere in the spatial tree.
 *
 * Three relationships, because exporters disagree about which one they use:
 * elements are normally CONTAINED, rooms are normally AGGREGATED into their
 * storey, and referencing is the legitimate answer for something that spans
 * several storeys. Accepting any of them keeps the check to what it claims to
 * be — "does this sit somewhere" — instead of quietly also checking that the
 * author picked the relationship this code happens to prefer.
 */
function inSpatialStructure(store: IfcDataStore, expressId: number): boolean {
  const related = store.relationships;
  if (!related) return true;
  for (const relation of [
    RelationshipType.ContainsElements,
    RelationshipType.Aggregates,
    RelationshipType.ReferencedInSpatialStructure,
  ]) {
    if ((related.getRelated(expressId, relation, 'inverse')?.length ?? 0) > 0) return true;
  }
  return false;
}

export interface HousekeepingState {
  readonly results: readonly HousekeepingResult[];
  readonly hasModel: boolean;
  /** Whether an acceptance will outlive the session. */
  readonly canRemember: boolean;
  accept(findingId: string): void;
  unaccept(findingId: string): void;
}

export function useHousekeeping(enabled: boolean): HousekeepingState {
  const models = useViewerStore((state) => state.models);
  const activeModelId = useViewerStore((state) => state.activeModelId);
  const mutationVersion = useViewerStore((state) => state.mutationVersion);
  const georefMutations = useViewerStore((state) => state.georefMutations);

  const model = (activeModelId ? models.get(activeModelId) : null) ?? [...models.values()][0];
  const store = model?.ifcDataStore;

  const { elements: proxyElements, alreadyStated } = useProxyTriage(enabled);

  // ── Georeferencing, through the same path the georeferencing panel uses ──
  const georef = useMemo(
    () => (enabled && store ? extractGeoreferencingOnDemand(store) : null),
    [enabled, store],
  );
  const mutations = model ? georefMutations?.get(model.id) : undefined;
  const lengthUnitScale = store?.lengthUnitScale;
  const mergedCRS = useMemo(
    () => mergeProjectedCRS(georef?.projectedCRS, mutations?.projectedCRS, lengthUnitScale ?? 1),
    [georef?.projectedCRS, mutations?.projectedCRS, lengthUnitScale],
  );
  const mergedConversion = useMemo(
    () => mergeMapConversion(georef?.mapConversion, mutations?.mapConversion),
    [georef?.mapConversion, mutations?.mapConversion],
  );
  const geoFindings = useGeorefFindings(
    mergedCRS, mergedConversion, georef?.siteReference, lengthUnitScale,
  );

  // ── The elements ────────────────────────────────────────────────────────
  const elements = useMemo((): HousekeepingElement[] => {
    if (!enabled || !store) return [];
    const out: HousekeepingElement[] = [];

    for (const [storageType, ids] of store.entityIndex?.byType ?? []) {
      if (ids.length === 0) continue;
      const facts = typeFacts(store, storageType, ids[0]);
      if (!facts) continue;

      for (const expressId of ids) {
        const attributes = store.getEntity?.(expressId)?.attributes;
        out.push({
          expressId,
          ifcType: facts.canonical,
          kind: facts.kind,
          name: text(attributes?.[NAME_INDEX]),
          longName: facts.longNameIndex === null
            ? null
            : text(attributes?.[facts.longNameIndex]),
          inSpatialStructure: facts.kind === 'structure'
            ? true
            : inSpatialStructure(store, expressId),
          hasType: (store.relationships
            ?.getRelated(expressId, RelationshipType.DefinesByType, 'inverse')?.length ?? 0) > 0,
        });
      }
    }
    return out;
  }, [enabled, store, mutationVersion]);

  // ── What the user has already accepted ──────────────────────────────────
  const projectGlobalId = useMemo(() => {
    if (!store) return null;
    for (const [storageType, ids] of store.entityIndex?.byType ?? []) {
      if (storageType.toUpperCase() !== 'IFCPROJECT' || ids.length === 0) continue;
      return text(store.getEntity?.(ids[0])?.attributes?.[0]) || null;
    }
    return null;
  }, [store]);

  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  useEffect(() => {
    setAccepted(loadAcceptedFindings(projectGlobalId));
  }, [projectGlobalId]);

  const change = (next: Set<string>) => {
    setAccepted(next);
    storeAcceptedFindings(projectGlobalId, next);
  };

  const results = useMemo(() => runHousekeeping({
    elements,
    openProxies: proxyElements.map((e) => e.expressId),
    statedProxies: alreadyStated,
    georef: { kind: georefKind(georef), findings: geoFindings },
    acceptedIds: accepted,
  }), [elements, proxyElements, alreadyStated, georef, geoFindings, accepted]);

  return {
    results,
    hasModel: !!store,
    canRemember: projectGlobalId !== null,
    accept: (findingId) => change(new Set(accepted).add(findingId)),
    unaccept: (findingId) => {
      const next = new Set(accepted);
      next.delete(findingId);
      change(next);
    },
  };
}
