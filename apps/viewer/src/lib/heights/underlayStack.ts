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
