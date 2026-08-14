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
  | 'system';

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
  | 'IfcRelAssignsToGroup';

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
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** The edge id for a given triple. One relation between two nodes, once. */
export function edgeId(source: string, target: string, relation: GraphRelation): string {
  return `${source}-${relation}-${target}`;
}
