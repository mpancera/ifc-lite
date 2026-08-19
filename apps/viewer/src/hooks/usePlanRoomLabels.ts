/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The rooms on the storey being drawn, ready to be written into.
 *
 * # Which spaces
 * Those the spatial hierarchy assigns to the storey in scope — the SAME answer
 * Solo uses to decide what the plan shows, so the labels cannot end up
 * describing a floor that is not on screen. Walking the hierarchy also picks up
 * spaces authored this session (#49): `registerAuthoredElement` files a baked
 * `IfcSpace` under its storey exactly as the parser would, so a room generated
 * from an imported plan is labelled like any other.
 *
 * `IfcSpatialZone` is deliberately left out. It is a gross-area container that
 * usually overlaps the rooms it spans, so labelling both would stack two
 * numbers on the same piece of floor.
 *
 * # Single model only
 * `elementToStorey` and `bySpace` are keyed by LOCAL express ids, so on a
 * federation they would collide with another model's ids and label rooms from
 * the wrong building. The same restriction the storey picker already carries.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';
import { IfcTypeEnum, type SpatialNode } from '@ifc-lite/data';
import { useViewerStore } from '@/store';
import {
  roomFootprint, roomAreaFromQuantities, type RoomLabel, type RoomMesh, type QuantitySetLike,
} from '@/lib/plan/roomLabels';
import { areaUnitScaleFor } from '@/lib/units/measure-scales';
import { overlayAttribute } from '@/lib/mutations/overlayAttribute';

export interface UsePlanRoomLabelsOptions {
  /** Off entirely when the plan is closed or the labels are switched off. */
  enabled: boolean;
  geometryResult: GeometryResult | null | undefined;
  /** The data store of the single model being drawn. */
  dataStore: IfcDataStore | null | undefined;
  /** Which model it is, for the mutation overlay's quantities. */
  modelId: string | null;
  /** The storey the plan is cut through. */
  storeyId: number | null;
}

/** Every `IfcSpace` under a storey node, by express id. */
function spacesUnderStorey(root: SpatialNode, storeyId: number): Map<number, SpatialNode> {
  const out = new Map<number, SpatialNode>();

  const collect = (node: SpatialNode) => {
    if (node.type === IfcTypeEnum.IfcSpace) out.set(node.expressId, node);
    for (const child of node.children) collect(child);
  };

  const find = (node: SpatialNode): boolean => {
    if (node.expressId === storeyId) {
      // The storey ITSELF is not a room; its space children are.
      for (const child of node.children) collect(child);
      return true;
    }
    return node.children.some(find);
  };

  find(root);
  return out;
}

/**
 * The label for every room on this storey.
 *
 * Recomputed when the storey, the geometry or the authoring overlay changes —
 * not on pan, zoom or rotation, none of which move a room. Spaces without
 * geometry are dropped rather than anchored at the world origin: there is
 * nowhere on the drawing that a label for them would be true.
 */
export function usePlanRoomLabels({
  enabled, geometryResult, dataStore, modelId, storeyId,
}: UsePlanRoomLabelsOptions): RoomLabel[] {
  // Quantities authored this session (a bSDD import, a generated space) live in
  // the overlay, not the parsed buffer, so the overlay is asked first — the
  // same precedence the properties panel uses.
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  return useMemo((): RoomLabel[] => {
    if (!enabled || !dataStore || storeyId === null) return [];
    const hierarchy = dataStore.spatialHierarchy;
    if (!hierarchy?.project) return [];

    const spaces = spacesUnderStorey(hierarchy.project, storeyId);
    if (spaces.size === 0) return [];

    // One pass over the meshes, not one pass per room: a storey of forty rooms
    // against a model of a hundred thousand meshes is forty scans otherwise.
    //
    // Keyed on `occurrenceKey` where there is one. Instanced occurrences all
    // carry the SAME express id, so keying on that would union two rooms into
    // one and put a single label, of their combined area, on the wall between
    // them. Rooms are rarely instanced, but the key costs nothing and the
    // failure mode is silent.
    const meshesBySpace = new Map<string, { expressId: number; meshes: RoomMesh[] }>();
    for (const mesh of geometryResult?.meshes ?? []) {
      // Instanced type templates are shape libraries, not placed rooms;
      // including one would put a label wherever its template happens to sit.
      if ((mesh.geometryClass ?? 0) === 2) continue;
      if (!spaces.has(mesh.expressId)) continue;
      const key = mesh.occurrenceKey ?? String(mesh.expressId);
      const entry = meshesBySpace.get(key);
      if (entry) entry.meshes.push(mesh);
      else meshesBySpace.set(key, { expressId: mesh.expressId, meshes: [mesh] });
    }

    const overlay = modelId ? mutationViews.get(modelId === 'legacy' ? '__legacy__' : modelId) : undefined;
    // The AREA unit the file declares, not the length unit squared — see
    // `lib/units/measure-scales`.
    const areaUnitScale = areaUnitScaleFor(dataStore);

    const labels: RoomLabel[] = [];
    for (const [key, { expressId, meshes }] of meshesBySpace) {
      const node = spaces.get(expressId);
      if (!node) continue;

      const footprint = roomFootprint(meshes);
      if (!footprint) continue;

      const quantitySets: QuantitySetLike[] =
        overlay?.getQuantitiesForEntity(expressId) ?? dataStore.getQuantities?.(expressId) ?? [];

      const area =
        roomAreaFromQuantities(quantitySets, areaUnitScale) ??
        { value: footprint.area, source: 'geometry' as const };

      // The overlay first, or a room renamed a moment ago keeps printing its
      // old label while the panel that renamed it shows the new one: nothing
      // writes an attribute mutation back into the parsed hierarchy.
      const name = overlayAttribute(overlay, expressId, 'Name') ?? (node.name?.trim() ?? '');
      const authored = overlayAttribute(overlay, expressId, 'LongName');
      const longName = authored ?? (node.longName?.trim() ?? '');

      labels.push({
        key,
        expressId,
        anchor: footprint.anchor,
        name,
        // The hierarchy only carries LongName when it differs from Name; an
        // authored one carries whatever was typed, so the same guard is applied
        // here rather than assumed.
        longName: longName === name ? '' : longName,
        area,
        width: footprint.width,
        height: footprint.height,
      });
    }

    return labels;
    // `mutationVersion` bumps on every authoring edit — it is what makes a room
    // generated a moment ago show up without reloading the model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geometryResult, dataStore, modelId, storeyId, mutationViews, mutationVersion]);
}

export default usePlanRoomLabels;
