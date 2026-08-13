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
  type SymbolLine, type LocalExtent, type PlanAxes,
} from '@/lib/plan/openingSymbols';

export interface PlanOpeningSymbol {
  /**
   * Identifies this OCCURRENCE, not this entity.
   *
   * Instanced doors share an express id, so the express id alone would give
   * several symbols the same React key and collapse them to one.
   */
  readonly key: string;
  /** Express id of the door or window, local to its model. */
  readonly expressId: number;
  readonly kind: 'door' | 'window';
  /** The lines to draw, in drawing units. */
  readonly lines: readonly SymbolLine[];
  /** What the model said, for the tooltip — `null` when it said nothing. */
  readonly operationType: string | null;
  /**
   * Whether this occurrence's placement is MIRRORED in plan.
   *
   * Reported, not acted on. A mirrored family instance (Revit mirrors doors
   * routinely) turns left-hung into right-hung as drawn, so if a swing ever
   * comes out on the wrong jamb this is the first thing to correlate it
   * against — it shows in the tooltip for exactly that.
   */
  readonly mirrored: boolean;
}

/**
 * Whether the placement flips handedness as seen in the plan.
 *
 * A proper (right-handed) door frame gives one sign for `along × across`; a
 * mirrored instance gives the other. Measured rather than assumed, because a
 * mirrored placement is what an authoring tool produces when somebody flips a
 * door, and nothing else in the file records that it happened.
 */
function isMirrored(axes: { along: { x: number; y: number }; across: { x: number; y: number } }): boolean {
  // Identity and every plain rotation of it give a negative cross product;
  // see the `planAxes` tests, which pin both.
  return axes.along.x * axes.across.y - axes.along.y * axes.across.x > 0;
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
}

/** The placement matrix an element's meshes agree on, or `undefined`. */
function placementOf(meshes: readonly MeshData[]): number[] | undefined {
  for (const mesh of meshes) {
    if (mesh.localToWorld) return mesh.localToWorld;
  }
  return undefined;
}

/**
 * Where the opening is, and how big it is in its own frame.
 *
 * The centre is the middle of the element measured ALONG ITS OWN AXES, not the
 * middle of an axis-aligned box round it. For a door parallel to X or Z the two
 * agree; for one at any other angle the axis-aligned box is the box round a
 * tilted rectangle, which is bigger than the door and whose middle drifts as
 * soon as anything about the door is asymmetric — a handle, a threshold, a
 * frame rebated on one side. That drift is small, which is what makes it worth
 * removing: a symbol a few centimetres off its doorway looks like a bug in the
 * symbol rather than in the measurement.
 *
 * The extents come from the local box, so the width is measured across the
 * door rather than across the drawing.
 */
function openingGeometry(meshes: readonly MeshData[], axes: PlanAxes): OpeningGeometry | null {
  const { along, across } = axes;
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  let lMinX = Infinity, lMaxX = -Infinity, lMinZ = Infinity, lMaxZ = -Infinity;

  for (const mesh of meshes) {
    const ox = mesh.origin?.[0] ?? 0;
    const oz = mesh.origin?.[2] ?? 0;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i] + ox;
      const y = p[i + 2] + oz;
      const a = x * along.x + y * along.y;
      const b = x * across.x + y * across.y;
      if (a < minA) minA = a; if (a > maxA) maxA = a;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
    }
    const lb = mesh.localBounds;
    if (lb) {
      if (lb.min[0] < lMinX) lMinX = lb.min[0];
      if (lb.max[0] > lMaxX) lMaxX = lb.max[0];
      if (lb.min[2] < lMinZ) lMinZ = lb.min[2];
      if (lb.max[2] > lMaxZ) lMaxZ = lb.max[2];
    }
  }

  if (!Number.isFinite(minA) || !Number.isFinite(minB)) return null;

  // Back from the (along, across) frame into drawing coordinates. The two axes
  // are unit and perpendicular, so this is just their weighted sum.
  const midA = (minA + maxA) / 2;
  const midB = (minB + maxB) / 2;

  return {
    centre: {
      x: along.x * midA + across.x * midB,
      y: along.y * midA + across.y * midB,
    },
    extent: {
      width: Number.isFinite(lMinX) ? lMaxX - lMinX : 0,
      depth: Number.isFinite(lMinZ) ? lMaxZ - lMinZ : 0,
    },
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
    //
    // Keyed on `occurrenceKey`, NOT on `expressId`. A repeated door type is
    // GPU-instanced, and instanced occurrences are materialised as one
    // `MeshData` each, ALL STAMPED WITH THE SAME EXPRESS ID — which is the
    // collision that field exists to prevent. Keying on the express id merges
    // several real doors into one blob: the bounding box centre lands between
    // them, so every symbol sits slightly off its own doorway, and the first
    // occurrence's placement then decides the hinge for all of them, so some
    // come out right and some mirrored. One cause, both symptoms.
    const byOpening = new Map<string, { expressId: number; kind: 'door' | 'window'; meshes: MeshData[] }>();
    for (const mesh of geometryResult?.meshes ?? []) {
      if ((mesh.geometryClass ?? 0) === 2) continue;
      const type = mesh.ifcType;
      const kind = type === 'IfcDoor' ? 'door' : type === 'IfcWindow' ? 'window' : null;
      if (!kind) continue;
      if (elementToStorey.get(mesh.expressId) !== storeyId) continue;

      // Absent on a flat mesh, where one express id IS one occurrence.
      const key = mesh.occurrenceKey ?? String(mesh.expressId);
      const entry = byOpening.get(key);
      if (entry) entry.meshes.push(mesh);
      else byOpening.set(key, { expressId: mesh.expressId, kind, meshes: [mesh] });
    }
    if (byOpening.size === 0) return [];

    const scale = dataStore.lengthUnitScale ?? 1;
    // Doors of one type share an OperationType, and re-reading the type per
    // door would re-parse the same entity for every door in the building.
    const operationByType = new Map<number, string | undefined>();

    const symbols: PlanOpeningSymbol[] = [];
    for (const [key, { expressId, kind, meshes }] of byOpening) {
      // The axes come first: the centre is measured along them.
      //
      // Without a placement there is no way to know which way the door faces,
      // and a symbol laid on the drawing's axes would be confidently wrong for
      // every wall that is not square to them.
      const axes = planAxes(placementOf(meshes));
      if (!axes) continue;

      const geometry = openingGeometry(meshes, axes);
      if (!geometry) continue;

      const stated = attribute(dataStore, expressId, 'OverallWidth');
      const width = openingWidth(
        geometry.extent,
        stated === undefined ? null : Number.parseFloat(stated) * scale,
      );
      if (width === null) continue;

      if (kind === 'window') {
        symbols.push({
          key, expressId, kind,
          lines: windowSymbol({ centre: geometry.centre, width, depth: geometry.extent.depth, axes }),
          operationType: null,
          mirrored: isMirrored(axes),
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

      symbols.push({
        key, expressId, kind, lines,
        operationType: operationType ?? null,
        mirrored: isMirrored(axes),
      });
    }

    return symbols;
  }, [enabled, geometryResult, dataStore, storeyId]);
}

export default usePlanOpeningSymbols;
