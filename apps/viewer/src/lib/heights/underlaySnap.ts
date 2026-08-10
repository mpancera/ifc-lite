/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Snapping a click onto the imported plan.
 *
 * The measure tool already snaps to the MODEL section. Aligning needs the
 * other half: the fitting line is drawn on the plan, and it has to catch the
 * plan's own corners — a wall end, an axis crossing — because those are the
 * features somebody picks when they say "this is that".
 *
 * Kept separate from the model's snapping on purpose. Snapping both to
 * whatever happens to be nearest would quietly pull a plan point onto the very
 * geometry the plan is being aligned against, which then looks like a perfect
 * fit and is really a tautology.
 *
 * Works in DRAWING space, so the underlay's current placement is applied to
 * its geometry before comparing. The caller converts the result back into the
 * underlay's own coordinates.
 */

import { applyDxfPlacement } from '@ifc-lite/drawing-2d';
import type { DxfUnderlayState } from '@/store/slices/drawing2DSlice';

interface Point {
  x: number;
  y: number;
}

/**
 * The nearest vertex of a visible plan layer within `tolerance`, or `null`.
 *
 * **Vertices only, not points along an edge.** A person aligning two drawings
 * picks corners, and an edge snap sliding along a wall would land somewhere
 * that cannot be found again on the other drawing — which is exactly what has
 * to match.
 *
 */
export function snapToUnderlay(
  state: DxfUnderlayState,
  point: Point,
  tolerance: number,
): Point | null {
  let best: Point | null = null;
  let bestDist = tolerance;

  for (const layer of state.underlay.layers) {
    // Hidden layers are skipped: something switched off is something the
    // person decided not to work with, and catching it would be a snap to an
    // invisible feature.
    if (state.layerVisibility[layer.name] === false) continue;

    for (const path of layer.paths) {
      for (const vertex of path.points) {
        const placed = applyDxfPlacement(vertex, state.placement);
        const dist = Math.hypot(placed.x - point.x, placed.y - point.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = placed;
        }
      }
    }
  }

  return best;
}
