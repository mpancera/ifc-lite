/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The doors and windows on the storey being drawn, as plan symbols.
 *
 * # Where each number comes from, and why not from somewhere else
 * - **Orientation** from `MeshData.localToWorld`, the resolved placement
 *   chain. Its ROTATION only: its translation lives in the model's original
 *   world while the drawing lives in the RTC-shifted render frame, and mixing
 *   them puts a correctly-turned door kilometres from its wall.
 * - **Position** from the meshes, which are already in the drawing's frame.
 * - **Width** from `localBounds`, the element's own object-space box, because
 *   `OverallWidth` is "for informational purpose only" (IfcDoor §6.1.3.16) and
 *   nothing obliges an exporter to keep it in step with the shape it ships.
 * - **How it opens** from `IfcDoorType.OperationType`, reached through
 *   `IfcRelDefinesByType`. The occurrence usually leaves it unset — every door
 *   in the FZK-Haus does — so reading only the occurrence finds nothing and
 *   draws no swing at all.
 *
 * # Single model only
 * `elementToStorey` is keyed by LOCAL express ids, the same restriction the
 * storey picker and the room labels already carry.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import { extractAllEntityAttributes } from '@ifc-lite/parser';
import type { GeometryResult, MeshData } from '@ifc-lite/geometry';
import { RelationshipType } from '@ifc-lite/data';
import {
  doorOperationFromIfc, planAxes, openingWidth, doorSymbol, windowSymbol,
  type SymbolLine, type LocalExtent,
} from '@/lib/plan/openingSymbols';

export interface PlanOpeningSymbol {
  /** Express id of the door or window, local to its model. */
  readonly expressId: number;
  readonly kind: 'door' | 'window';
  /** The lines to draw, in drawing units. */
  readonly lines: readonly SymbolLine[];
  /** What the model said, for the tooltip — `null` when it said nothing. */
  readonly operationType: string | null;
}

export interface UsePlanOpeningSymbolsOptions {
  enabled: boolean;
  geometryResult: GeometryResult | null | undefined;
  dataStore: IfcDataStore | null | undefined;
  storeyId: number | null;
}

/** An element's meshes reduced to the three things a symbol needs. */
interface OpeningGeometry {
  readonly centre: { x: number; y: number };
  readonly extent: LocalExtent;
  readonly localToWorld: number[] | undefined;
}

/**
 * Where the opening is, and how big it is in its own frame.
 *
 * The centre comes from the world bounding box (whose middle is the middle of
 * the element however it is turned), the extents from the local box — so the
 * width is measured along the door rather than along the drawing's axes, which
 * for anything not parallel to X or Z are different numbers.
 */
function openingGeometry(meshes: readonly MeshData[]): OpeningGeometry | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let lMinX = Infinity, lMaxX = -Infinity, lMinZ = Infinity, lMaxZ = -Infinity;
  let localToWorld: number[] | undefined;

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
    const lb = mesh.localBounds;
    if (lb) {
      if (lb.min[0] < lMinX) lMinX = lb.min[0];
      if (lb.max[0] > lMaxX) lMaxX = lb.max[0];
      if (lb.min[2] < lMinZ) lMinZ = lb.min[2];
      if (lb.max[2] > lMaxZ) lMaxZ = lb.max[2];
    }
    localToWorld ??= mesh.localToWorld;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  return {
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    extent: {
      width: Number.isFinite(lMinX) ? lMaxX - lMinX : 0,
      depth: Number.isFinite(lMinZ) ? lMaxZ - lMinZ : 0,
    },
    localToWorld,
  };
}

/** A named attribute of an entity, as a string, or `undefined`. */
function attribute(store: IfcDataStore, expressId: number, name: string): string | undefined {
  const entry = extractAllEntityAttributes(store, expressId).find((a) => a.name === name);
  if (!entry) return undefined;
  const value = String(entry.value).trim();
  return value.length > 0 ? value : undefined;
}

export function usePlanOpeningSymbols({
  enabled, geometryResult, dataStore, storeyId,
}: UsePlanOpeningSymbolsOptions): PlanOpeningSymbol[] {
  return useMemo((): PlanOpeningSymbol[] => {
    if (!enabled || !dataStore || storeyId === null) return [];
    const elementToStorey = dataStore.spatialHierarchy?.elementToStorey;
    if (!elementToStorey) return [];

    // Group this storey's doors and windows in ONE pass over the meshes. A
    // door arrives as up to thirty submeshes (frame, leaf, glazing, handle),
    // all sharing one express id and one placement.
    const byOpening = new Map<number, { kind: 'door' | 'window'; meshes: MeshData[] }>();
    for (const mesh of geometryResult?.meshes ?? []) {
      if ((mesh.geometryClass ?? 0) === 2) continue;
      const type = mesh.ifcType;
      const kind = type === 'IfcDoor' ? 'door' : type === 'IfcWindow' ? 'window' : null;
      if (!kind) continue;
      if (elementToStorey.get(mesh.expressId) !== storeyId) continue;

      const entry = byOpening.get(mesh.expressId);
      if (entry) entry.meshes.push(mesh);
      else byOpening.set(mesh.expressId, { kind, meshes: [mesh] });
    }
    if (byOpening.size === 0) return [];

    const scale = dataStore.lengthUnitScale ?? 1;
    // Doors of one type share an OperationType, and re-reading the type per
    // door would re-parse the same entity for every door in the building.
    const operationByType = new Map<number, string | undefined>();

    const symbols: PlanOpeningSymbol[] = [];
    for (const [expressId, { kind, meshes }] of byOpening) {
      const geometry = openingGeometry(meshes);
      if (!geometry) continue;

      const axes = planAxes(geometry.localToWorld);
      // Without a placement there is no way to know which way the door faces,
      // and a symbol laid on the drawing's axes would be confidently wrong for
      // every wall that is not square to them.
      if (!axes) continue;

      const stated = attribute(dataStore, expressId, 'OverallWidth');
      const width = openingWidth(
        geometry.extent,
        stated === undefined ? null : Number.parseFloat(stated) * scale,
      );
      if (width === null) continue;

      if (kind === 'window') {
        symbols.push({
          expressId, kind,
          lines: windowSymbol({ centre: geometry.centre, width, depth: geometry.extent.depth, axes }),
          operationType: null,
        });
        continue;
      }

      // `OperationType` sits on the TYPE in every model met so far, but the
      // occurrence may carry it in IFC4, and the occurrence is the more
      // specific statement when it does.
      let operationType = attribute(dataStore, expressId, 'OperationType');
      if (operationType === undefined) {
        const typeIds = dataStore.relationships?.getRelated(
          expressId, RelationshipType.DefinesByType, 'inverse',
        );
        const typeId = typeIds?.[0];
        if (typeId !== undefined) {
          if (!operationByType.has(typeId)) {
            operationByType.set(typeId, attribute(dataStore, typeId, 'OperationType'));
          }
          operationType = operationByType.get(typeId);
        }
      }

      const lines = doorSymbol({
        centre: geometry.centre, width, axes,
        operation: doorOperationFromIfc(operationType),
      });
      if (lines.length === 0) continue;

      symbols.push({ expressId, kind, lines, operationType: operationType ?? null });
    }

    return symbols;
  }, [enabled, geometryResult, dataStore, storeyId]);
}

export default usePlanOpeningSymbols;
