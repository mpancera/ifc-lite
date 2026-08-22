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
  symmetricEdgeId,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type GraphNodeKind,
  type GraphRelation,
  type RelationDirection,
} from './types.js';

/**
 * Which way a hop follows its relationship.
 *
 * `both` is for relationships that have no inherent direction —
 * `IfcRelConnectsPorts` above all. A port can be listed as either end of a
 * connection depending on which one the authoring tool wrote first, so a hop
 * that only went one way would find half the plant. Edges from a `both` hop
 * are de-duplicated symmetrically (see `symmetricEdgeId`).
 */
export type HopDirection = RelationDirection | 'both';

/**
 * One way a hop's step is recorded in the file.
 *
 * Exists because a single modelling FACT has more than one legal carrier in
 * IFC, and which one a file uses is the exporter's choice, not the modeller's.
 * The port case is the one that bites: "these are the element's connection
 * points" is `IfcRelConnectsPortToElement` in an IFC2X3-era file and
 * `IfcRelNests` in an IFC4 one. A hop that knows only the first draws an empty
 * schematic from a perfectly good IFC4 model — and draws it without
 * complaining, which is the worst version of that bug.
 *
 * `keepTypes` may differ per carrier and usually must. `IfcRelConnectsPortToElement`
 * reaches nothing but ports, so it needs no filter; `IfcRelNests` reaches every
 * nested part there is, so without `['IfcDistributionPort']` it would rank an
 * assembly's bolts as connection points.
 */
export interface HopCarrier {
  relation: GraphRelation;
  direction: HopDirection;
  /** Defaults to the hop's own `keepTypes` when omitted. */
  keepTypes?: readonly string[];
}

export interface RelationHop {
  relation: GraphRelation;
  direction: HopDirection;
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
  /**
   * Further carriers for the SAME step, walked from the same frontier.
   *
   * Alternatives, not a sequence: each one starts where the hop started and
   * every target any of them reaches lands in the same rank. Two carriers that
   * reach the same pair produce one edge, because the id is derived from the
   * pair and the relation — the relation differs, so both edges are drawn, and
   * that is right: a file that states the same fact twice under two
   * relationships has stated it twice.
   */
  alsoVia?: readonly HopCarrier[];
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
    const traits = source.traitsOf?.(expressId);
    const node: GraphNode = {
      id,
      expressId,
      kind,
      ifcType,
      globalId: source.globalIdOf?.(expressId) ?? '',
      name: source.nameOf(expressId) ?? '',
      assetIdentifier: source.identifierOf?.(expressId) ?? '',
      tag: source.tagOf?.(expressId) ?? '',
      predefinedType: traits?.predefinedType ?? '',
      flowDirection: traits?.flowDirection ?? '',
      systemType: traits?.systemType ?? '',
    };
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
    // The hop's own carrier first, then its alternatives. All of them walk the
    // SAME frontier: they are different spellings of one step, not steps of
    // their own, so none of them may consume what a previous one produced.
    const carriers: readonly HopCarrier[] = [
      { relation: hop.relation, direction: hop.direction, keepTypes: hop.keepTypes },
      ...(hop.alsoVia ?? []),
    ];
    for (const carrier of carriers) {
      const keep = new Set(carrier.keepTypes ?? hop.keepTypes);
      const symmetric = carrier.direction === 'both';
      for (const from of frontier) {
        const targets =
          carrier.direction === 'both'
            ? [
                ...source.related(from.expressId, carrier.relation, 'forward'),
                ...source.related(from.expressId, carrier.relation, 'inverse'),
              ]
            : source.related(from.expressId, carrier.relation, carrier.direction);
        for (const targetId of targets) {
          // A symmetric hop can reach the node it started from when a file
          // records something as connected to itself. Drawing that as an edge
          // from a box to the same box says nothing.
          if (symmetric && targetId === from.expressId) continue;
          const targetType = source.typeOf(targetId);
          if (!targetType) continue;
          if (keep.size > 0 && !keep.has(targetType)) continue;
          const to = addNode(targetId, hop.kind);
          if (!to) continue;
          const id = symmetric
            ? symmetricEdgeId(from.id, to.id, carrier.relation)
            : edgeId(from.id, to.id, carrier.relation);
          // One relationship, one line — even when the chain arrives at it
          // from both ends.
          //
          // `systemMembersInCircuit` walks `IfcRelAssignsToGroup` forward and
          // then inverse. Start it at a circuit rather than at the whole
          // installation and both hops cross the SAME membership: circuit to
          // device, then device back to circuit. Those get different ids
          // because the id carries the direction, so the drawing grew a second
          // line on top of the first, with its label stacked on the first
          // label. Measured on a real model: six nodes, ten edges, five of
          // them saying what the other five already said.
          const mirrored = edgeId(to.id, from.id, carrier.relation);
          if (!edges.has(id) && !edges.has(mirrored)) {
            const info = source.edgeInfoOf?.(from.expressId, to.expressId, carrier.relation);
            edges.set(id, {
              id,
              source: from.id,
              target: to.id,
              relation: carrier.relation,
              ...(symmetric ? { symmetric: true } : {}),
              ...(info?.name ? { name: info.name } : {}),
              ...(info?.realizedBy != null ? { realizedBy: info.realizedBy } : {}),
            });
          }
          next.push(to);
        }
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
 * An installation, its devices, and the CIRCUIT each device is wired into.
 *
 * # The distinction this chain exists to make visible
 * Two different questions get asked of a fire detection installation and they
 * have different answers:
 *
 *  - *which detectors trigger together* — the Auslösezone. That is a grouping
 *    of ROOMS, and the drawing for it is `elementInSpaceInZone`: detector →
 *    room → zone.
 *  - *which detectors sit on one cable, in what order* — the Melderkreis. That
 *    is a partition of the wiring, and it is what IFC means by
 *    `IfcDistributionCircuit`: "a partition of a distribution system that is
 *    conditionally switched, such as an electrical circuit". IFC4 introduced it
 *    precisely to replace IFC2X3's `IfcElectricalCircuit`.
 *
 * The two are independent. One loop can serve several zones, and one zone can
 * be wired as two loops — so neither can be derived from the other, and a
 * model that carries only one of them is missing half the installation.
 *
 * # A circuit is a subtype of a system, which is why the filter is here
 * Walking `IfcRelAssignsToGroup` inverse from a device reaches EVERY grouping
 * it belongs to: the installation it is a member of, any zone, and the circuit.
 * `keepTypes` picks out the circuits, which is what makes the third rank mean
 * "wiring" rather than "every group this device is in".
 *
 * # An empty third rank is the answer, not a failure
 * Until somebody records which detector hangs on which loop, every device is a
 * dead end here. That is the honest picture of a model that has the trigger
 * logic and not the wiring — and it is the reason to draw it rather than to
 * hide it behind a chain that had no circuits to show.
 */
export function systemMembersInCircuit(systemIds: readonly number[]): RelationChain {
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
        // Inverse: from the device to the groupings that contain it.
        relation: 'IfcRelAssignsToGroup',
        direction: 'inverse',
        keepTypes: ['IfcDistributionCircuit'],
        kind: 'system',
      },
    ],
  };
}

