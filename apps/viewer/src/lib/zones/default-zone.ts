/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where a freshly added zone should sit.
 *
 * The old answer was a fixed 5 × 3 × 5 m box at the world origin. That is only
 * right for a model centred on the origin and no taller than three metres —
 * and wrong the moment either fails. On a real site the origin lands at a
 * corner of the terrain, so the new zone appears as a speck at the edge of the
 * scene and classifies nothing. The feature then looks broken rather than
 * unplaced, which is exactly how it was reported.
 *
 * So the default is derived from what is actually loaded: a box centred on the
 * BUILDING, covering a readable share of its footprint. Big enough to catch
 * something on the first click, small enough that the intent ("now drag it
 * where you want it") is obvious.
 *
 * "Building", not "scene": a site plate routinely dwarfs what stands on it —
 * measured on a real project, terrain 138 × 149 m against a building of
 * 44 × 38 m sitting off to one side. Centring on the scene puts the new zone
 * over empty ground, which fails the same way the origin box did.
 *
 * Pure — bounds in, box out. The caller reads the bounds from the renderer.
 */

import type { Zone } from './types.js';

/** An axis-aligned box in the viewer's world frame (Y-up), metres. */
export interface WorldBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * Share of the model's footprint a new zone spans.
 *
 * A third: unmistakably a part rather than the whole, and on a typical floor
 * plate still large enough to contain rooms.
 */
export const NEW_ZONE_FOOTPRINT_FRACTION = 1 / 3;

/** Fallback when nothing is loaded — the historical box, and now only used
 *  when there is genuinely no model to measure against. */
export const FALLBACK_ZONE_SIZE: readonly [number, number, number] = [5, 3, 5];

/** Below this the scene is a point, not a model, and fractions of it are
 *  meaningless. */
const DEGENERATE_EXTENT_M = 0.01;

/**
 * A sensible box for a new zone in the given scene.
 *
 * The FULL height is deliberate: a compartment that stops halfway up the
 * building silently excludes the elements above it, and "too tall" is visible
 * at a glance while "too short" is not.
 *
 * `null` bounds (nothing loaded, renderer not ready) fall back to the fixed
 * box — no model means no better answer is available.
 */
export function defaultZoneGeometry(
  bounds: WorldBounds | null,
): Pick<Zone, 'center' | 'size' | 'rotationY'> {
  if (!bounds) {
    return { center: [0, 0, 0], size: [...FALLBACK_ZONE_SIZE], rotationY: 0 };
  }

  const extent = [0, 1, 2].map((a) => bounds.max[a] - bounds.min[a]);
  const center = [0, 1, 2].map((a) => (bounds.min[a] + bounds.max[a]) / 2) as [number, number, number];

  // A degenerate axis (a single storey slab, a flat site) would otherwise
  // produce a zero-height box that can never contain anything.
  const size = [0, 1, 2].map((a) => {
    if (extent[a] < DEGENERATE_EXTENT_M) return FALLBACK_ZONE_SIZE[a];
    // Full height, a fraction of the footprint.
    return a === 1 ? extent[a] : extent[a] * NEW_ZONE_FOOTPRINT_FRACTION;
  }) as [number, number, number];

  return { center, size, rotationY: 0 };
}

/** The renderer reports bounds as `{x,y,z}` vectors; zones speak in tuples. */
export function toWorldBounds(
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null,
): WorldBounds | null {
  if (!bounds) return null;
  return {
    min: [bounds.min.x, bounds.min.y, bounds.min.z],
    max: [bounds.max.x, bounds.max.y, bounds.max.z],
  };
}

/**
 * The union of several boxes, or `null` when there are none.
 *
 * Used to reduce the rooms' bounding boxes to one "this is the building"
 * extent.
 */
export function mergeBounds(boxes: Iterable<WorldBounds>): WorldBounds | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let any = false;

  for (const box of boxes) {
    any = true;
    for (const a of [0, 1, 2] as const) {
      if (box.min[a] < min[a]) min[a] = box.min[a];
      if (box.max[a] > max[a]) max[a] = box.max[a];
    }
  }
  return any ? { min, max } : null;
}

/**
 * The first bounds worth using.
 *
 * Callers hand in their preference order — rooms first, whole scene last — so
 * a model without rooms still gets a usable box instead of nothing.
 */
export function preferBounds(...candidates: Array<WorldBounds | null>): WorldBounds | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const spans = [0, 1, 2].some((a) => candidate.max[a] - candidate.min[a] >= DEGENERATE_EXTENT_M);
    if (spans) return candidate;
  }
  return null;
}
