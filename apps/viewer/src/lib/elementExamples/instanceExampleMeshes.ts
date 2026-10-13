/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One placement's picture, out of the library's meshed geometry.
 *
 * The cupboard (`exampleMeshes.ts`) holds an example's triangles once. Putting
 * a device in a building points a new occurrence at those same triangles and
 * says where they sit — the same split the IFC side makes, where one
 * `IfcRepresentationMap` serves many `IfcMappedItem`s.
 *
 * # It moves the frame, not the vertices
 * A `MeshData` carries an `origin`, and the renderer reconstructs a vertex as
 * `origin + positions[i]`. So a placement is a different `origin` over the
 * SAME buffers: no copying, and twenty detectors cost twenty small objects
 * rather than twenty copies of a body.
 *
 * Rewriting `positions` instead looks equivalent and is not — it drops the
 * element's own local frame, which is where each body of a multi-part object
 * (the bottle, the cap, the handle) keeps its offset from the others. Doing
 * that pulled every part of the extinguisher onto the click point, each one
 * correctly sized and all of them in the same place. Measured, not reasoned:
 * the clearance came back 0.75 m tall spanning ±0.375 around the floor
 * instead of standing from 0.30 m to 1.05 m.
 *
 * # Only a translation
 * The pipeline already applied the example file's unit scale, so its meshes
 * are in metres, and so is the renderer. The unit factor on the placement's
 * transformation operator belongs to the IFC copy, which may not touch the
 * numbers it copies — not here. No rotation either: an Elementbeispiel is
 * modelled upright about its own origin, and nothing in the placement turns it
 * yet.
 *
 * # The frame
 * IFC is Z-up, the renderer Y-up with IFC +Y running into -Z:
 *
 *     renderer = ( ifcX, ifcZ + storeyElevation, -ifcY )
 *
 * taken from `addElementMeshes.ts`, which every other placed element uses. It
 * is stated once here rather than inlined, because a sign error in it looks
 * like a modelling mistake rather than a frame mistake.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { ExampleMeshes } from './exampleMeshes.js';

/** Which placed entity each of the example's products became. */
export interface PlacedProduct {
  /** The product's express id in the EXAMPLE file — the cupboard's key. */
  readonly sourceExpressId: number;
  /** The federation-aware id of the entity created for it in THIS model. */
  readonly globalId: number;
}

/**
 * Point the example's meshes at one placement.
 *
 * `position` is storey-local and in METRES, as every store builder takes it.
 * Products the cupboard has nothing for are skipped — a plan symbol with no
 * body is ordinary, not an error.
 */
export function instanceExampleMeshes(
  meshes: ExampleMeshes,
  products: readonly PlacedProduct[],
  position: readonly [number, number, number],
  storeyElevation: number,
): MeshData[] {
  const dx = position[0];
  const dy = position[2] + storeyElevation;
  const dz = -position[1];

  const placed: MeshData[] = [];
  for (const product of products) {
    for (const source of meshes.byProduct.get(product.sourceExpressId) ?? []) {
      placed.push(moved(source, product.globalId, dx, dy, dz));
    }
  }
  return placed;
}

function moved(
  source: MeshData,
  globalId: number,
  dx: number,
  dy: number,
  dz: number,
): MeshData {
  // Absent means `positions` are already absolute world — the legacy and
  // native shapes — so the placement's offset becomes the whole origin.
  const base = source.origin ?? [0, 0, 0];
  return {
    ...source,
    expressId: globalId,
    origin: [base[0] + dx, base[1] + dy, base[2] + dz],
    // Absolute world by contract, so it moves with the element. Left alone it
    // would report the example file's own position to the compare feature.
    geometryAabb: source.geometryAabb
      ? {
          min: [
            source.geometryAabb.min[0] + dx,
            source.geometryAabb.min[1] + dy,
            source.geometryAabb.min[2] + dz,
          ],
          max: [
            source.geometryAabb.max[0] + dx,
            source.geometryAabb.max[1] + dy,
            source.geometryAabb.max[2] + dz,
          ],
        }
      : undefined,
    // Dropped on purpose. These name entities of the EXAMPLE file; carried
    // over, a click would resolve to an id that means something else here.
    entityIds: undefined,
    geometryItemId: undefined,
    materialId: undefined,
    // Also from the example. Every placement has its own expressId, so caches
    // keyed on that do not collide — but a key copied from the source would
    // claim two placements are one occurrence.
    occurrenceKey: undefined,
  };
}
