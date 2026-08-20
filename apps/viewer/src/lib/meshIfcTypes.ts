/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Giving a mesh back the IFC class it was streamed without.
 *
 * `MeshData.ifcType` is a copy of something the data store already knows, and
 * the two are produced by pipelines that race: geometry streams from wasm while
 * the data model parses in parallel. Whoever fills the field DURING streaming
 * is reading a store that may not exist yet.
 *
 * That is not hypothetical. Eighty fire detectors arrived as instanced
 * occurrences at 759 ms; the data model finished at 908 ms. Every one of them
 * reached the mesh list with `ifcType` undefined, so the plan's device marks —
 * which dispatch on class — skipped all eighty and the 2D plan showed nothing,
 * while 3D and the class tree, which read the store rather than the meshes,
 * looked perfectly healthy. The plan said 0 devices on a storey holding 30.
 *
 * So the class is filled in HERE, at finalize, where the data store is a
 * settled fact rather than a hope. Meshes that already carry a class keep it:
 * the wasm pass names most of them itself, and this is a repair, not a rewrite.
 */

import type { MeshData } from '@ifc-lite/geometry';

/** The part of the data store this needs — kept narrow so tests can stub it. */
export interface IfcTypeSource {
  readonly entities?: {
    readonly getTypeName?: (expressId: number) => string | undefined;
  };
}

/**
 * Fill `ifcType` on every mesh that lacks one. Returns how many were repaired.
 *
 * Mutates in place: the store, the cache writer and the spatial index all hold
 * references to these same objects, and a copy would repair one reader's list
 * while leaving the others with the hole.
 *
 * Express ids must be the data store's OWN, so meshes belonging to a federated
 * model (a non-zero `modelIndex`) are left for their own store to name.
 */
export function fillMissingIfcTypes(
  meshes: readonly MeshData[] | undefined,
  dataStore: IfcTypeSource | null | undefined,
): number {
  const getTypeName = dataStore?.entities?.getTypeName;
  if (!getTypeName || !meshes?.length) return 0;

  // One lookup per entity rather than per mesh: an element split across many
  // meshes asks the same question every time, and large models have hundreds
  // of thousands of meshes.
  const byEntity = new Map<number, string | undefined>();
  let repaired = 0;
  for (const mesh of meshes) {
    if (mesh.ifcType) continue;
    // A federated model's express ids are offset away from the primary store's
    // own; asking it about them gets silence at best and the wrong element's
    // class at worst. Those meshes are named by their OWN model's store.
    if (typeof mesh.modelIndex === 'number' && mesh.modelIndex !== 0) continue;
    const expressId = mesh.expressId;
    if (typeof expressId !== 'number') continue;
    let name = byEntity.get(expressId);
    if (name === undefined && !byEntity.has(expressId)) {
      name = getTypeName(expressId);
      byEntity.set(expressId, name);
    }
    if (!name) continue;
    (mesh as { ifcType?: string }).ifcType = name;
    repaired += 1;
  }
  return repaired;
}
