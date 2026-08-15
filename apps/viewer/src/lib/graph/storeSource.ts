/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The bridge from a parsed model to `@ifc-lite/graph`'s four questions.
 *
 * Carries no logic of its own beyond two translations the graph package is
 * deliberately kept ignorant of:
 *
 *  - IFC relationship names to the store's `RelationshipType` enum. The graph
 *    speaks EXPRESS (`IfcRelContainedInSpatialStructure`) because that is what
 *    a reader of the drawing needs; the store speaks its own enum
 *    (`ContainsElements`). One table, one place.
 *  - `entityIndex.byType`'s raw STEP keys (`IFCSENSOR`) to EXPRESS PascalCase
 *    (`IfcSensor`), resolved through `entities.getTypeName` the same way the
 *    MCP playground does, so the two surfaces agree on what a type is called.
 */

import { RelationshipType } from '@ifc-lite/data';
import { getInheritanceChainForEntity } from '@ifc-lite/parser';
import type { GraphRelation, GraphSource, RelationDirection } from '@ifc-lite/graph';

/** What this adapter needs of a store — the same structural shape
 *  `utils/aggregation.ts` uses, so cache-rebuilt graphs satisfy it too. */
export interface GraphStore {
  entities?: {
    getName(expressId: number): string;
    getTypeName(expressId: number): string;
  };
  entityIndex: { byType: Iterable<[string, number[]]> };
  relationships?: {
    getRelated(entityId: number, relType: RelationshipType, direction: RelationDirection): number[];
  };
}

const RELATION_TO_STORE: Record<GraphRelation, RelationshipType> = {
  IfcRelContainedInSpatialStructure: RelationshipType.ContainsElements,
  IfcRelReferencedInSpatialStructure: RelationshipType.ReferencedInSpatialStructure,
  IfcRelAggregates: RelationshipType.Aggregates,
  IfcRelAssignsToGroup: RelationshipType.AssignsToGroup,
  IfcRelConnectsPortToElement: RelationshipType.ConnectsPortToElement,
  IfcRelConnectsPorts: RelationshipType.ConnectsPorts,
};

/**
 * Bucket every entity by its EXPRESS type name, once per graph build.
 *
 * `entityIndex.byType` is keyed by the raw STEP token, which is the file's
 * spelling and not necessarily uppercase in every producer. Resolving one id
 * per bucket through `getTypeName` gets the canonical name without a
 * per-entity call, and keeps the answer identical to what the rest of the app
 * shows for the same entity.
 */
function indexByExpressType(store: GraphStore): Map<string, number[]> {
  const byName = new Map<string, number[]>();
  for (const [storageType, ids] of store.entityIndex.byType) {
    if (ids.length === 0) continue;
    const canonical = store.entities?.getTypeName(ids[0]);
    const name = canonical && canonical !== 'Unknown' ? canonical : storageType;
    const existing = byName.get(name);
    if (existing) existing.push(...ids);
    else byName.set(name, [...ids]);
  }
  return byName;
}

/**
 * A `GraphSource` over one loaded model.
 *
 * Scoped to a single model on purpose: a federated schematic would have to
 * resolve ids through `FederationRegistry`, and mixing raw express ids from two
 * models in one graph is exactly the silent-collision bug that guard exists to
 * prevent. Drawing one model at a time is also the right unit for a schematic —
 * an electrical schematic is not improved by the architecture model being in it.
 */
export function graphSourceFor(store: GraphStore): GraphSource {
  const byType = indexByExpressType(store);

  return {
    idsOfType: (ifcType) => byType.get(ifcType) ?? [],
    typeOf: (expressId) => {
      const name = store.entities?.getTypeName(expressId);
      return name && name !== 'Unknown' ? name : null;
    },
    nameOf: (expressId) => store.entities?.getName(expressId) || null,
    related: (expressId, relation, direction) =>
      store.relationships?.getRelated(expressId, RELATION_TO_STORE[relation], direction) ?? [],
  };
}

/**
 * The EXPRESS type names this model actually contains, sorted.
 *
 * Feeds the picker: offering all 800-odd IFC classes when the model holds
 * eleven of them makes choosing a starting type a search problem instead of a
 * glance.
 */
export function expressTypesIn(store: GraphStore): string[] {
  return [...indexByExpressType(store).keys()].sort((a, b) => a.localeCompare(b));
}

/** How many entities of each EXPRESS type the model holds. */
export function expressTypeCounts(store: GraphStore): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [name, ids] of indexByExpressType(store)) counts.set(name, ids.length);
  return counts;
}

export interface SystemInfo {
  expressId: number;
  /** Exact EXPRESS name — `IfcSystem`, `IfcDistributionSystem`, … */
  ifcType: string;
  name: string;
  /** Members reachable over `IfcRelAssignsToGroup`. */
  memberCount: number;
}

/**
 * Is this type a plant system for the purposes of the drawing?
 *
 * Asked of the schema, with one deliberate exception. `IfcZone` is a subtype
 * of `IfcSystem` in IFC4 — so "every `IfcSystem` descendant" sweeps every fire
 * compartment and every dwelling into the system picker beside the lighting
 * and the fire alarm. They are a spatial grouping of rooms, not a plant, they
 * already have a chain of their own, and mixing them in would make the picker
 * a list of two unrelated things under one heading.
 *
 * `IfcStructuralAnalysisModel` is a system by the same schema rule and is left
 * in: it genuinely is one, it is rare, and unlike a zone it is not already
 * drawn somewhere else.
 */
function isPlantSystem(ifcType: string): boolean {
  if (ifcType === 'IfcZone') return false;
  return getInheritanceChainForEntity(ifcType).includes('IfcSystem');
}

/**
 * The systems in the model, with how much hangs off each.
 *
 * The member count is what makes the picker usable: it is the difference
 * between choosing a name off a list and choosing how big the drawing will be.
 * A system with no members is still listed — an empty system is a finding, and
 * hiding it would make it look like it does not exist.
 */
export function systemsIn(store: GraphStore): SystemInfo[] {
  const systems: SystemInfo[] = [];
  for (const [ifcType, ids] of indexByExpressType(store)) {
    if (!isPlantSystem(ifcType)) continue;
    for (const expressId of ids) {
      systems.push({
        expressId,
        ifcType,
        name: store.entities?.getName(expressId) || '',
        memberCount:
          store.relationships?.getRelated(expressId, RelationshipType.AssignsToGroup, 'forward')
            .length ?? 0,
      });
    }
  }
  return systems.sort(
    (a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name),
  );
}
