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
import type {
  GraphEdgeInfo,
  GraphNodeTraits,
  GraphRelation,
  GraphSource,
  RelationDirection,
} from '@ifc-lite/graph';
import type { MutablePropertyView, NewEntity } from '@ifc-lite/mutations';
import { overlayAttribute } from '@/lib/mutations/overlayAttribute';
import {
  buildOverlayRelationIndex,
  EMPTY_OVERLAY_RELATION_INDEX,
  type OverlayRelationIndex,
} from '@/lib/mutations/overlayRelationIndex';
import {
  buildNestsIndex,
  buildPortConnectionInfo,
  pairKey,
  readAuthoredTraits,
  readParsedTraits,
  type NestsIndex,
} from './rawIfcReaders';

/** What this adapter needs of a store — the same structural shape
 *  `utils/aggregation.ts` uses, so cache-rebuilt graphs satisfy it too. */
export interface GraphStore {
  entities?: {
    getName(expressId: number): string;
    getTypeName(expressId: number): string;
    /**
     * Optional because the structural shape `utils/aggregation.ts` shares with
     * this one does not promise it. A store without it exports rows with an
     * empty GlobalId column, which is visibly incomplete rather than silently
     * wrong.
     */
    getGlobalId?(expressId: number): string;
    getTag?(expressId: number): string;
  };
  entityIndex: { byType: Iterable<[string, number[]]> };
  /**
   * The STEP buffer, present only for a store parsed from a file.
   *
   * Optional because a store rebuilt from the geometry cache carries no source
   * text. Everything below that needs it degrades to a documented fallback
   * instead of throwing — a cached model still has to draw.
   */
  source?: unknown;
  relationships?: {
    getRelated(entityId: number, relType: RelationshipType, direction: RelationDirection): number[];
  };
  properties?: {
    getForEntity(expressId: number): readonly {
      name: string;
      properties: readonly { name: string; value: unknown }[];
    }[];
  };
}

/**
 * IFC relationship names to the store's buckets.
 *
 * `IfcRelNests` and `IfcRelAggregates` share one, because the parser maps both
 * onto `RelationshipType.Aggregates` deliberately: an IDS `partOf` check has to
 * traverse either without knowing which the file used
 * (see `columnar-parser-indexes.ts`).
 *
 * For a schematic that merge is not good enough. Nesting is how an IFC4 element
 * holds its ports, and an element→port edge drawn under the label "Zerlegung",
 * beside a storey's real decomposition, puts two different statements on the
 * drawing under one name. So this table is the FALLBACK; {@link buildNestsIndex}
 * separates the two exactly whenever the source text is at hand, which is every
 * freshly loaded model.
 */
const RELATION_TO_STORE: Record<GraphRelation, RelationshipType> = {
  IfcRelContainedInSpatialStructure: RelationshipType.ContainsElements,
  IfcRelReferencedInSpatialStructure: RelationshipType.ReferencedInSpatialStructure,
  IfcRelAggregates: RelationshipType.Aggregates,
  IfcRelNests: RelationshipType.Aggregates,
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
  globalIdOf(expressId: number): string | null;
  tagOf(expressId: number): string | null;
  /** The authored entity itself, for readers that need its attribute list. */
  entityById(expressId: number): NewEntity | null;
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
    // Attribute 0 is `GlobalId` on every IfcRoot subtype. An entity created
    // this session already carries one — the builders mint it — so the export
    // can name it the same way after a save as before.
    globalIdOf: (expressId) => {
      const value = byId.get(expressId)?.attributes[0];
      return typeof value === 'string' && value ? value : null;
    },
    // Attribute 7 is `Tag` on every IfcElement. `overlayAttribute` is asked
    // first because the wiring tool writes the mark by NAME, and a positional
    // read alone would answer with the value the entity was created with.
    tagOf: (expressId) => {
      const edited = overlayAttribute(view, expressId, 'Tag');
      if (edited !== null) return edited;
      const value = byId.get(expressId)?.attributes[7];
      return typeof value === 'string' ? value : null;
    },
    entityById: (expressId) => byId.get(expressId) ?? null,
  };
}

/** Where the numbering rule writes. The standard occurrence pset. */
const IDENTIFIER_PSET = 'Pset_ConstructionOccurence';
const IDENTIFIER_PROP = 'AssetIdentifier';

/**
 * The asset identifier of one entity, this session's edits first.
 *
 * `getPropertyValue` already resolves in the order that matters — a pending
 * mutation, then a pset created this session, then the parsed file — so a
 * device numbered moments ago answers with its number rather than with the
 * nothing the parse still holds. Without an overlay the parsed store is asked
 * directly, which is the case for a model nobody has edited.
 */
