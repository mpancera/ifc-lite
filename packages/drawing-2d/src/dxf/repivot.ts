/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning or resizing a placed drawing about a point you can SEE.
 *
 * `applyDxfPlacement` rotates and scales about the origin, and for a
 * georeferenced plan the origin is two and a half million metres away. A one
 * degree correction there swings the drawing forty kilometres: the number in
 * the field is right, the plan is gone, and the only way back is undo (Marc,
 * 2026-09-15: "wenn man justiert, darf der DXF Plan nicht komplett
 * wegdrehen").
 *
 * The fix is not a different placement format — the stored placement stays
 * exactly what the renderer already applies. It is to compensate the offset so
 * that one chosen point comes out where it went in. Everything else turns
 * around it, which is what turning something about a point means.
 *
 * WHICH point is the caller's to choose, and the useful answer is the one
 * being looked at: the centre of the view keeps the detail under the cursor
 * still while the rest swings. The centre of the drawing would be defensible
 * too, and is wrong for the case this exists for — adjusting by half a degree
 * while zoomed into a corner.
 */

import type { Point2D } from '../types.js';
import { inverseDxfPlacement } from './align.js';
import type { DxfPlacement } from './types.js';

/**
 * `placement` with `next` applied, adjusted so `pivot` does not move.
 *
 * `pivot` is in DRAWING space — the same space the offsets are in, and the
 * space a view centre is naturally expressed in.
 *
 * Returns the placement with only `next` merged when the current one cannot be
 * inverted (a zero scale). Refusing outright would leave the field dead; the
 * drawing jumps, which is the old behaviour and is at least undoable.
 */
export function repivotDxfPlacement(
  placement: DxfPlacement,
  next: Partial<DxfPlacement>,
  pivot: Point2D | null | undefined,
): DxfPlacement {
  const merged: DxfPlacement = { ...placement, ...next };
  if (!pivot) return merged;

  // The point of the drawing that is currently AT the pivot. Everything is
  // arranged so this same point lands there again.
  const anchor = inverseDxfPlacement(pivot, placement);
  if (!anchor) return merged;

  const rad = (merged.rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const x = anchor.x * merged.scale;
  const y = anchor.y * merged.scale;

  // `applyDxfPlacement` computes x*c + y*s + offsetX and -x*s + y*c + offsetY.
  // Solving those for the offsets that put the anchor back on the pivot.
  return {
    ...merged,
    offsetX: pivot.x - (x * c + y * s),
    offsetY: pivot.y - (-x * s + y * c),
  };
}
