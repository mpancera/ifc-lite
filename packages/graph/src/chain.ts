/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Chains: a graph built by following relationships hop by hop.
 *
 * "Detector in room in zone" is three ranks joined by two relationships, and so
 * is "luminaire in room in storey", and so is "space in zone in building". They
 * differ only in which relationship each hop follows and which types it keeps,
 * so that is what a chain spells out — rather than one hand-written extractor
 * per case, which is how a dozen near-identical walks end up in a codebase.
 *
 * A hop is 1:n by construction: it starts from every node the previous hop
 * produced and keeps every target each of them reaches. A detector in two zones
 * yields two edges, and the drawing shows both.
 */

import type { GraphSource } from './source.js';
import {
  edgeId,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type GraphNodeKind,
  type GraphRelation,
  type RelationDirection,
} from './types.js';

export interface RelationHop {
  relation: GraphRelation;
  direction: RelationDirection;
  /**
   * Keep only targets of these exact EXPRESS types. Empty keeps every target.
   *
   * This is what makes a hop honest about IFC's looseness:
   * `IfcRelContainedInSpatialStructure` from an element reaches whatever
   * spatial container the authoring tool chose — usually an `IfcSpace`, often
   * an `IfcBuildingStorey` directly. A hop that means "the room" says
   * `['IfcSpace']` and lets the storey-contained ones fall out, where they are
   * then visible as elements with no room rather than quietly re-ranked.
   */
  keepTypes: readonly string[];
  /** The kind assigned to every node this hop produces. */
  kind: GraphNodeKind;
}

/**
 * Where a chain begins.
 *
 * Two forms, because the two questions are genuinely different. "Every door"
 * is a class — nobody picks 33 doors one at a time. "The lighting system and
 * the fire alarm system" is a choice among named things, and asking for it by
 * class would mean drawing all 21 systems in the building at once.
 *
 * A discriminated union rather than two optional fields: a chain that carried
 * both would have to state which one wins, and the answer would live somewhere
 * other than the chain.
 */
export type ChainStart =
  | { kind: GraphNodeKind; types: readonly string[] }
  | { kind: GraphNodeKind; ids: readonly number[] };

export interface RelationChain {
  start: ChainStart;
  hops: readonly RelationHop[];
}

/**
 * Walk `chain` over `source` and return everything it reached.
 *
 * Dead ends are kept: a detector whose room the chain could not find stays in
 * the graph as a node with no outgoing edge. Dropping it would hide exactly the
 * modelling gap the drawing is good at showing — and the gap is common, because
 * whether an element hangs off a space or off a storey is an authoring-tool
 * decision, not a modelling one.
 *
 * A node reached twice is added once, keeping the kind it was first given. In a
 * well-formed chain that cannot happen (each hop keeps a different set of
 * types); if it does, the drawing shows one node with several edges, which is
 * the truthful picture.
 */
