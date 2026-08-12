/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The outline of whatever the user has selected, in IFC metres.
 *
 * Deliberately driven by the selection rather than by hunting for an
 * `IfcGeographicElement` with `.TERRAIN.` or an `IfcSite` outline. The fit
 * cannot tell a parcel boundary from a setback line or a building footprint —
 * it will happily match any of them onto the parcel and report a plausible
 * error. Choosing the surface is therefore a judgement, and it belongs to the
 * person who knows the model, not to a heuristic that would be right often
 * enough to be trusted and wrong quietly.
 */

import type { GeometryResult, MeshData } from '@ifc-lite/geometry';

import { extractPlanOutline, type ExtractOutlineFailure, type TriangleSoup } from './extract-outline';
import { extractPlanFootprint, type FootprintFailure, type FootprintOptions } from './footprint';
import { ringToIfcMetres } from './mesh-to-map';
import type { Point2 } from './fit-outline';

export type SelectionOutlineResult =
  | { ok: true; ring: Point2[]; area: number; ringCount: number; meshCount: number }
  | { ok: false; reason: 'nothing-selected' | 'no-geometry' | ExtractOutlineFailure };

export type SelectionFootprintResult =
  | {
    ok: true;
    ring: Point2[];
    area: number;
    ringCount: number;
    meshCount: number;
    /** Raster cell size used, metres — the accuracy of this ring. */
    cellSize: number;
  }
  | { ok: false; reason: 'nothing-selected' | 'no-geometry' | FootprintFailure };

/**
 * Concatenate several meshes into one soup, rebasing each mesh's indices onto
 * the combined vertex list.
 *
 * Selecting a terrain split across several meshes has to behave like selecting
 * one surface: the seam between two halves is an interior edge of the union,
 * and treating the meshes separately would report it as border on both sides
 * and cut the outline in two.
 */
export function mergeMeshes(meshes: readonly MeshData[]): TriangleSoup {
  let vertexCount = 0;
  let indexCount = 0;
  for (const mesh of meshes) {
    vertexCount += mesh.positions.length;
    indexCount += mesh.indices.length;
  }

  const positions = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);
  let positionOffset = 0;
  let indexOffset = 0;
  let vertexBase = 0;

  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset);
    for (let i = 0; i < mesh.indices.length; i += 1) {
      indices[indexOffset + i] = mesh.indices[i] + vertexBase;
    }
    positionOffset += mesh.positions.length;
    indexOffset += mesh.indices.length;
    vertexBase += mesh.positions.length / 3;
  }

  return { positions, indices };
}

/**
 * Reduce the selected elements of one model to a plan ring in IFC metres,
 * ready for {@link fitOutline} against an official parcel.
 *
 * @param expressIds Express ids belonging to THIS model, already resolved out
 *                   of the federated selection by the caller.
 */
export function outlineFromSelection(
  expressIds: ReadonlySet<number>,
  geometryResult: GeometryResult | null | undefined,
): SelectionOutlineResult {
  if (expressIds.size === 0) return { ok: false, reason: 'nothing-selected' };

  const meshes = (geometryResult?.meshes ?? []).filter(mesh => expressIds.has(mesh.expressId));
  if (meshes.length === 0) return { ok: false, reason: 'no-geometry' };

  const extracted = extractPlanOutline(mergeMeshes(meshes));
  if (!extracted.ok) return { ok: false, reason: extracted.reason };

  return {
    ok: true,
    // The extractor works in the viewer's frame; the fit needs IFC metres,
    // with the RTC offset and origin shift taken back out.
    ring: ringToIfcMetres(extracted.ring, geometryResult?.coordinateInfo),
    area: extracted.area,
    ringCount: extracted.ringCount,
    meshCount: meshes.length,
  };
}

/**
 * The same reduction for a BUILDING: the plan silhouette of the selected
 * elements, in IFC metres.
 *
 * The two are not interchangeable. {@link outlineFromSelection} chains the
 * edges that belong to one triangle only, which is the boundary of an OPEN
 * surface — a site plate, a terrain patch — and is exactly nothing on a closed
 * solid. A building is a closed solid, so it goes through
 * {@link extractPlanFootprint} instead, which takes the union of the triangles
 * seen from above.
 *
 * Which one applies is a fact about the geometry, not a preference, so the
 * caller picks by what it is fitting rather than by trying one and falling
 * back — a silent fallback would answer a footprint where a boundary was
 * asked for and never say which it gave.
 *
 * @param expressIds Express ids belonging to THIS model, already resolved out
 *                   of the federated selection by the caller.
 */
export function footprintFromSelection(
  expressIds: ReadonlySet<number>,
  geometryResult: GeometryResult | null | undefined,
  options: FootprintOptions = {},
): SelectionFootprintResult {
  if (expressIds.size === 0) return { ok: false, reason: 'nothing-selected' };

  const meshes = (geometryResult?.meshes ?? []).filter(mesh => expressIds.has(mesh.expressId));
  if (meshes.length === 0) return { ok: false, reason: 'no-geometry' };

  const extracted = extractPlanFootprint(mergeMeshes(meshes), options);
  if (!extracted.ok) return { ok: false, reason: extracted.reason };

  return {
    ok: true,
    ring: ringToIfcMetres(extracted.ring, geometryResult?.coordinateInfo),
    area: extracted.area,
    ringCount: extracted.ringCount,
    meshCount: meshes.length,
    cellSize: extracted.cellSize,
  };
}
