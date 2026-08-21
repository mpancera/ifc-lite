/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The arithmetic behind the plan's move gizmo.
 *
 * Kept apart from the component for the usual reason and one specific one: the
 * plan can be ROTATED. A gizmo that reads its direction off the screen is right
 * only while the plan sits north-up, and that is exactly the case a hand test
 * is done in. Here the two questions — which way does an axis point on screen,
 * and how much did the cursor move along it — are answered as arithmetic, and
 * can be asked at any rotation without a mouse.
 *
 * # Frames
 * Everything here is DRAWING space (metres), the frame `planScreenToDrawing`
 * hands back. It relates to IFC storey-local as `(x, y) → (x, −y)`: drawing y
 * runs south because screen y runs down. The caller does that flip when it
 * writes; doing it here would put two conventions in one file.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';

/** Which way a drag is allowed to go. `free` is the centre handle. */
export type GizmoAxis = 'x' | 'y' | 'free';

export interface PlanTransform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
}

/**
 * A drag, reduced to what the chosen axis permits.
 *
 * The constraint is applied to the TOTAL drag rather than to each frame's
 * increment: a cursor that wanders off the axis and comes back describes the
 * same move as one that went straight, which is what somebody dragging an
 * arrow means. Per-frame clamping would quietly accumulate the wander.
 */
export function constrainToAxis(delta: Point2D, axis: GizmoAxis): Point2D {
  if (axis === 'x') return { x: delta.x, y: 0 };
  if (axis === 'y') return { x: 0, y: delta.y };
  return { x: delta.x, y: delta.y };
}

/**
 * Where an axis arrow points ON SCREEN, as a unit vector.
 *
 * The Y arrow points along drawing −y, which is IFC +Y: north, and up on a
 * plan. Pointing it down would be arithmetically honest and read as wrong to
 * everybody holding a floor plan.
 */
export function axisScreenDirection(axis: 'x' | 'y', transform: PlanTransform): Point2D {
  const c = Math.cos(transform.rotation);
  const s = Math.sin(transform.rotation);
  // The rotation the canvas paints with, applied to (1, 0) and (0, −1).
  return axis === 'x' ? { x: c, y: s } : { x: s, y: -c };
}

/** Drawing-space point → screen pixels. The same transform the canvas paints with. */
export function planDrawingToScreen(p: Point2D, transform: PlanTransform): Point2D {
  const sx = p.x * transform.scale;
  const sy = p.y * transform.scale;
  const c = Math.cos(transform.rotation);
  const s = Math.sin(transform.rotation);
  return { x: sx * c - sy * s + transform.x, y: sx * s + sy * c + transform.y };
}

/**
 * The step still owed, given what has already been applied.
 *
 * A drag is committed in increments because each one is a mutation, so the
 * component tracks what the model has already been told. When a write is
 * REFUSED the caller leaves the accumulator alone, and the next frame asks for
 * the whole outstanding move again rather than silently dropping it — the same
 * rule the 3D gizmo follows, and the reason a rejected placement chain doesn't
 * desynchronise the drag from the model.
 */
export function pendingStep(total: Point2D, applied: Point2D): Point2D {
  return { x: total.x - applied.x, y: total.y - applied.y };
}

/** Whether a step is worth a mutation at all. Metres. */
export function isWorthWriting(step: Point2D): boolean {
  return Math.abs(step.x) > 1e-6 || Math.abs(step.y) > 1e-6;
}