export function buildRelationGraph(source: GraphSource, chain: RelationChain): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (expressId: number, kind: GraphNodeKind): GraphNode | null => {
    const id = String(expressId);
    const existing = nodes.get(id);
    if (existing) return existing;
    const ifcType = source.typeOf(expressId);
    // An id the source cannot type is not an entity we can draw. It is also the
    // shape a dangling STEP reference takes, so silently skipping it is right.
    if (!ifcType) return null;
    const node: GraphNode = { id, expressId, kind, ifcType, name: source.nameOf(expressId) ?? '' };
    nodes.set(id, node);
    return node;
  };

  const startIds =
    'ids' in chain.start
      ? chain.start.ids
      : chain.start.types.flatMap((ifcType) => [...source.idsOfType(ifcType)]);

  let frontier: GraphNode[] = [];
  for (const expressId of startIds) {
    const node = addNode(expressId, chain.start.kind);
    if (node) frontier.push(node);
  }

  for (const hop of chain.hops) {
    const next: GraphNode[] = [];
    const keep = new Set(hop.keepTypes);
    for (const from of frontier) {
      for (const targetId of source.related(from.expressId, hop.relation, hop.direction)) {
        const targetType = source.typeOf(targetId);
        if (!targetType) continue;
        if (keep.size > 0 && !keep.has(targetType)) continue;
        const to = addNode(targetId, hop.kind);
        if (!to) continue;
        const id = edgeId(from.id, to.id, hop.relation);
        if (!edges.has(id)) {
          edges.set(id, { id, source: from.id, target: to.id, relation: hop.relation });
        }
        next.push(to);
      }
    }
    // Two elements in the same room put that room in the frontier twice; the
    // next hop would then walk it twice and do the same work for the same
    // answer. De-duplicate here rather than making every hop defensive.
    frontier = [...new Set(next)];
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * The first chain: element → room → zone.
 *
 * `IfcRelContainedInSpatialStructure` is followed inverse (from the element to
 * its container) and `IfcRelAssignsToGroup` likewise (from the space to the
 * zones it is a member of) — in both, the element/space is a `RelatedObject`
 * and the thing we want is the `RelatingObject`.
 */
export function elementInSpaceInZone(elementTypes: readonly string[]): RelationChain {
  return {
    start: { kind: 'element', types: elementTypes },
    hops: [
      {
        relation: 'IfcRelContainedInSpatialStructure',
        direction: 'inverse',
        keepTypes: ['IfcSpace'],
        kind: 'space',
      },
      {
        relation: 'IfcRelAssignsToGroup',
        direction: 'inverse',
        keepTypes: ['IfcZone'],
        kind: 'zone',
      },
    ],
  };
}

/**
 * element → room → storey.
 *
 * The storey hop follows `IfcRelAggregates` inverse, not containment: a space
 * is *decomposed out of* its storey (`IfcRelAggregates`), while an element is
 * *contained in* one (`IfcRelContainedInSpatialStructure`). Using containment
 * for both is the mistake that makes rooms disappear from the drawing.
 */
export function elementInSpaceInStorey(elementTypes: readonly string[]): RelationChain {
  return {
    start: { kind: 'element', types: elementTypes },
    hops: [
      {
        relation: 'IfcRelContainedInSpatialStructure',
        direction: 'inverse',
        keepTypes: ['IfcSpace'],
        kind: 'space',
      },
      {
        relation: 'IfcRelAggregates',
        direction: 'inverse',
        keepTypes: ['IfcBuildingStorey'],
        kind: 'storey',
      },
    ],
  };
}

/**
 * A system and what belongs to it — the first chain that reads like a plant
 * schematic rather than a location tree.
 *
 * Takes express ids, not types: a building holds twenty-odd systems (lighting,
 * power, fire alarm, KNX bus, …) and drawing all of them at once is a tangle,
 * not a schematic. Which ones to show is the choice the drawing is about.
 *
 * `keepTypes` is empty because a system's membership is deliberately open —
 * whatever the engineer assigned to it belongs in the drawing, and filtering
 * by class here would silently drop the parts of the system that happen to be
 * modelled as something unexpected. In practice that is exactly what happens:
 * in an IFC2X3-era electrical model every device is an
 * `IfcBuildingElementProxy`.
 *
 * KNOWN LIMIT: a member that is itself a system — an `IfcDistributionCircuit`
 * nested in an `IfcDistributionSystem` — is drawn with the `element` rank. Its
 * box still names the real IFC class, so the drawing does not lie; it just
 * does not give the nested circuit a rank of its own. Giving it one means
 * deciding how deep to recurse, and that is a decision to make against a model
 * that actually nests.
 */
export function systemMembers(systemIds: readonly number[]): RelationChain {
  return {
    start: { kind: 'system', ids: systemIds },
    hops: [
      {
        // Forward: from the group to its `RelatedObjects`. The element chains
        // walk this same relationship inverse, which is the whole reason
        // direction is part of a hop rather than baked into the relationship.
        relation: 'IfcRelAssignsToGroup',
        direction: 'forward',
        keepTypes: [],
        kind: 'element',
      },
    ],
  };
}

/**
 * A system, its members, and the room each member sits in.
 *
 * Only useful where the plant model carries spaces of its own — many do not,
 * and there the third rank stays empty and every member reads as a dead end.
 * That is the honest picture: it says the plant model has no rooms in it.
 */
export function systemMembersInSpace(systemIds: readonly number[]): RelationChain {
  return {
    start: { kind: 'system', ids: systemIds },
    hops: [
      {
        relation: 'IfcRelAssignsToGroup',
        direction: 'forward',
        keepTypes: [],
        kind: 'element',
      },
      {
        relation: 'IfcRelContainedInSpatialStructure',
        direction: 'inverse',
        keepTypes: ['IfcSpace'],
        kind: 'space',
      },
    ],
  };
}

/**
 * The ranks a chain produces, in order: the start kind, then one per hop.
 *
 * The last one is TERMINAL — nothing is supposed to leave it. Callers that
 * report dead ends need that distinction, because "has no outgoing edge" means
 * "the chain could not place it" for every rank except the last, where it just
 * means "this is the end of the chain". Reporting the terminal rank would
 * accuse every node in it.
 */
export function chainRanks(chain: RelationChain): GraphNodeKind[] {
  return [chain.start.kind, ...chain.hops.map((h) => h.kind)];
}

/**
 * Every node of `kind` that no edge leaves — the elements the chain could not
 * place, the rooms in no zone.
 *
 * Meaningless for a chain's terminal rank; see {@link chainRanks}.
 *
 * Offered because it is the number worth putting on screen next to the drawing:
 * "12 of 340 detectors sit in no room" is a modelling finding, and a drawing
 * that shows it without saying it will be read as complete.
 */
export function danglingNodes(graph: Graph, kind: GraphNodeKind): GraphNode[] {
  const hasOutgoing = new Set(graph.edges.map((e) => e.source));
  return graph.nodes.filter((n) => n.kind === kind && !hasOutgoing.has(n.id));
}
