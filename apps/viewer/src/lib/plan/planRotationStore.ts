/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Remembering how a project's plan is turned.
 *
 * # What this is not
 * It is NOT the model's north deviation, and nothing here is ever written into
 * the IFC. The building keeps the orientation it was modelled with; this
 * records only that somebody chose to look at it straight while working. Two
 * people can hold different values for the same building without either being
 * wrong, and a model exported from a turned session is byte-for-byte a model
 * exported from an unturned one.
 *
 * # Why it belongs to the project
 * The deviation a plan is turned against is a property of the building, so it
 * outlives a storey, a session and a reload — retyping it on every open is
 * exactly the kind of small tax that stops people using a feature. It rides
 * the same project-scoped storage as zones and annotations, for the same
 * reason: a second project must not inherit the first one's.
 */

import type { ProjectKey } from '@ifc-lite/project';
import { readScoped, writeScoped, clearScoped } from '@/lib/project/scopedStorage';

const STORAGE_KEY = 'ifc-lite:plan-rotation';

/**
 * The stored angle in radians, or `null` when the project has none.
 *
 * A stored value that is not a finite number is treated as absent rather than
 * coerced: a NaN angle turns the whole drawing into NaN coordinates, and the
 * plan would come up blank with nothing on screen saying why.
 */
export function loadPlanRotation(project: ProjectKey | null): number | null {
  const raw = readScoped(STORAGE_KEY, project);
  if (raw === null) return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    console.warn(`[plan] ignoring malformed rotation in ${STORAGE_KEY}`, raw);
    return null;
  }
  return value;
}

/**
 * Remember the angle, or forget it when the plan is straight again.
 *
 * Zero is stored as absence on purpose. "Not turned" is the default every
 * project starts from, so writing it would leave a row that says nothing, and
 * a project whose rotation is cleared should look like one that never had one.
 */
export function savePlanRotation(project: ProjectKey | null, radians: number): void {
  if (!Number.isFinite(radians) || radians === 0) {
    clearScoped(STORAGE_KEY, project);
    return;
  }
  writeScoped(STORAGE_KEY, project, String(radians));
}
