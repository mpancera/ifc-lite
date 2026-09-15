/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The storey frame, for the loaded model — and the two conversions the viewer
 * actually performs with it.
 *
 * `storeyFrame.ts` is the arithmetic and knows nothing about the store. This
 * is the part that reads a real file and remembers what it read: resolving a
 * chain means several attribute extractions, and every click would otherwise
 * repeat them.
 */

import { EntityExtractor, type IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';
import { dxfWorldShift } from '@/hooks/dxfUnderlayMath';
import {
  cachingReader, resolveStoreyFrame, storeyLocalToWorld, worldToStoreyLocal,
  IDENTITY_STOREY_FRAME, isIdentityFrame, type StoreyFrame,
} from './storeyFrame';

/**
 * Frames already resolved, keyed by model and storey.
 *
 * A placement chain is part of the file's structure, not of the overlay: the
 * viewer never edits a storey's own placement, and the entry is dropped when
 * the model is. Keyed on the store OBJECT so a reloaded model cannot inherit
 * the previous one's frame.
 */
const cache = new WeakMap<IfcDataStore, Map<number, StoreyFrame | null>>();

/** Storeys whose chain could not be expressed, warned about once each. */
const warned = new WeakMap<IfcDataStore, Set<number>>();

/**
 * The storey's frame, or the identity when the file does not give one that can
 * be expressed as a turn about Z plus a shift.
 *
 * The fallback is what every caller did unconditionally until now, so an
 * unsupported chain is no worse than before — but it is said out loud once,
 * because silently placing into the wrong frame is precisely the failure this
 * exists to end.
 */
export function storeyFrameOf(
  dataStore: IfcDataStore | null | undefined,
  storeyExpressId: number | null | undefined,
): StoreyFrame {
  if (!dataStore || storeyExpressId === null || storeyExpressId === undefined) {
    return IDENTITY_STOREY_FRAME;
  }

  let perModel = cache.get(dataStore);
  if (!perModel) {
    perModel = new Map();
    cache.set(dataStore, perModel);
  }
  const hit = perModel.get(storeyExpressId);
  if (hit !== undefined) return hit ?? IDENTITY_STOREY_FRAME;

  const extractor = new EntityExtractor(dataStore.source);
  const read = cachingReader((expressId) => {
    const ref = dataStore.entityIndex?.byId?.get(expressId);
    if (!ref) return null;
    return extractor.extractEntity(ref)?.attributes ?? null;
  });

  const raw = resolveStoreyFrame(read, storeyExpressId);
  // In METRES, whatever the file counts in. Every caller works in metres —
  // the renderer's world, `addSpaceToStore`'s params, the plan's drawing
  // space — and a frame origin left in feet would put the correction 3.28×
  // out on exactly the files where nobody would think to look.
  const unit = dataStore.lengthUnitScale ?? 1;
  const frame = raw === null ? null : {
    rotationRad: raw.rotationRad,
    origin: [raw.origin[0] * unit, raw.origin[1] * unit, raw.origin[2] * unit] as const,
  };
  perModel.set(storeyExpressId, frame);

  if (frame === null) {
    let seen = warned.get(dataStore);
    if (!seen) { seen = new Set(); warned.set(dataStore, seen); }
    if (!seen.has(storeyExpressId)) {
      seen.add(storeyExpressId);
      console.warn(
        `[placement] storey #${storeyExpressId} has a placement chain this build cannot express `
        + '(a tilted axis, or a chain that does not resolve). Placing as if it were unrotated.',
      );
    }
  }
  return frame ?? IDENTITY_STOREY_FRAME;
}

/** The render frame's origin shift, as `worldToDrawing` applies it. */
export type WorldShift = { x: number; y: number };

export function worldShiftOf(
  coordinateInfo: GeometryResult['coordinateInfo'] | undefined,
): WorldShift {
  return dxfWorldShift(coordinateInfo);
}

/**
 * A renderer-frame point as storey-local IFC coordinates.
 *
 * Renderer (Y-up, origin-shifted) → IFC world → the storey's own frame. The
 * first step is the same relation `worldToDrawing` uses in the other
 * direction, so the plan, the DXF underlays and placement cannot disagree
 * about where the world is.
 *
 * Z comes out 0: a placed element sits on its storey's floor, exactly as
 * before. A click that lands on a vertical surface must not lift it.
 */
export function rendererToStoreyLocal(
  point: { x: number; y: number; z: number },
  frame: StoreyFrame,
  shift: WorldShift,
): [number, number, number] {
  const world: [number, number, number] = [point.x + shift.x, -point.z + shift.y, 0];
  const local = worldToStoreyLocal(frame, world);
  return [local[0], local[1], 0];
}

/**
 * A storey-local IFC XY point, in plan drawing space.
 *
 * The inverse of the above, minus the height: what the edit handles need to
 * sit on top of the mesh rather than beside it.
 */
export function storeyLocalToDrawing(
  point: readonly [number, number],
  frame: StoreyFrame,
  shift: WorldShift,
): { x: number; y: number } {
  const world = storeyLocalToWorld(frame, [point[0], point[1], 0]);
  return { x: world[0] - shift.x, y: -(world[1] - shift.y) };
}

/**
 * A plan drawing point as storey-local IFC XY, in metres.
 *
 * The exact inverse of {@link storeyLocalToDrawing}. Both exist because the
 * reshape handles read one way and commit the other, and a pair that does not
 * round-trip moves a room every time somebody looks at it.
 */
export function drawingToStoreyLocal(
  point: { x: number; y: number },
  frame: StoreyFrame,
  shift: WorldShift,
): [number, number] {
  const local = worldToStoreyLocal(frame, [point.x + shift.x, -point.y + shift.y, 0]);
  return [local[0], local[1]];
}

/**
 * A DELTA in drawing space as a delta in the storey's frame.
 *
 * Only the rotation and the y-flip act on a difference; the origin cancels.
 * Applying the full point conversion to a step would add the frame's origin
 * to every drag.
 */
export function drawingDeltaToStoreyLocal(
  step: { x: number; y: number },
  frame: StoreyFrame,
): [number, number] {
  const c = Math.cos(-frame.rotationRad);
  const s = Math.sin(-frame.rotationRad);
  const dx = step.x;
  const dy = -step.y;
  return [dx * c - dy * s, dx * s + dy * c];
}

export { isIdentityFrame };
export type { StoreyFrame };
