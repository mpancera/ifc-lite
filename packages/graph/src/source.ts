/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The four questions this package asks a model — and nothing else.
 *
 * Kept as a port rather than importing `IfcDataStore` directly so the
 * extraction stays testable against a hand-written model that fits on a screen.
 * A test that has to build a real store to prove a chain walks the right way
 * proves the store as much as the chain, and stops being read.
 *
 * The viewer implements this over the parsed store; the shapes line up
 * one-to-one with what is already there (`store.entities.getTypeName` /
 * `getName`, `store.relationships.getRelated`), so the adapter is a handful of
 * lines and carries no logic of its own.
 */

import type { GraphRelation, RelationDirection } from './types.js';

/**
 * The enum slots that decide what a node IS, beyond its class.
 *
 * One object rather than three questions because a source answers them from
 * one read of the entity — asking separately would re-parse it three times,
 * and on a plant model that is three passes over every port in the building.
 *
 * Every field optional: a source over a bare relationship table has nowhere to
 * read any of them from, and a missing field and an empty one mean the same
 * thing to the caller.
 */
export interface GraphNodeTraits {
  /** `IfcSensor.PredefinedType` = `FIRESENSOR`, `IfcDistributionPort` = `CABLE`. */
  predefinedType?: string | null;
  /** `IfcDistributionPort.FlowDirection` — `SOURCE`, `SINK`, `SOURCEANDSINK`. */
  flowDirection?: string | null;
  /** `IfcDistributionPort.SystemType` — `ELECTRICAL`, `LIGHTING`, … */
  systemType?: string | null;
}

/** What a relationship carries beyond the pair of ends it joins. */
export interface GraphEdgeInfo {
  /** The relationship's `Name`. */
  name?: string | null;
  /** `IfcRelConnectsPorts.RealizingElement` — the cable that makes the joint. */
  realizedBy?: number | null;
}

export interface GraphSource {
  /**
   * Express ids of every entity whose type is `ifcType` — exact EXPRESS name,
   * IfcPascalCase. Subtypes are NOT included: a caller that wants every
   * `IfcFlowTerminal` subtype asks for each one. Widening this to "type or
   * subtype" would need the schema, which this package deliberately has no
   * access to.
   */
  idsOfType(ifcType: string): readonly number[];

  /** The entity's exact EXPRESS name in IfcPascalCase, or `null` if unknown. */
  typeOf(expressId: number): string | null;

  /** The entity's `Name`, or `null` when it carries none. */
  nameOf(expressId: number): string | null;

  /**
   * The entity's IFC `GlobalId`, or `null` when the source cannot answer it.
   *
   * Optional like the rest: a hand-written model of ids and edges has no
   * GUIDs, and requiring them would make every such source invent some.
   */
  globalIdOf?(expressId: number): string | null;

  /**
   * The element's `Tag`, or `null`. The mark it carries on the drawing.
   *
   * Optional like the rest: a source over a bare relationship table has
   * nowhere to read it from.
   */
  tagOf?(expressId: number): string | null;

  /**
   * The entity's asset identifier, or `null` when it carries none.
   *
   * Optional because a source over a bare relationship table has nowhere to
   * read it from, and requiring it would make every such source lie with an
   * empty string. Absent and empty mean the same thing to the caller.
   */
  identifierOf?(expressId: number): string | null;

  /**
   * The entities `expressId` reaches over `relation` in `direction`.
   *
   * Order is the source's; the extraction does not depend on it.
   */
  related(
    expressId: number,
    relation: GraphRelation,
    direction: RelationDirection,
  ): readonly number[];

  /**
   * The enum slots of one entity, or `null` when the source cannot read them.
   *
   * Optional for the same reason `identifierOf` is: a hand-written test model
   * of ids and edges has no attributes at all, and requiring this would make
   * every such source invent them.
   */
  traitsOf?(expressId: number): GraphNodeTraits | null;

  /**
   * What the relationship between two entities carries, beyond the two ends.
   *
   * Asked per edge rather than handed back with `related`, because `related`
   * answers a set of ids and there is no room in it for per-pair payload
   * without changing what every caller of it gets. A source is expected to
   * have indexed this once — `buildRelationGraph` calls it for every edge it
   * creates.
   */
  edgeInfoOf?(
    fromExpressId: number,
    toExpressId: number,
    relation: GraphRelation,
  ): GraphEdgeInfo | null;
}
