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
}
