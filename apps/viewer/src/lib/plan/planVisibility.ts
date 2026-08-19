/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which elements the plan may DERIVE something for.
 *
 * # Why the derived layers need this at all
 * The cut is generated from the meshes, and the generator is handed the hidden
 * and isolated sets, so a wall that is gone or switched off leaves the drawing.
 * The layers drawn ON TOP of the cut — room text, door tags, opening symbols,
 * device marks — are derived from the spatial hierarchy and the raw mesh list
 * instead, and nothing there ever asked. So a room deleted a second ago kept
 * its stamp on the plan: the geometry it named was gone, the words stayed.
 * Reported from real use, deleting the wrongly detected rooms of a floor.
 *
 * # Deleted and not-drawn are two different answers
 * A deletion is a statement about the MODEL — the room does not exist, it will
 * not be in the export, and no view may claim otherwise. Hidden and isolated
 * are statements about this DRAWING. Both end in "no label", but only the
 * tombstone is checked against the overlay, because that is the only place
 * that knows; hiding is how deletion happens to be implemented in the
 * renderer, and leaning on that would make the label right by accident.
 *
 * # Global ids in, local ids out
 * The visibility sets speak the renderer's global id space, the hierarchy and
 * the overlay speak the model's local one. The conversion belongs here rather
 * than in each caller — three layers converting it three ways is how they
 * would end up disagreeing about the same element.
 */

/** True when the plan may draw something for this LOCAL express id. */
export type PlanElementTest = (expressId: number) => boolean;

export interface PlanVisibilitySources {
  /** Hidden elements, as global ids. */
  readonly hiddenGlobalIds?: ReadonlySet<number> | null;
  /**
   * Isolated elements as global ids, or `null` when nothing is isolated.
   *
   * `null` and an empty set differ: no isolation versus "isolate nothing",
   * which would strip every label off the drawing.
   */
  readonly isolatedGlobalIds?: ReadonlySet<number> | null;
  /** LOCAL express id → global id for the model being drawn. Identity by default. */
  readonly toGlobalId?: (expressId: number) => number;
  /** The mutation overlay's tombstone test, when there is an overlay. */
  readonly isDeleted?: (expressId: number) => boolean;
}

/** Draws everything — the answer when no model state restricts anything. */
const DRAWS_EVERYTHING: PlanElementTest = () => true;

export function planDrawsElement(sources: PlanVisibilitySources): PlanElementTest {
  const { isDeleted, toGlobalId } = sources;
  const hidden = sources.hiddenGlobalIds && sources.hiddenGlobalIds.size > 0
    ? sources.hiddenGlobalIds
    : null;
  const isolated = sources.isolatedGlobalIds ?? null;

  // The common case by far: nothing deleted, nothing hidden, no isolation.
  // Handing back one shared function lets the callers keep their memo.
  if (!isDeleted && !hidden && !isolated) return DRAWS_EVERYTHING;

  const global = toGlobalId ?? ((expressId: number) => expressId);

  return (expressId: number): boolean => {
    if (isDeleted?.(expressId)) return false;
    if (!hidden && !isolated) return true;
    const globalId = global(expressId);
    if (isolated && !isolated.has(globalId)) return false;
    return !hidden?.has(globalId);
  };
}

export default planDrawsElement;
