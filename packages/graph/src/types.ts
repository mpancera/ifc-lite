/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The neutral graph: what a schematic drawing is made of, before anything
 * knows how to lay it out or paint it.
 *
 * Deliberately free of geometry. A graph node carries no x/y — position is the
 * layout stage's answer, not the model's. That is the whole point of the split:
 * the same `{nodes, edges}` can be laid out as a layered schematic today and as
 * something else tomorrow without the extraction changing.
 */

/**
 * What a node stands for.
 *
 * Not an IFC type — `ifcType` carries that exactly. This is the *role* a node
 * plays in the drawing, which is what decides its shape and its rank in the
 * layout. Many IFC types map onto `element`; only the ones a schematic treats
 * differently get their own kind.
 */
export type GraphNodeKind =
  /** Anything the drawing hangs off: a detector, a luminaire, a valve. */
  | 'element'
  /** `IfcSpace` — the room an element sits in. */
  | 'space'
  /** `IfcBuildingStorey`. */
  | 'storey'
  /** `IfcZone` — a non-geometric grouping of spaces. */
  | 'zone'
  /** `IfcSystem` and its subtypes — the trade system an element belongs to. */
  | 'system'
  /**
   * `IfcDistributionPort` and its kin — the connection point on an element.
   *
   * Its own rank rather than folded into `element`, because a schematic reads
   * as element–port–port–element: the ports are what the connection is
   * actually between, and hiding them would leave an edge whose ends the
   * model does not agree with.
   */
  | 'port';

/**
 * The IFC relationship an edge stands for, by its exact EXPRESS name.
 *
 * Spelled out rather than aliased ("Contains", "Groups") because the name IS
 * the meaning here: a reader of the drawing has to be able to tell a
 * `IfcRelContainedInSpatialStructure` edge from a
 * `IfcRelReferencedInSpatialStructure` one, and any shorter name loses exactly
 * that distinction.
 */
export type GraphRelation =
  | 'IfcRelContainedInSpatialStructure'
  | 'IfcRelReferencedInSpatialStructure'
  | 'IfcRelAggregates'
  /**
   * Decomposition into PARTS rather than into a spatial breakdown — and, from
   * IFC4 on, the relationship that carries an element's ports.
   *
   * Its own entry rather than folded into `IfcRelAggregates` because the two
   * answer different questions of the same model: a pump aggregated out of a
   * skid is a different statement from a pump nesting the two ports it is
   * wired through. A source that cannot tell them apart is free to answer both
   * from one index, and says so.
   */
  | 'IfcRelNests'
  | 'IfcRelAssignsToGroup'
  | 'IfcRelConnectsPortToElement'
  | 'IfcRelConnectsPorts';

/**
 * Which way an edge is followed.
 *
 * `forward` runs from the relationship's `RelatingObject` to its
 * `RelatedObjects` (storey → its elements, zone → its spaces); `inverse` runs
 * the other way (element → its storey). Both names match what
 * `IfcRelationshipIndex.getRelated` in the parser calls them, so the two never
 * have to be mentally translated at the boundary.
 */
export type RelationDirection = 'forward' | 'inverse';

