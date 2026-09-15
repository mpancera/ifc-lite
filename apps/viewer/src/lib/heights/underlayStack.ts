/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where each imported plan sits, once it belongs to a storey.
 *
 * The step that turns a pile of drawings into a building: with an elevation
 * per plan they stack, and the 2.5D model has a vertical axis. Without one
 * they all lie at zero on top of each other, which is what a folder of DXFs
 * is before anybody says which floor is which.
 *
 * Pure on purpose — the storey assignment lives in the drawing slice, the
 * elevations in the height system, and neither should have to know about the
 * other to answer "how high does this plan sit".
 *
 * ## Why an assignment can dangle
 *
 * A plan points at a storey by ID, and a storey can be deleted afterwards. The
 * alternative — copying the elevation onto the plan — would survive the
 * deletion but stop agreeing the moment somebody corrects a level, and a plan
 * silently sitting at last week's height is worse than one that says it has
 * lost its storey.
 */

import type { HeightSystem } from './types.js';

export interface UnderlayPlacement {
  underlayId: string;
  /** Metres above the project datum, or `null` when it has no storey. */
  elevation: number | null;
  /** The storey's name, for the UI to show without a second lookup. */
  storeyName: string | null;
  /**
   * True when the plan names a storey the system no longer has.
   *
   * Distinct from "no storey": one is a plan waiting to be assigned, the other
   * is an assignment that broke. Only the second one is somebody's mistake.
   */
  dangling: boolean;
}

export interface UnderlayAssignment {
  id: string;
  storeyId?: string;
}

/** Where every plan sits. Order follows the input, not the elevation. */
export function placeUnderlays(
  underlays: readonly UnderlayAssignment[],
  system: HeightSystem | null,
): UnderlayPlacement[] {
  const byId = new Map((system?.storeys ?? []).map((s) => [s.id, s]));

  return underlays.map((u) => {
    if (u.storeyId === undefined) {
      return { underlayId: u.id, elevation: null, storeyName: null, dangling: false };
    }
    const storey = byId.get(u.storeyId);
    if (!storey) {
      return { underlayId: u.id, elevation: null, storeyName: null, dangling: true };
    }
    return {
      underlayId: u.id,
      elevation: storey.elevation,
      storeyName: storey.name,
      dangling: false,
    };
  });
}

/**
 * The storeys a plan can be assigned to, lowest first.
 *
 * Several plans may share a storey — a floor plan and a reflected ceiling plan
 * of the same level are two drawings of one storey, and refusing the second
 * would be inventing a rule the building does not have.
 */
export function assignableStoreys(
  system: HeightSystem | null,
): { id: string; name: string; elevation: number }[] {
  return [...(system?.storeys ?? [])]
    .sort((a, b) => a.elevation - b.elevation)
    .map((s) => ({ id: s.id, name: s.name, elevation: s.elevation }));
}

/** Plans whose storey has disappeared. The panel shows these so a broken
 *  assignment is repaired rather than silently ignored. */
export function danglingUnderlays(
  underlays: readonly UnderlayAssignment[],
  system: HeightSystem | null,
): string[] {
  return placeUnderlays(underlays, system).filter((p) => p.dangling).map((p) => p.underlayId);
}

/**
 * Whether a plan assigned to a storey belongs on the sheet being drawn.
 *
 * A DXF filed under the basement was drawn over every floor — not a
 * preference but a wrong drawing: the sheet says storey 00 and shows the
 * basement's walls (Marc, 2026-09-15).
 *
 * `sheetStoreyId` is the height system's key for the storey on the sheet,
 * `${modelId}:${expressId}`, or `null` when the sheet has no storey.
 *
 * ## Everything uncertain stays VISIBLE
 *
 * The comparison is made on ids and on nothing else. Elevations would be the
 * obvious fallback and are a trap: the sheet reads `IfcBuildingStorey.
 * Elevation` in the file's own length unit, the height system holds metres,
 * and a centimetre model would silently match the wrong floor — a wrong
 * drawing that looks right, which is the failure this is fixing.
 *
 * So four cases are shown rather than guessed at:
 *
 * - The plan has no storey. It has not been filed yet, and hiding it would
 *   hide the drawing somebody just imported before they can reach the field
 *   that would bring it back.
 * - The plan names a storey the system no longer has. A broken assignment is
 *   something to repair, not a reason to make a drawing vanish.
 * - The sheet has no storey.
 * - The sheet's storey is not in the height system at all — a system built by
 *   hand, or derived from a different model. Nothing here can say whether the
 *   two mean the same floor, so nothing here hides anything.
 */
export function underlayBelongsOnSheet(
  underlay: UnderlayAssignment,
  system: HeightSystem | null,
  sheetStoreyId: string | null,
): boolean {
  if (underlay.storeyId === undefined) return true;
  if (sheetStoreyId === null) return true;

  const storeys = system?.storeys ?? [];
  if (!storeys.some((s) => s.id === underlay.storeyId)) return true;
  if (!storeys.some((s) => s.id === sheetStoreyId)) return true;

  return underlay.storeyId === sheetStoreyId;
}
