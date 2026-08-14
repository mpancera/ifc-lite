/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The devices on the storey being drawn, as marks.
 *
 * # Taken from the STOREY, not from the cut
 * A ceiling detector is above the cut and a floor socket is below what the
 * projection shows; neither is in the drawing at all. So this cannot be a
 * decoration of the section — it is the only thing that puts these elements on
 * the plan, and it asks the storey which ones belong to it.
 *
 * # Single model only
 * `elementToStorey` is keyed by LOCAL express ids, the same restriction the
 * storey picker, the room labels and the opening symbols already carry.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult, MeshData } from '@ifc-lite/geometry';
import { deviceSymbolKind, type DeviceMark } from '@/lib/plan/deviceSymbols';

export interface UsePlanDeviceMarksOptions {
  enabled: boolean;
  geometryResult: GeometryResult | null | undefined;
  dataStore: IfcDataStore | null | undefined;
  storeyId: number | null;
}

/**
 * The middle of an element's footprint, in drawing coordinates.
 *
 * The bounding box's middle rather than a centroid: a device is a small,
 * roughly symmetric object, the two agree to within its own size, and the box
 * costs one pass where a centroid costs triangles. Drawing x IS world x and
 * drawing y IS world z — the mapping `planPick.ts` pins.
 */
function footprintCentre(meshes: readonly MeshData[]): { x: number; y: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const mesh of meshes) {
    const ox = mesh.origin?.[0] ?? 0;
    const oz = mesh.origin?.[2] ?? 0;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i] + ox;
      const y = p[i + 2] + oz;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export function usePlanDeviceMarks({
  enabled, geometryResult, dataStore, storeyId,
}: UsePlanDeviceMarksOptions): DeviceMark[] {
  return useMemo((): DeviceMark[] => {
    if (!enabled || !dataStore || storeyId === null) return [];
    const elementToStorey = dataStore.spatialHierarchy?.elementToStorey;
    if (!elementToStorey) return [];

    // Keyed on `occurrenceKey`, not on `expressId`: a repeated device type is
    // GPU-instanced and every occurrence carries the same express id, so the
    // express id alone would collapse a hundred detectors into one mark
    // somewhere between them. The same trap the opening symbols already fell
    // into once.
    const byDevice = new Map<string, { expressId: number; ifcType: string; meshes: MeshData[] }>();
    for (const mesh of geometryResult?.meshes ?? []) {
      if ((mesh.geometryClass ?? 0) === 2) continue;
      const ifcType = mesh.ifcType;
      if (!ifcType || !deviceSymbolKind(ifcType)) continue;
      if (elementToStorey.get(mesh.expressId) !== storeyId) continue;

      const key = mesh.occurrenceKey ?? String(mesh.expressId);
      const entry = byDevice.get(key);
      if (entry) entry.meshes.push(mesh);
      else byDevice.set(key, { expressId: mesh.expressId, ifcType, meshes: [mesh] });
    }
    if (byDevice.size === 0) return [];

    const marks: DeviceMark[] = [];
    for (const [key, { expressId, ifcType, meshes }] of byDevice) {
      const kind = deviceSymbolKind(ifcType);
      if (!kind) continue;
      const position = footprintCentre(meshes);
      if (!position) continue;
      marks.push({
        key,
        expressId,
        kind,
        position,
        name: dataStore.entities?.getName(expressId) ?? '',
        ifcType,
      });
    }
    return marks;
  }, [enabled, geometryResult, dataStore, storeyId]);
}

export default usePlanDeviceMarks;