export interface GraphNode {
  /** Unique within one graph. The express id as a string. */
  id: string;
  expressId: number;
  kind: GraphNodeKind;
  /** Exact EXPRESS name in IfcPascalCase, e.g. `IfcSensor`. */
  ifcType: string;
  /**
   * The IFC `GlobalId` — a 22-character GUID — or `''` when unknown.
   *
   * The only identity in the model that survives a re-export. The express id
   * does not: it is a position in one file, and the next save renumbers it.
   * A drawing does not need this; anything that hands rows to another system
   * and expects to hand them back does, because without it the round trip has
   * to match on names, and a renamed room becomes a new object.
   */
  globalId: string;
  /** The entity's `Name`, or an empty string when it carries none. */
  name: string;
  /**
   * The occurrence's asset identifier — `A.01.03_FST.RM.001` — or `''`.
   *
   * On the node rather than looked up at draw time because the export needs it
   * too, and a graph handed to a caller should answer for itself. Empty for
   * every node that has none, which is most of them: rooms, storeys and zones
   * are not numbered this way.
   */
  assetIdentifier: string;
  /**
   * The `PredefinedType` enum token — `FIRESENSOR`, `CABLE`, `NOTDEFINED` — or
   * `''`.
   *
   * The class alone under-describes a device: every fire detector, every
   * smoke damper and every thermostat in a model is an `IfcSensor` or an
   * `IfcActuator`, and what separates them is exactly this slot. A drawing
   * that shows only the class shows a plant of identical boxes, and a list
   * exported from it cannot be matched against a schematic that names the
   * function.
   */
  predefinedType: string;
  /**
   * `IfcElement.Tag` — the mark the element carries on the drawing, or `''`.
   *
   * Distinct from `assetIdentifier` and both are worth having: the identifier
   * is the occurrence's number in the building (`LM.01.1.04_FST.RM.001`), the
   * tag is its number in whatever it is part of — on a wired run, its position
   * on the cable (`MK03.01`). A drawing of a run that showed only the first
   * would be a drawing of a run with no order in it.
   */
  tag: string;
  /**
   * `IfcDistributionPort.FlowDirection` — `SOURCE`, `SINK`, `SOURCEANDSINK` —
   * or `''` for everything that is not a distribution port.
   *
   * This is what turns a connection graph into a CIRCUIT. Without it every
   * edge is a bare adjacency and there is no answer to "which end feeds which"
   * — no supply, no load, no direction to follow from a distribution board
   * outward. Empty on every non-port node, and empty on ports whose file
   * leaves the slot unset, which is itself worth seeing.
   */
  flowDirection: string;
  /**
   * `IfcDistributionPort.SystemType` — `ELECTRICAL`, `LIGHTING`,
   * `FIREPROTECTION` — or `''`.
   *
   * The trade a port belongs to, stated on the port itself. A device carrying
   * both a power port and a bus port is one element in two systems, and only
   * this slot says which port is which.
   */
  systemType: string;
}

export interface GraphEdge {
  /** Unique within one graph. Derived from source, target and relation. */
  id: string;
  source: string;
  target: string;
  relation: GraphRelation;
  /**
   * True when the relation has no direction — two joined ports, say.
   *
   * `source` and `target` still hold whichever way the walk happened to
   * arrive, because a renderer needs two ends. This flag says not to read
   * meaning into which is which: without it, "has no outgoing edge" counts
   * every target end of a symmetric edge as a dead end, and a plant where
   * every port is connected reports half of them as loose.
   */
  symmetric?: boolean;
  /**
   * The relationship's own `Name`, when it carries one.
   *
   * On `IfcRelConnectsPorts` this is where a producer writes the circuit or
   * cable designation, which is the one piece of schematic identity the edge
   * has. Absent rather than `''` when unset, so a reader can tell "no name in
   * the file" from "named with an empty string".
   */
  name?: string;
  /**
   * Express id of `IfcRelConnectsPorts.RealizingElement` — the cable, the duct,
   * the pipe that MAKES this connection — when the file names one.
   *
   * An id and not a node: the realizing element is usually not part of the
   * chain being drawn, and pulling it in would silently add a rank nobody
   * asked for. A caller that wants to resolve it has the source.
   */
  realizedBy?: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** The edge id for a given triple. One relation between two nodes, once. */
export function edgeId(source: string, target: string, relation: GraphRelation): string {
  return `${source}-${relation}-${target}`;
}

/**
 * The edge id for a relation with no inherent direction.
 *
 * Two ports joined by `IfcRelConnectsPorts` are joined, full stop — which of
 * them the file happens to list as `RelatingPort` is an authoring artifact,
 * not a fact about the plant. Walked from both ends, the same connection
 * would otherwise arrive twice under two ids and be drawn as two lines
 * between the same pair.
 */
export function symmetricEdgeId(a: string, b: string, relation: GraphRelation): string {
  return a <= b ? `${a}-${relation}-${b}` : `${b}-${relation}-${a}`;
}