/**
 * Plant topology: element → its ports → the ports those are joined to.
 *
 * The first chain that draws a real plant rather than a location tree. It
 * reads element–port–port–element, which is what a schematic IS: the ports are
 * what the connection is between, and the elements hang off them.
 *
 * # Why there is no fourth hop back to the elements
 * There does not need to be. Every element of the chosen types is already a
 * node at the start, and emits its own element→port edge — so the far side of
 * a connection is drawn by that element's own first hop, not by walking back.
 * A fourth hop would add nothing and would make the terminal rank ambiguous
 * with the first (both `element`), which is exactly what makes a dead-end
 * count meaningless.
 *
 * The consequence is worth knowing: a port whose element is NOT among the
 * chosen types hangs there connected to nothing visible. That is honest —
 * widening the type selection brings it in — and it is why the picker shows
 * every class the model holds with its count.
 *
 * # Both directions, on purpose
 * `IfcRelConnectsPorts` has no inherent direction; which port a file lists
 * first is an authoring artifact. Walking one way would find half the plant.
 *
 * # Two ways to reach a port, and a model uses exactly one
 * `IfcRelConnectsPortToElement` is how IFC2X3 says "this port sits on that
 * element". IFC4 deprecated it and puts the ports UNDER the element with
 * `IfcRelNests` instead. Both are in the wild — the schema a model was
 * exported in decides which — so the first hop follows both and lets the file
 * answer. Before this, a clean IFC4 plant model drew as a row of unconnected
 * boxes: every device found, not one connection between them, and no error to
 * explain it.
 *
 * The nesting carrier is filtered to `IfcDistributionPort` and the
 * port-to-element one is not, on purpose. Nesting is the general
 * whole-and-parts relationship — an assembly nests its components — so
 * unfiltered it would rank a pump's impeller as a connection point.
 * `IfcRelConnectsPortToElement` reaches nothing but ports by definition, and
 * filtering it would drop a port modelled as something other than
 * `IfcDistributionPort`, which some 2X3 exporters do.
 */
export function plantTopology(elementTypes: readonly string[]): RelationChain {
  return {
    start: { kind: 'element', types: elementTypes },
    hops: [
      {
        // Inverse: from the element to the ports that sit on it. Forward runs
        // port → element, the way the EXPRESS attributes are ordered.
        relation: 'IfcRelConnectsPortToElement',
        direction: 'inverse',
        keepTypes: [],
        kind: 'port',
        alsoVia: [
          {
            // Forward: the element is the RelatingObject, its ports the
            // RelatedObjects — the opposite reading from the relation above,
            // which is exactly why direction belongs to the carrier.
            relation: 'IfcRelNests',
            direction: 'forward',
            keepTypes: ['IfcDistributionPort'],
          },
        ],
      },
      {
        relation: 'IfcRelConnectsPorts',
        direction: 'both',
        keepTypes: [],
        kind: 'port',
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
  const reached = new Set<string>();
  for (const e of graph.edges) {
    reached.add(e.source);
    // A symmetric edge leads away from BOTH of its ends — which one is stored
    // as the target is an accident of the walk. Counting only sources reported
    // half of a fully-connected plant's ports as loose.
    if (e.symmetric) reached.add(e.target);
  }
  return graph.nodes.filter((n) => n.kind === kind && !reached.has(n.id));
}
