/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Pointing at a place in the building rather than at a button.
 *
 * # Why a second kind of anchor
 * Half of what this fork does happens in the 3D view: a wall is drawn between
 * two points, a detector is dropped at a coordinate. There is no DOM element
 * to ring. A clip that could only point at panels would narrate the interface
 * and never show the work.
 *
 * # Clips author in the same frame the builders take
 * A beat says where it points in **IFC storey-local metres** — exactly the
 * numbers that go into `addWall({ Start, End })` or `addSensor({ Position })`.
 * Anything else would mean writing every coordinate twice, in two conventions,
 * and the second copy would be the one that drifts.
 *
 * The conversion is the inverse of `rendererPointToIfcStoreyLocal`
 * (`selectionHandlers.ts`): the renderer is Y-up, IFC is Z-up, so IFC Y
 * becomes renderer -Z and IFC Z becomes renderer Y above the storey floor.
 * Kept as one exported function with the forward direction named in its test,
 * so a change to the renderer's convention breaks here loudly instead of
 * moving every clip's pointer a few metres sideways.
 */

import { planPointToViewport } from '@/lib/plan/planViewport';
import type { ViewerState } from '@/store';

export type IfcStoreyLocalPoint = readonly [number, number, number];
export interface RendererPoint { x: number; y: number; z: number }

/**
 * IFC storey-local metres to renderer world metres.
 *
 * `floorY` is the storey's elevation in the renderer frame; the point's own
 * Z is measured up from there.
 */
export function ifcStoreyLocalToRenderer(point: IfcStoreyLocalPoint, floorY: number): RendererPoint {
  return { x: point[0], y: floorY + point[2], z: -point[1] };
}

/**
 * The renderer-frame elevation of a storey, or 0 when it cannot be read.
 *
 * Zero is the honest fallback rather than a thrown error: a pointer a metre
 * off the floor is a cosmetic flaw in one beat, and a clip that stops in front
 * of a running recorder is a wasted take.
 */
export function storeyFloorY(state: ViewerState, modelId: string, storeyExpressId: number): number {
  const store = state.models.get(modelId)?.ifcDataStore;
  return store?.spatialHierarchy?.storeyElevations?.get(storeyExpressId) ?? 0;
}

/**
 * The same point as a coordinate on the plan drawing.
 *
 * The inverse of `planPointToStoreyLocal`, which is `[x, -y]` — so the
 * drawing's y is the negated IFC Y. Height plays no part: a plan is a cut
 * seen from above.
 */
export function ifcStoreyLocalToPlan(point: IfcStoreyLocalPoint): { x: number; y: number } {
  return { x: point[0], y: -point[1] };
}

/**
 * Where a building coordinate currently sits on screen, in CSS pixels
 * relative to the viewport, or `null` when nothing can place it.
 *
 * # Whichever view is actually showing
 * Asked of the plan first. A beat that traces a wall in 2D was projecting
 * through the 3D camera, because that is the only projection the store
 * carries — so the drawn cursor sat a few centimetres off the line it was
 * supposed to be drawing, in every 2D beat of every clip. The plan publishes
 * its own transform (`lib/plan/planViewport`) and answers `null` when it is
 * not mounted, which is exactly the signal to fall back to the camera.
 */
export function projectIfcPoint(
  state: ViewerState,
  point: IfcStoreyLocalPoint,
  floorY: number,
): { x: number; y: number } | null {
  const onPlan = planPointToViewport(ifcStoreyLocalToPlan(point));
  if (onPlan) return onPlan;

  const project = state.cameraCallbacks.projectToScreen;
  if (!project) return null;
  return project(ifcStoreyLocalToRenderer(point, floorY)) ?? null;
}

/** Midpoint of two building coordinates — where a clip points at a wall. */
export function midpoint(a: IfcStoreyLocalPoint, b: IfcStoreyLocalPoint): IfcStoreyLocalPoint {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
