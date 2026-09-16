/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Copy an entity and everything it references OUT OF ANOTHER FILE into this
 * model's overlay.
 *
 * # What this is for
 * Placing a library object — an Elementbeispiel from the dictionary, a family
 * from a shelf — means bringing its real geometry into the model being edited.
 * Not a box of the right size: the actual profiles, booleans and styles
 * somebody modelled. Those live as a little graph of STEP entities hanging off
 * the product's `Representation`, and the graph has to arrive here with every
 * express id renumbered into this model's space.
 *
 * # Parser-free, on purpose
 * The source is reached through a `ReadSourceEntity` callback, exactly as
 * `duplicate.ts` takes already-extracted attributes: `@ifc-lite/create` has no
 * parser dependency and should not grow one. The caller parses, this copies.
 * It also makes the whole thing testable from a plain object map, which is how
 * the cases below are pinned.
 *
 * # Substitution is the whole idea
 * A naive deep copy would drag the source file's representation CONTEXT, its
 * owner history, and through them its units and its project, into this model —
 * a second `IfcProject` in a file that already has one, and geometry declared
 * against a context nobody here uses. So the walk carries a map of
 * "you already have one of these", pre-seeded by the caller, and stops at every
 * id it finds there.
 *
 * The representation context is the load-bearing case and the one that is easy
 * to get wrong: it is where the file states its length unit and its precision.
 * Pointing the copied geometry at the TARGET's context is what makes the
 * numbers mean what this model means by them — and the caller is responsible
 * for scaling them, because a metre in the source is not a millimetre here.
 * This function renumbers; it does not convert.
 */

import type { IfcAttributeValue, StoreEditor } from '@ifc-lite/mutations';

/** One entity of the SOURCE file, as `EntityExtractor.extractEntity` gives it. */
export interface SourceEntity {
  type: string;
  attributes: IfcAttributeValue[];
}

/** Read an entity out of the source file. `null` for an id that is not there. */
export type ReadSourceEntity = (expressId: number) => SourceEntity | null;

export interface CopySubgraphOptions {
  /**
   * Source id → target id, for everything that must NOT be copied.
   *
   * Seeded by the caller with at least the source's representation
   * context(s) mapped to this model's, and its owner history mapped to this
   * model's. Grows as the walk proceeds, so a subgraph shared by two roots is
   * copied once — which is also what keeps a diamond from becoming two
   * separate copies of the same profile.
   */
  readonly substitutions: Map<number, number>;
  /**
   * Types to drop rather than copy, replaced by `$` at the referencing slot.
   *
   * For entities that are meaningless here and have no counterpart to
   * substitute — the source's `IfcPresentationLayerAssignment`, say. An empty
   * set is the normal case.
   */
  readonly drop?: ReadonlySet<string>;
}

/**
 * How deep a legitimate representation graph goes, plus room.
 *
 * A guard, not a limit anybody should meet: profiles nest a few levels, a
 * boolean tree a few more. A file that exceeds this is malformed or hostile,
 * and the alternative to a bound is a stack overflow — which aborts the
 * process rather than failing the paste.
 */
const MAX_DEPTH = 64;

/** `"#42"` → `42`, for anything else `null`. */
function referencedId(value: IfcAttributeValue): number | null {
  if (typeof value !== 'string' || value.charCodeAt(0) !== 0x23 /* # */) return null;
  const id = Number(value.slice(1));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Copy `rootId` and everything below it, returning its new express id.
 *
 * Depth-first, so every id a record references already exists by the time the
 * record itself is written. `substitutions` is updated in place: after the
 * call it holds the full source→target mapping, which is what lets a caller
 * copy several roots that share geometry and then find, say, which target
 * entity the source's `#31` became.
 *
 * @throws if the source is missing an id the graph references, or if the graph
 *         is cyclic — both mean the copy would be wrong, and a wrong paste is
 *         worse than a refused one.
 */
export function copySubgraph(
  editor: StoreEditor,
  read: ReadSourceEntity,
  rootId: number,
  options: CopySubgraphOptions,
): number {
  const { substitutions, drop } = options;
  // Path-scoped, not global: a diamond (two parents, one shared profile) is
  // legal and common, and a visited-set that never forgets would call the
  // second visit a cycle.
  const onPath = new Set<number>();

  const copy = (id: number, depth: number): number => {
    const already = substitutions.get(id);
    if (already !== undefined) return already;

    if (depth > MAX_DEPTH) {
      throw new Error(`copySubgraph: reference chain deeper than ${MAX_DEPTH} at #${id}`);
    }
    if (onPath.has(id)) {
      throw new Error(`copySubgraph: cyclic reference at #${id}`);
    }

    const source = read(id);
    if (!source) {
      throw new Error(`copySubgraph: the source has no entity #${id}`);
    }

    onPath.add(id);
    const attributes = source.attributes.map((value) => remap(value, depth + 1));
    onPath.delete(id);

    const target = editor.addEntity(source.type, attributes).expressId;
    substitutions.set(id, target);
    return target;
  };

  /** Is this reference to something the caller asked to leave behind? */
  const dropped = (id: number): boolean => {
    if (!drop?.size) return false;
    const source = read(id);
    return source !== null && drop.has(source.type);
  };

  const remap = (value: IfcAttributeValue, depth: number): IfcAttributeValue => {
    if (Array.isArray(value)) {
      const members: IfcAttributeValue[] = [];
      for (const member of value) {
        // A dropped member leaves the LIST SHORTER rather than holding a `$`.
        // An aggregate of n-1 things is valid STEP; one with a hole in it is
        // not, and `$` inside a SET OF IfcRepresentationItem is exactly the
        // kind of record a reader accepts and then cannot use.
        const id = referencedId(member);
        if (id !== null && dropped(id)) continue;
        members.push(remap(member, depth));
      }
      return members;
    }
    const id = referencedId(value);
    if (id === null) return value;
    // At a single-valued slot a dropped reference becomes `$`. That is only
    // correct where the attribute is OPTIONAL, which is why `drop` is for
    // entities the caller knows to be optional decoration.
    if (dropped(id)) return null;
    return `#${copy(id, depth)}`;
  };

  return copy(rootId, 0);
}
