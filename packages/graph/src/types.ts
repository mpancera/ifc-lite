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
  /** The entity's `Name`, or an empty string when it carries none. */
  name: string;
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
