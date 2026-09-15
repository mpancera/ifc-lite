/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which derived layers a plan draws — remembered.
 *
 * Room labels, opening symbols, door tags, device marks, zone outlines,
 * compartments: each is switched on or off deliberately, and every one of them
 * came back on at the next reload (Marc, 2026-09-16). Six switches to set again
 * every time is the kind of tax that ends with people not using the switches.
 *
 * ## Not project-scoped, on purpose
 *
 * "I do not want door tags on my plans" is a statement about how somebody
 * reads a drawing, not about a building — the same person wants the same
 * layers in the next project. That is the same line the saved lists and lenses
 * are on, and the opposite of the plan ROTATION, which is a fact about one
 * building and is scoped to it.
 *
 * ## Stored as a diff from the defaults
 *
 * Only switches that differ from the default are written. A new switch added
 * later then starts at ITS default for everybody, instead of being forced off
 * by a stored record that predates it and says nothing about it.
 */

const STORAGE_KEY = 'ifc-lite:plan-display';

/** Every remembered switch, with the value a fresh session starts at. */
export const PLAN_DISPLAY_DEFAULTS = {
  planShowRoomLabels: true,
  planShowOpeningSymbols: true,
  planShowDoorLabels: true,
  planShowDeviceMarks: true,
  planShowZoneOutlines: false,
  planShowCompartments: false,
} as const;

export type PlanDisplayFlags = { -readonly [K in keyof typeof PLAN_DISPLAY_DEFAULTS]: boolean };

function storage(): Storage | null {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

/**
 * The remembered switches, defaults filled in.
 *
 * A malformed or partial record contributes whatever it does hold and nothing
 * else: forgetting one switch is a shrug, and there is no value in refusing
 * the other five over it.
 */
export function loadPlanDisplay(): PlanDisplayFlags {
  const result = { ...PLAN_DISPLAY_DEFAULTS } as PlanDisplayFlags;
  const store = storage();
  if (!store) return result;

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return result;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return result;
    for (const key of Object.keys(PLAN_DISPLAY_DEFAULTS) as (keyof PlanDisplayFlags)[]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'boolean') result[key] = value;
    }
    return result;
  } catch (err) {
    console.warn(`[plan] ignoring malformed display flags in ${STORAGE_KEY}`, err);
    return result;
  }
}

/** Remember the switches that differ from the defaults. */
export function savePlanDisplay(flags: Partial<PlanDisplayFlags>): void {
  const store = storage();
  if (!store) return;

  const diff: Record<string, boolean> = {};
  for (const key of Object.keys(PLAN_DISPLAY_DEFAULTS) as (keyof PlanDisplayFlags)[]) {
    const value = flags[key];
    if (typeof value === 'boolean' && value !== PLAN_DISPLAY_DEFAULTS[key]) diff[key] = value;
  }

  try {
    if (Object.keys(diff).length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(diff));
  } catch (error) {
    console.warn('[plan] could not persist display flags', error);
  }
}
