/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where the plan is on screen, for code outside the plan's own React tree.
 *
 * # Why this exists
 * `PlanView` keeps its transform in a hook, which is right — it is the only
 * thing that pans and zooms. But a screenflow has to draw a cursor over a wall
 * that is being traced, and it lives outside that tree entirely. Without this
 * it projected building coordinates through the 3D camera while the 2D plan
 * was the thing on screen, so every pointer in a 2D beat sat several
 * centimetres from the place the beat was actually clicking.
 *
 * # Why a module variable and not store state
 * The transform changes on every wheel tick and every drag frame. Putting it
 * in the store would re-render every subscriber at that rate for a value only
 * an overlay reads, and the overlay already samples on an animation frame. So
 * it is published imperatively and read imperatively.
 *
 * # Why nothing here reads back into the plan
 * One direction only. The plan is the authority on its own transform, and a
 * writer on this side would be a second one.
 */

import type { PlanTransform } from './planFocus';

export interface PlanViewport {
  /** The transform the canvas paints with, rotation included. */
  readonly transform: PlanTransform;
  /** The canvas container's box in CSS pixels, for going to viewport space. */
  readonly rect: { left: number; top: number; width: number; height: number };
}

let current: PlanViewport | null = null;

/**
 * Publish the plan's current geometry. `null` when the plan is not mounted —
 * which is what tells a reader to fall back to the 3D projection rather than
 * pointing at where the plan used to be.
 */
export function setPlanViewport(viewport: PlanViewport | null): void {
  current = viewport;
}

/** The plan's geometry, or `null` when no plan is on screen. */
export function planViewport(): PlanViewport | null {
  return current;
}

/**
 * A drawing point in viewport pixels, or `null` when no plan is showing.
 *
 * The forward mapping of `planScreenToDrawing`: scale, then rotate, then
 * offset. Written out here rather than imported so the inverse pair stays
 * visible side by side in that module's test.
 */
export function planPointToViewport(point: { x: number; y: number }): { x: number; y: number } | null {
  const viewport = current;
  if (!viewport) return null;
  const { transform, rect } = viewport;
  const sx = point.x * transform.scale;
  const sy = point.y * transform.scale;
  const rotation = transform.rotation ?? 0;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const rx = rotation === 0 ? sx : sx * c - sy * s;
  const ry = rotation === 0 ? sy : sx * s + sy * c;
  return { x: rect.left + transform.x + rx, y: rect.top + transform.y + ry };
}

/**
 * What the plan is currently drawing.
 *
 * Separate from the viewport above because it answers a different question:
 * not "where is a point on screen" but "is the sheet I asked for the sheet
 * that is up". A batch run needs the second — it walks the plan through one
 * storey after another and has to know when each has actually arrived, or it
 * writes the previous sheet under the next one's filename.
 *
 * `null` while no plan is mounted, exactly like the viewport.
 */
export interface PlanDrawingState {
  /** The storey the plan is cutting, or `null` when it has none. */
  readonly storeyExpressId: number | null;
  /** The plan product supplying selection, symbols and rotation. */
  readonly planProductId: string | null;
  /** The generator's own status — `ready` is the only one worth exporting. */
  readonly status: string;
  /** Whether the cut actually produced something to draw. */
  readonly hasDrawing: boolean;
}

let currentDrawing: PlanDrawingState | null = null;

/** Publish what the plan is drawing. `null` when it is not mounted. */
export function setPlanDrawingState(state: PlanDrawingState | null): void {
  currentDrawing = state;
}

/** What the plan is drawing, or `null` when no plan is on screen. */
export function planDrawingState(): PlanDrawingState | null {
  return currentDrawing;
}
