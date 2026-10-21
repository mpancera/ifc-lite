/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The library's geometry, run through the geometry pipeline once and kept.
 *
 * # Why this exists
 * An Elementbeispiel brings a real modelled body — a cylinder, a half sphere,
 * a handle — and overlay-authored geometry is never re-meshed in session, so
 * placing one put the right thing in the file and nothing on the screen. The
 * other library elements look placed only because they are BOXES, built a
 * second time in JavaScript by `addElementMeshes.ts`; there is nothing to
 * rebuild for a shape somebody actually modelled.
 *
 * Marc's cut (2026-09-17): update the library separately, run every body
 * through the pipeline in one go, and afterwards everything is ready to place.
 * This module is that cupboard.
 *
 * # Why it is honest geometry and not a stand-in
 * The pipeline here is the SAME `GeometryProcessor` that meshes a loaded
 * model — an ordinary class over a buffer, not something bound to the open
 * session. What it returns is what the renderer would show if the example
 * file were opened directly.
 *
 * # Units: there is nothing to scale
 * The pipeline applies the source file's own unit scale, so what comes back is
 * in METRES, which is also the renderer's frame. The unit factor that rides on
 * the placement's transformation operator exists because the IFC side COPIES
 * raw coordinates and may not touch them; the meshed side has no such problem.
 * Placing is therefore a translation and nothing else — see
 * `instanceExampleMeshes`.
 *
 * # What is kept, and for how long
 * The session. Meshes are large and belong to the example rather than to any
 * model, so they are held per identity key (`libraryTypeKey`) and shared by
 * every model that places one. Not written to IndexedDB: the LIST is small
 * enough to keep between sessions, triangles are not.
 */

import { GeometryProcessor, type MeshData } from '@ifc-lite/geometry';

/** One example's meshes, grouped by the product they belong to. */
export interface ExampleMeshes {
  /** Source express id of the product → its meshes, in metres. */
  readonly byProduct: ReadonlyMap<number, readonly MeshData[]>;
  /** Triangles across all products, for the progress line. */
  readonly triangles: number;
}

const cupboard = new Map<string, ExampleMeshes>();

/**
 * One processor for every example, initialised once.
 *
 * Built lazily rather than at module load: a session that never opens the
 * library should not pay for a wasm instance.
 */
let processor: Promise<GeometryProcessor> | null = null;

function geometryProcessor(): Promise<GeometryProcessor> {
  if (!processor) {
    processor = (async () => {
      // Instancing off: an example is one object placed once per call here,
      // and the instanced path would hand back occurrences to expand rather
      // than the plain meshes this cupboard stores.
      const created = new GeometryProcessor({ enableInstancing: false });
      await created.init();
      return created;
    })();
    // A failed init must not poison the session — the next attempt rebuilds.
    processor.catch(() => { processor = null; });
  }
  return processor;
}

/** Mesh one example's bytes. Throws only if the pipeline itself fails. */
export async function meshExample(bytes: ArrayBuffer): Promise<ExampleMeshes> {
  const result = await (await geometryProcessor()).process(new Uint8Array(bytes));
  const byProduct = new Map<number, MeshData[]>();
  let triangles = 0;
  for (const mesh of result.meshes) {
    const list = byProduct.get(mesh.expressId);
    if (list) list.push(mesh);
    else byProduct.set(mesh.expressId, [mesh]);
    triangles += mesh.indices.length / 3;
  }
  return { byProduct, triangles };
}

/** What the cupboard holds for this product, or `null`. */
export function storedExampleMeshes(typeKey: string): ExampleMeshes | null {
  return cupboard.get(typeKey) ?? null;
}

/** Put one example's meshes away under its identity. */
export function rememberExampleMeshes(typeKey: string, meshes: ExampleMeshes): void {
  cupboard.set(typeKey, meshes);
}

/**
 * Mesh this example unless it is already in the cupboard.
 *
 * Returns whether the cupboard holds it afterwards. Never throws: a missing
 * picture is a smaller failure than a refused placement, and the caller's
 * other half — writing the real geometry into the file — must still run.
 */
export async function ensureExampleMeshes(typeKey: string, bytes: ArrayBuffer): Promise<boolean> {
  if (cupboard.has(typeKey)) return true;
  try {
    rememberExampleMeshes(typeKey, await meshExample(bytes));
    return true;
  } catch (error) {
    console.error('[elementExamples] Could not mesh the example:', error);
    return false;
  }
}

/** How many examples are ready to show. */
export function readyExampleCount(): number {
  return cupboard.size;
}

/** Empty the cupboard — for a settings action, and for tests. */
export function clearExampleMeshes(): void {
  cupboard.clear();
}