function readIdentifier(
  view: MutablePropertyView | null | undefined,
  store: GraphStore,
  expressId: number,
): string | null {
  const fromOverlay = view?.getPropertyValue(expressId, IDENTIFIER_PSET, IDENTIFIER_PROP);
  if (typeof fromOverlay === 'string' && fromOverlay.trim()) return fromOverlay.trim();
  if (typeof fromOverlay === 'number') return String(fromOverlay);
  if (view) return null;

  const pset = store.properties?.getForEntity(expressId)
    ?.find((candidate) => candidate.name === IDENTIFIER_PSET);
  const value = pset?.properties.find((p) => p.name === IDENTIFIER_PROP)?.value;
  if (typeof value === 'string') return value.trim() || null;
  return typeof value === 'number' ? String(value) : null;
}

/**
 * The parsed side of one relation, with nesting told apart from aggregation.
 *
 * Three cases, and the first is the one that keeps a cached model drawing:
 *
 *  - **no index** — the store has no source text, so the two relationships
 *    cannot be separated. Both answer from the merged bucket. `IfcRelNests`
 *    then over-reports (it also returns real aggregation) and the plant chain's
 *    `keepTypes: ['IfcDistributionPort']` is what keeps that harmless;
 *  - **`IfcRelNests` with an index** — answered from the exact index alone. The
 *    bucket is not consulted, so no aggregation edge can leak in;
 *  - **`IfcRelAggregates` with an index** — the bucket MINUS every nesting pair,
 *    which is what makes it mean aggregation again.
 */
function parsedRelated(
  store: GraphStore,
  nests: NestsIndex | null,
  expressId: number,
  relation: GraphRelation,
  direction: RelationDirection,
): readonly number[] {
  const bucket =
    store.relationships?.getRelated(expressId, RELATION_TO_STORE[relation], direction) ?? [];
  if (!nests) return bucket;
  if (relation === 'IfcRelNests') {
    return (direction === 'forward' ? nests.forward : nests.inverse).get(expressId) ?? [];
  }
  if (relation !== 'IfcRelAggregates') return bucket;
  return bucket.filter((other) => {
    // Nesting is keyed relating>related; which of the pair is which depends on
    // the direction the caller walked.
    const key = direction === 'forward' ? pairKey(expressId, other) : pairKey(other, expressId);
    return !nests.excluded.has(key);
  });
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
  // Both are one pass over a slice of the file, and both are built ON FIRST USE
  // rather than here.
  //
  // Once, because a schematic asks about ports once per node and re-scanning
  // for each would turn a linear build into a quadratic one. Lazily, because
  // most chains never ask at all: `Element -> Raum -> Zone` touches neither
  // nesting nor port connections, and a plant model can hold tens of thousands
  // of ports — a pass over all of them to draw a location tree is a delay with
  // nothing to show for it.
  let nestsIndex: NestsIndex | null | undefined;
  const nests = (): NestsIndex | null => {
    // `undefined` means not built yet; `null` is a real answer meaning the
    // store has no source text. Collapsing the two would rebuild the index on
    // every question for exactly the stores that cannot answer it.
    if (nestsIndex === undefined) nestsIndex = buildNestsIndex(store);
    return nestsIndex;
  };
  let portInfoIndex: Map<string, GraphEdgeInfo> | undefined;
  const portInfo = (): Map<string, GraphEdgeInfo> => {
    portInfoIndex ??= buildPortConnectionInfo(store);
    return portInfoIndex;
  };

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
    globalIdOf: (expressId) =>
      overlay?.globalIdOf(expressId) ?? store.entities?.getGlobalId?.(expressId) ?? null,
    identifierOf: (expressId) => readIdentifier(view, store, expressId),
    // `Tag` is attribute 7 on every IfcElement, and the session's edits win:
    // a device numbered by the wiring tool a moment ago must read with its new
    // position, not the one the file still remembers.
    tagOf: (expressId) => {
      const authored = overlay?.tagOf(expressId);
      if (authored !== null && authored !== undefined) return authored;
      return store.entities?.getTag?.(expressId) ?? null;
    },
    traitsOf: (expressId) => {
      // An entity created this session is not in the file, so the parsed
      // reader would answer nothing for it — which reads as `no
      // PredefinedType` for exactly the devices the user just placed.
      const authored = overlay?.entityById(expressId);
      return authored ? readAuthoredTraits(authored) : readParsedTraits(store, expressId);
    },
    edgeInfoOf: (fromExpressId, toExpressId, relation) => {
      // Only port connections carry payload worth drawing. Containment and
      // grouping relationships have a `Name` slot too, and it is empty in every
      // model seen so far; answering from it would put noise on the edges that
      // make up the bulk of a location tree.
      if (relation !== 'IfcRelConnectsPorts') return null;
      return portInfo().get(pairKey(fromExpressId, toExpressId)) ?? null;
    },
    related: (expressId, relation, direction) => {
      // Only the two decomposition relations need the index; asking for it on
      // every containment edge would build it for chains that never nest.
      const decomposition = relation === 'IfcRelNests' || relation === 'IfcRelAggregates';
      const parsed = parsedRelated(store, decomposition ? nests() : null, expressId, relation, direction);
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
