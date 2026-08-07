/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Editing a derived height system by hand.
 *
 * The derivation reads what the model says; this is where a user overrules it —
 * because the model is often wrong about exactly the thing the height system
 * exists to fix. Two rules run through all of it:
 *
 * 1. **An edited value is marked `manual`.** The source field is not decoration:
 *    a re-derivation must be able to tell what it may overwrite and what a
 *    person decided. Silently keeping `ifc-elevation-attribute` on a number a
 *    human typed would make the next update quietly discard their work.
 * 2. **Editing a storey's elevation moves its reference levels with it**, because
 *    they are offsets, not absolute heights. That is the whole point of the
 *    Vectorworks-style model and it needs no code — but it is the reason
 *    `setElevation` must never touch `levels`.
 *
 * Pure: a system in, a new system out. Nothing is mutated.
 */

import type { HeightSystem, ReferenceLevel, Storey } from './types.js';

/** Replace one storey, keeping the list sorted by elevation. */
function replaceStorey(system: HeightSystem, next: Storey): HeightSystem {
  const storeys = system.storeys
    .map((s) => (s.id === next.id ? next : s))
    .sort((a, b) => a.elevation - b.elevation);
  return { ...system, storeys };
}

/**
 * Set a storey's elevation, in metres.
 *
 * Marks it `manual` and re-sorts, so typing a level that moves a storey past
 * its neighbour reorders the list — and with it every storey height, since
 * those are derived from the order.
 */
export function setElevation(
  system: HeightSystem,
  storeyId: string,
  elevation: number,
): HeightSystem {
  const storey = system.storeys.find((s) => s.id === storeyId);
  if (!storey || !Number.isFinite(elevation)) return system;
  if (storey.elevation === elevation) return system;

  return replaceStorey(system, { ...storey, elevation, source: 'manual' });
}

/**
 * Rename a storey.
 *
 * Does NOT mark it manual: the name is display only and never a key, so
 * changing it says nothing about whether the elevation is still the model's.
 */
export function setStoreyName(
  system: HeightSystem,
  storeyId: string,
  name: string,
): HeightSystem {
  const storey = system.storeys.find((s) => s.id === storeyId);
  if (!storey || storey.name === name) return system;

  return replaceStorey(system, { ...storey, name });
}

/**
 * Set a storey's height by moving the storey ABOVE it.
 *
 * The list shows heights, so it must be possible to type one — but height is
 * not stored, it is the gap to the next storey. Editing it therefore moves the
 * neighbour, which is also the physically honest reading: making a floor
 * taller raises everything above it.
 *
 * Refused for the topmost storey, which has no neighbour to move, and for a
 * non-positive height, which would reorder the building.
 */
export function setStoreyHeight(
  system: HeightSystem,
  storeyId: string,
  height: number,
): HeightSystem {
  if (!Number.isFinite(height) || height <= 0) return system;

  const ordered = [...system.storeys].sort((a, b) => a.elevation - b.elevation);
  const index = ordered.findIndex((s) => s.id === storeyId);
  if (index < 0 || index === ordered.length - 1) return system;

  const below = ordered[index];
  const above = ordered[index + 1];
  const delta = below.elevation + height - above.elevation;
  if (delta === 0) return system;

  // Everything from the neighbour up shifts by the same amount, so the storeys
  // ABOVE keep their own heights. Moving only the neighbour would silently
  // change a second storey's height as a side effect of editing this one.
  const storeys = ordered.map((s, i) => (
    i > index ? { ...s, elevation: s.elevation + delta, source: 'manual' as const } : s
  ));

  return { ...system, storeys };
}

/** Set the project datum above sea level, or clear it back to "unknown". */
export function setDatumAboveSeaLevel(
  system: HeightSystem,
  datum: number | null,
): HeightSystem {
  if (datum === null) {
    const { datumAboveSeaLevel: _dropped, ...rest } = system;
    return rest;
  }
  if (!Number.isFinite(datum)) return system;
  return { ...system, datumAboveSeaLevel: datum };
}

/** Replace the system-wide reference levels. */
export function setReferenceLevels(
  system: HeightSystem,
  levels: readonly ReferenceLevel[],
): HeightSystem {
  return { ...system, referenceLevels: [...levels] };
}

/**
 * Give a storey its own reference levels, or drop back to the system's.
 *
 * `null` removes the override. An empty ARRAY is kept — it means "this storey
 * deliberately has none", which is a different statement.
 */
export function setStoreyLevels(
  system: HeightSystem,
  storeyId: string,
  levels: readonly ReferenceLevel[] | null,
): HeightSystem {
  const storey = system.storeys.find((s) => s.id === storeyId);
  if (!storey) return system;

  if (levels === null) {
    const { levels: _dropped, ...rest } = storey;
    return replaceStorey(system, rest);
  }
  return replaceStorey(system, { ...storey, levels: [...levels] });
}
