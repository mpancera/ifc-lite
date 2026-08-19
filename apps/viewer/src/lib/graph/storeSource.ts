/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The bridge from a parsed model to `@ifc-lite/graph`'s four questions.
 *
 * Carries no logic of its own beyond three translations the graph package is
 * deliberately kept ignorant of:
 *
 *  - IFC relationship names to the store's `RelationshipType` enum. The graph
 *    speaks EXPRESS (`IfcRelContainedInSpatialStructure`) because that is what
 *    a reader of the drawing needs; the store speaks its own enum
 *    (`ContainsElements`). One table, one place.
 *  - `entityIndex.byType`'s raw STEP keys (`IFCSENSOR`) to EXPRESS PascalCase
 *    (`IfcSensor`), resolved through `entities.getTypeName` the same way the
 *    MCP playground does, so the two surfaces agree on what a type is called.
 *  - The parse and the authoring overlay into one model. The parsed graph is
 *    built once from the file; everything authored in the session lives in the
 *    overlay afterwards. A drawing that asked only the parse showed nothing of
 *    what the user had just done — measured: two detectors placed in a room,
 *    zero sensors in the drawing — and a deleted room kept its box. Both sides
 *    are merged here rather than in the panel, so every reader of a graph
 *    source gets the same answer.
 */

import { RelationshipType } from '@ifc-lite/data';
import { getInheritanceChainForEntity } from '@ifc-lite/parser';
import type { GraphRelation, GraphSource, RelationDirection } from '@ifc-lite/graph';
import type { MutablePropertyView, NewEntity } from '@ifc-lite/mutations';
import {
  buildOverlayRelationIndex,
  EMPTY_OVERLAY_RELATION_INDEX,
  type OverlayRelationIndex,
} from '@/lib/mutations/overlayRelationIndex';

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
function indexByExpressType(store: GraphStore, overlay?: OverlaySide): Map<string, number[]> {
  const byName = new Map<string, number[]>();
  for (const [storageType, ids] of store.entityIndex.byType) {
    if (ids.length === 0) continue;
    const canonical = store.entities?.getTypeName(ids[0]);
    const name = canonical && canonical !== 'Unknown' ? canonical : storageType;
    const kept = overlay ? ids.filter((id) => !overlay.isDeleted(id)) : ids;
    if (kept.length === 0) continue;
    const existing = byName.get(name);
    if (existing) existing.push(...kept);
    else byName.set(name, [...kept]);
  }
  // `NewEntity.type` is already the EXPRESS name the builders were called
  // with, so it needs no canonicalisation - only the same deletion filter,
  // because an element can be created and removed inside one session.
  for (const entity of overlay?.entities ?? []) {
    if (overlay?.isDeleted(entity.expressId)) continue;
    const existing = byName.get(entity.type);
    if (existing) existing.push(entity.expressId);
    else byName.set(entity.type, [entity.expressId]);
  }
  return byName;
}

/** The authoring session, reduced to what a graph source needs of it. */
interface OverlaySide {
  entities: readonly NewEntity[];
  index: OverlayRelationIndex;
  isDeleted(expressId: number): boolean;
  typeOf(expressId: number): string | null;
  nameOf(expressId: number): string | null;
}

function overlaySideFor(view: MutablePropertyView | null | undefined): OverlaySide | undefined {
  if (!view) return undefined;
  const entities = view.getNewEntities();
  const byId = new Map(entities.map((entity) => [entity.expressId, entity]));
  return {
    entities,
    index: buildOverlayRelationIndex(entities),
    isDeleted: (expressId) => view.isDeleted(expressId),
    typeOf: (expressId) => byId.get(expressId)?.type ?? null,
    // Attribute 2 is `Name` on every IfcRoot subtype. A created entity that
    // was never named holds null there, which is not a reason to fall back to
    // the parse: the parse does not know this entity at all.
    nameOf: (expressId) => {
      const entity = byId.get(expressId);
      if (!entity) return null;
      const name = entity.attributes[2];
      return typeof name === 'string' ? name : null;
    },
  };
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
export function graphSourceFor(
  store: GraphStore,
  view?: MutablePropertyView | null,
): GraphSource {
  const overlay = overlaySideFor(view);
  const byType = indexByExpressType(store, overlay);
  const index = overlay?.index ?? EMPTY_OVERLAY_RELATION_INDEX;
  const alive = (expressId: number) => !overlay?.isDeleted(expressId);

  return {
    idsOfType: (ifcType) => byType.get(ifcType) ?? [],
    typeOf: (expressId) => {
      // Overlay first: an entity created this session is not in the parse at
      // all, and asking the parse for it answers 'Unknown', which the chain
      // reads as "skip this node".
      const authored = overlay?.typeOf(expressId);
      if (authored) return authored;
      const name = store.entities?.getTypeName(expressId);
      return name && name !== 'Unknown' ? name : null;
    },
    nameOf: (expressId) => overlay?.nameOf(expressId) ?? store.entities?.getName(expressId) ?? null,
    related: (expressId, relation, direction) => {
      const parsed = store.relationships?.getRelated(expressId, RELATION_TO_STORE[relation], direction) ?? [];
      const authored = index.related(expressId, relation, direction);
      if (authored.length === 0) return parsed.filter(alive);
      // A session can re-state an edge the file already has (re-placing an
      // element into the same room), and a drawing must not grow a second
      // box for it.
      const merged = new Set<number>(parsed);
      for (const id of authored) merged.add(id);
      return [...merged].filter(alive);
    },
  };
}

/**
 * The EXPRESS type names this model actually contains, sorted.
 *
 * Feeds the picker: offering all 800-odd IFC classes when the model holds
 * eleven of them makes choosing a starting type a search problem instead of a
 * glance.
 */
export function expressTypesIn(store: GraphStore, view?: MutablePropertyView | null): string[] {
  return [...indexByExpressType(store, overlaySideFor(view)).keys()].sort((a, b) => a.localeCompare(b));
}

/**
 * How many entities of each EXPRESS type the model holds, the session's own
 * included. The picker reads this: without the overlay, a model whose only
 * detectors were placed in this session offers no `IfcSensor` to start from,
 * and the drawing cannot be asked for at all.
 */
export function expressTypeCounts(store: GraphStore, view?: MutablePropertyView | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [name, ids] of indexByExpressType(store, overlaySideFor(view))) counts.set(name, ids.length);
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
export function systemsIn(store: GraphStore, view?: MutablePropertyView | null): SystemInfo[] {
  const overlay = overlaySideFor(view);
  const index = overlay?.index ?? EMPTY_OVERLAY_RELATION_INDEX;
  const systems: SystemInfo[] = [];
  for (const [ifcType, ids] of indexByExpressType(store, overlay)) {
    if (!isPlantSystem(ifcType)) continue;
    for (const expressId of ids) {
      // The member count decides how big the drawing will be, so it has to
      // count this session's assignments too - a role-driven placement joins
      // its installation through the overlay, and a system that reads "0
      // members" is the one nobody picks.
      const members = new Set<number>(
        store.relationships?.getRelated(expressId, RelationshipType.AssignsToGroup, 'forward') ?? [],
      );
      for (const id of index.related(expressId, 'IfcRelAssignsToGroup', 'forward')) members.add(id);
      systems.push({
        expressId,
        ifcType,
        name: overlay?.nameOf(expressId) ?? store.entities?.getName(expressId) ?? '',
        memberCount: [...members].filter((id) => !overlay?.isDeleted(id)).length,
      });
    }
  }
  return systems.sort(
    (a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name),
  );
}
