/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The rooms of one model, with their areas, and how they sit in one theme's
 * zones. Binds `lib/ifcZones/roster.ts` to the store.
 *
 * # Every storey, not the one on screen
 *
 * A Brandabschnitt is routinely vertical — a stair, a shaft, a two-storey
 * hall — so a reading restricted to the active storey would report the stair
 * as three-quarters unassigned on every floor but the one it was painted on.
 * This is why it does not reuse the plan's space graph, which is per storey by
 * construction.
 *
 * # Where an area comes from, and what it means when there is none
 *
 * The authored quantity first (`NetFloorArea`, then `GrossFloorArea`, through
 * the same helper the room labels use, so a room's area on the plan and in
 * this list can never differ), the projected geometry second. A room with
 * neither is reported with `area: null` rather than zero: a compartment's total
 * is then a FLOOR and the panel says so, because "413 m²" and "at least
 * 413 m²" are different answers to the question that forms a compartment.
 *
 * # Both containers count
 *
 * A room's assignment can go through an `IfcZone` (a group of rooms) or an
 * `IfcSpatialZone` (the body) — the exchange requirement names both. The
 * body's theme is resolved from PredefinedType AND ObjectType together, since
 * six themes share `FIRESAFETY` and only the refinement tells a Brandabschnitt
 * from an Auslösezone. Those rooms are handed to the roster as already
 * assigned rather than as extra rows: the body of a compartment and the group
 * it was derived from are one compartment, and listing both would report the
 * intended modelling as a double claim.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';
import { useViewerStore } from '@/store';
import { RelationshipType } from '@ifc-lite/data';
import { authoredEntities } from '@/lib/mutations/authoredEntities';
import { overlayAttribute } from '@/lib/mutations/overlayAttribute';
import {
  authoredSpatialZonesOf, parsedSpatialZonesOf, parsedZonesOf, readZones, readZonesForDisplay,
} from '@/lib/ifcZones/membership';
import { themeOfSpatialZone, themeOfZone } from '@/lib/ifcZones/themes';
import { resolveEntityPredefinedType } from '@/lib/entity-predefined-type';
import { readRoster, type Roster, type RosterRoom } from '@/lib/ifcZones/roster';
import {
  roomAreaFromQuantities, roomFootprint, type QuantitySetLike, type RoomMesh,
} from '@/lib/plan/roomLabels';
import { areaUnitScaleFor } from '@/lib/units/measure-scales';

export interface UseZoneRosterOptions {
  enabled: boolean;
  /** Theme id the reading is about — `'fire-compartment'`, say. */
  themeId: string | null;
  modelId: string | null;
  dataStore: IfcDataStore | null | undefined;
  geometryResult: GeometryResult | null | undefined;
}

const EMPTY: Roster = { rows: [], unassigned: [], contested: [], roomCount: 0 };

export function useZoneRoster({
  enabled, themeId, modelId, dataStore, geometryResult,
}: UseZoneRosterOptions): Roster {
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  return useMemo((): Roster => {
    if (!enabled || !themeId || !modelId || !dataStore) return EMPTY;

    const overlay = mutationViews.get(modelId === 'legacy' ? '__legacy__' : modelId);
    const spaceIds = dataStore.entityIndex?.byType?.get('IFCSPACE') ?? [];
    if (spaceIds.length === 0) return EMPTY;

    // One pass over the meshes for the whole model, not one per room: the
    // fallback is only needed for the rooms with no authored quantity, but
    // finding out which those are is cheaper than scanning per room.
    const meshesBySpace = new Map<number, RoomMesh[]>();
    const wanted = new Set(spaceIds);
    for (const mesh of geometryResult?.meshes ?? []) {
      // A type template is a shape library, not a placed room.
      if ((mesh.geometryClass ?? 0) === 2) continue;
      if (!wanted.has(mesh.expressId)) continue;
      const list = meshesBySpace.get(mesh.expressId);
      if (list) list.push(mesh as RoomMesh);
      else meshesBySpace.set(mesh.expressId, [mesh as RoomMesh]);
    }

    // The AREA unit the file declares, not the length unit squared.
    const areaUnitScale = areaUnitScaleFor(dataStore);

    const rooms: RosterRoom[] = [];
    for (const expressId of spaceIds) {
      const quantitySets: QuantitySetLike[] =
        overlay?.getQuantitiesForEntity?.(expressId) ?? dataStore.getQuantities?.(expressId) ?? [];
      const authored = roomAreaFromQuantities(quantitySets, areaUnitScale);
      const meshes = meshesBySpace.get(expressId);
      const area = authored?.value
        ?? (meshes ? roomFootprint(meshes)?.area ?? null : null);

      // The overlay first: a room renamed this session must not still be
      // listed under the name it had in the file.
      const name = overlayAttribute(overlay, expressId, 'Name')
        ?? dataStore.entities?.getName?.(expressId)
        ?? '';
      rooms.push({ expressId, name: name || `#${expressId}`, area });
    }

    const zones = readZonesForDisplay(
      parsedZonesOf(dataStore, RelationshipType.AssignsToGroup),
      overlay ? readZones(authoredEntities(overlay)) : [],
    ).filter((zone) => themeOfZone(zone.objectType)?.id === themeId);

    // The other container. An id present on both sides is one zone the session
    // has edited, and the authored record carries the later membership.
    const bodies = new Map(
      parsedSpatialZonesOf(
        {
          ...dataStore,
          predefinedTypeOf: (id) => resolveEntityPredefinedType(dataStore, id),
        },
        RelationshipType.ReferencedInSpatialStructure,
      ).map((body) => [body.expressId, body]),
    );
    for (const body of overlay ? authoredSpatialZonesOf(authoredEntities(overlay)) : []) {
      bodies.set(body.expressId, body);
    }
    const throughBody = new Set<number>();
    for (const body of bodies.values()) {
      if (themeOfSpatialZone(body.predefinedType, body.objectType)?.id !== themeId) continue;
      for (const memberId of body.memberIds) throughBody.add(memberId);
    }

    return readRoster(rooms, zones, throughBody);
    // `mutationVersion` because painting a room mutates the overlay in place:
    // neither the view nor the map changes identity when the brush lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, themeId, modelId, dataStore, geometryResult, mutationViews, mutationVersion]);
}

export default useZoneRoster;
