/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Refiling a part means refiling the whole it belongs to.
 *
 * Click a curtain wall in 3D and what the picker hands back is an `IfcPlate` or
 * an `IfcMember` — the panel, not the wall. Those parts hang off the
 * `IfcCurtainWall` by `IfcRelAggregates` and are NOT contained in the storey
 * themselves: the spatial structure holds the whole, and the parts are located
 * through it. So the storey move looked like it did nothing — the parts were
 * filed under the new storey and the curtain wall stayed where it was (Marc,
 * 2026-09-13).
 *
 * Worse than nothing, in fact. IFC expects containment on the top-level element
 * of a decomposition; giving a part its own containment leaves the file
 * answering "which floor?" one way through the aggregate and another way
 * through the part.
 *
 * So every requested element is walked up to the outermost whole first. It is
 * also what was meant: nobody clicks a pane of glass intending to move the pane
 * out from under its wall.
 *
 * What this does NOT do: a part that carries its own containment anyway — some
 * exporters write one — keeps it. Dropping a relationship the user did not ask
 * about is not this action's business, and the part was already answering that
 * question twice before anybody clicked anything.
 */

/** How deep a decomposition may nest before we call it a cycle. */
const MAX_DEPTH = 16;

export interface LiftResult {
  /** What to actually refile — deduplicated, in first-seen order. */
  targets: number[];
  /** Every part that was replaced by its whole, for saying so afterwards. */
  lifted: { part: number; whole: number }[];
}

/**
 * Replace each id by the outermost element it is a part of.
 *
 * `parentOf` returns the aggregate parent or `null` — and `null` is what the
 * caller MUST answer for a spatial parent: site, building and storey decompose
 * through the same `IfcRelAggregates`, and walking into them would "lift" a
 * room to its storey and then try to file the storey somewhere. Keeping that
 * judgement in the caller leaves this function free of IFC class knowledge and
 * testable as the graph walk it is.
 */
export function liftToWholes(
  ids: readonly number[],
  parentOf: (id: number) => number | null,
): LiftResult {
  const targets: number[] = [];
  const seen = new Set<number>();
  const lifted: { part: number; whole: number }[] = [];

  for (const id of ids) {
    let whole = id;
    const visited = new Set<number>([id]);
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const parent = parentOf(whole);
      // A file where A aggregates B and B aggregates A would otherwise spin;
      // stopping leaves the deepest honest answer rather than none.
      if (parent === null || visited.has(parent)) break;
      visited.add(parent);
      whole = parent;
    }
    if (whole !== id) lifted.push({ part: id, whole });
    if (seen.has(whole)) continue;
    seen.add(whole);
    targets.push(whole);
  }

  return { targets, lifted };
}
