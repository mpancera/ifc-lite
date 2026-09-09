/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Whole footprint" helper for the Space Sketch tool: turn a storey's wall
 * rectangles into a single room covering the storey's exterior perimeter.
 *
 * `storeyContour` is the real thing: the line the exterior walls' outside faces
 * draw, read off the same arrangement the rooms come from. `exteriorPerimeter`
 * is the convex hull of the wall corners, which is that line only for a convex
 * plan — the moment there is a wing or a courtyard the hull spans it, and a
 * gross area measured on it counts the ground in between as floor.
 *
 * The two are kept apart on purpose. A caller that can live with an over-large
 * outline (the footprint button draws a room you can see and edit) may fall
 * back to the hull; a caller that cannot (the GFA figure, which nobody
 * re-measures) should emit nothing rather than a number that is wrong in a
 * direction it cannot detect. So `storeyContour` returns `null` instead of
 * quietly handing back the hull.
 *
 * Either outline is emitted as thin synthetic `WallRect`s so the existing
 * `SpacePlateSession.buildFromRects` path detects the single enclosed region.
 * Reusing that path means the footprint room is a normal centreline plate -
 * fully editable, and identical through the preview -> bake flow.
 */

import { SpacePlateHandle } from '@ifc-lite/wasm';
import { convexHull, type WallRect } from '@/lib/wall-rects-from-meshes';

type Pt = [number, number];

/** Convex-hull exterior perimeter (CCW) of all wall-rectangle corners. Correct
 *  only for a convex plan — see the note above before reaching for it. */
export function exteriorPerimeter(rects: WallRect[]): Pt[] {
  return convexHull(rects.flatMap((r) => r.corners as Pt[]));
}

/** Snap for merging wall-rectangle corners into one contour, in metres. Wide
 *  enough to close the gap where two walls meet, far below any real notch. */
const CONTOUR_SNAP_M = 0.05;

/**
 * The storey's true outer contour (CCW), or `null` when it cannot be had —
 * the plate engine is not loaded yet, or the walls enclose nothing.
 *
 * `null` is a real answer, not a failure to report: the caller knows whether
 * an over-large outline is survivable in its context, and this function does
 * not.
 */
export function storeyContour(rects: WallRect[]): Pt[] | null {
  if (rects.length === 0) return null;
  const flat = new Float64Array(rects.length * 8);
  rects.forEach((r, i) => {
    for (let k = 0; k < 4; k++) {
      flat[i * 8 + k * 2] = r.corners[k][0];
      flat[i * 8 + k * 2 + 1] = r.corners[k][1];
    }
  });
  let out: Float64Array;
  try {
    out = SpacePlateHandle.wallUnionOutline(flat, CONTOUR_SNAP_M);
  } catch {
    return null; // engine not initialised, or degenerate input
  }
  if (out.length < 6) return null;
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < out.length; i += 2) pts.push([out[i], out[i + 1]]);
  return pts;
}

/**
 * Emit the closed hull as a loop of thin synthetic walls (one per edge),
 * centred on the hull edge, so `buildFromRects` encloses exactly one room whose
 * outline is the hull. Returns null when the hull is degenerate (< 3 points).
 */
export function perimeterWalls(hull: Pt[], thickness = 0.2): WallRect[] | null {
  if (hull.length < 3) return null;
  const half = thickness / 2;
  const out: WallRect[] = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // Unit normal to the edge.
    const nx = -dy / len;
    const ny = dx / len;
    const ox = nx * half;
    const oy = ny * half;
    const corners: Pt[] = [
      [a[0] + ox, a[1] + oy],
      [b[0] + ox, b[1] + oy],
      [b[0] - ox, b[1] - oy],
      [a[0] - ox, a[1] - oy],
    ];
    out.push({ corners, centreline: [a, b], thickness });
  }
  return out.length >= 3 ? out : null;
}
