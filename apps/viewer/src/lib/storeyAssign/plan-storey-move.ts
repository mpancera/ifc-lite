/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Refiling elements under the storey they belong to.
 *
 * # Why this is an edit and not two
 *
 * An element is contained in exactly ONE spatial structure element —
 * `IfcElement.ContainedInStructure` is a set of at most one. So moving an
 * element to another storey is not "add it there": it is remove-and-add, and
 * doing only the add leaves the element filed under two storeys at once. Every
 * reader then answers "which floor is this on?" differently depending on which
 * relationship it happened to walk first, which is worse than the wrong storey
 * it started on, because the wrong storey is at least consistent.
 *
 * Deciding the whole move up front, here, is what makes that atomic: the caller
 * gets one plan naming every relationship to rewrite, and applies it in one
 * batch rather than discovering halfway through that the target has no
 * relationship yet.
 *
 * # Containment only
 *
 * Containment and PLACEMENT are independent in IFC. Refiling an element does
 * not move it: its `ObjectPlacement` chain is untouched, so it stays exactly
 * where it is drawn and only the filing changes. That is the intent here — the
 * elements are in the right place and under the wrong storey (Marc,
 * 2026-09-10).
 *
 * The consequence to know: where an element's placement hangs off its old
 * storey's `IfcLocalPlacement`, it stays anchored to that storey's origin, so
 * changing THAT storey's elevation later would drag the element with it even
 * though it is now filed elsewhere. Re-parenting the placement and
 * compensating the height is a separate decision, deliberately not taken here.
 *
 * # An empty relationship is not a relationship
 *
 * `RelatedElements` is a set of at least one, so a relationship whose last
 * element leaves has to be dropped rather than written empty — an empty one is
 * schema-invalid and some readers refuse the file over it.
 */

/** One `IfcRelContainedInSpatialStructure`, as either half of the store holds it. */
export interface ContainmentRel {
  expressId: number;
  /** `RelatingStructure` — the storey, space or site doing the containing. */
  structureId: number;
  /** `RelatedElements`. */
  elementIds: readonly number[];
}

export interface StoreyMovePlan {
  /** Relationships that keep existing with a shorter list. */
  rewrites: { relExpressId: number; elementIds: number[] }[];
  /** Relationships whose last element left; they must be removed. */
  drops: number[];
  /** The target's relationship, or the one to create when it has none yet. */
  target:
    | { relExpressId: number; elementIds: number[] }
    | { create: true; elementIds: number[] };
  /** Elements this plan actually refiles. */
  moved: number[];
  /** Elements already contained in the target — nothing to do for them. */
  alreadyThere: number[];
  /** Elements no relationship contained; the move gives them their first. */
  wereUnfiled: number[];
}

/**
 * Plan the move of `elementIds` into `targetStructureId`.
 *
 * Returns `null` when there is nothing to do, so a caller can say "already
 * there" rather than reporting a successful edit that wrote nothing.
 */
export function planStoreyMove(
  rels: readonly ContainmentRel[],
  elementIds: readonly number[],
  targetStructureId: number,
): StoreyMovePlan | null {
  const wanted = [...new Set(elementIds)];
  if (wanted.length === 0) return null;

  // Which relationship holds each element. A malformed file can list one
  // element twice; the first relationship wins and the duplicate is cleaned up
  // by the same removal pass, since every relationship is filtered.
  const holder = new Map<number, number>();
  for (const rel of rels) {
    for (const id of rel.elementIds) {
      if (!holder.has(id)) holder.set(id, rel.expressId);
    }
  }

  const existing = rels.find((r) => r.structureId === targetStructureId) ?? null;
  const inTarget = new Set(existing?.elementIds ?? []);

  const moved: number[] = [];
  const alreadyThere: number[] = [];
  const wereUnfiled: number[] = [];
  for (const id of wanted) {
    if (inTarget.has(id)) {
      alreadyThere.push(id);
      continue;
    }
    moved.push(id);
    if (!holder.has(id)) wereUnfiled.push(id);
  }
  if (moved.length === 0) return null;

  const leaving = new Set(moved);
  const rewrites: { relExpressId: number; elementIds: number[] }[] = [];
  const drops: number[] = [];
  for (const rel of rels) {
    if (rel.expressId === existing?.expressId) continue;
    const kept = rel.elementIds.filter((id) => !leaving.has(id));
    if (kept.length === rel.elementIds.length) continue;
    if (kept.length === 0) drops.push(rel.expressId);
    else rewrites.push({ relExpressId: rel.expressId, elementIds: kept });
  }

  const targetList = [...(existing?.elementIds ?? []), ...moved];
  return {
    rewrites,
    drops,
    target: existing
      ? { relExpressId: existing.expressId, elementIds: targetList }
      : { create: true, elementIds: targetList },
    moved,
    alreadyThere,
    wereUnfiled,
  };
}
