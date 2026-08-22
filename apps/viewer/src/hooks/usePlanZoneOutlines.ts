/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The zone boundaries on the storey being drawn.
 *
 * Binds `lib/zoneOutline` to the model. Rooms and doors come from the same
 * `useSpaceGraph` the escape routes, the door numbers and the detector groups
 * are built on — so the line drawn around a zone can never describe a different
 * building than the rest of the fire work does.
 *
 * # The file's zones count, not only this session's
 * `readZones` returns what was authored HERE — a rule about writing, so the
 * brush cannot paint into somebody else's grouping. Drawing is the opposite
 * case: a zone that came in with the file is exactly what a fire plan has to
 * show. Both sides are merged.
 *
 * # One theme at a time
 * A room is in one fire compartment AND one Auslösezone, and drawing both gives
 * two nearly identical lines a few centimetres apart. Which one is meant
 * follows the active installation: on Branddetektion it is the fire trigger
 * zone, on Gasdetektion the gas one. Off a discipline role it falls back to
 * fire, which is the one this feature was asked for.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';
import { useViewerStore } from '@/store';
import { useSpaceGraph } from './useSpaceGraph';
import { parsedZonesOf, readZones, readZonesForDisplay } from '@/lib/ifcZones/membership';
import { RelationshipType } from '@ifc-lite/data';
import { themeOfZone } from '@/lib/ifcZones/themes';
import { authoredEntities } from '@/lib/mutations/authoredEntities';
import { findDisciplineSystem } from '@/lib/roles/disciplineRoles';
import {
  boundaryEdges, zoneOutline,
  type OutlineDoor, type OutlineSegment,
} from '@/lib/zoneOutline/zoneOutline';
import { ZONE_LINE_WEIGHT_M } from '@/components/viewer/PlanZoneOutlines';

export interface PlanZoneOutline {
  readonly zoneId: number;
  readonly name: string;
  /** `#RRGGBB` from the zone, or `null` — the plan then picks its own. */
  readonly colour: string | null;
  readonly segments: readonly OutlineSegment[];
}

export interface UsePlanZoneOutlinesOptions {
  enabled: boolean;
  geometryResult: GeometryResult | null | undefined;
  dataStore: IfcDataStore | null | undefined;
  modelId: string | null;
  storeyId: number | null;
}

export function usePlanZoneOutlines({
  enabled, geometryResult, dataStore, modelId, storeyId,
}: UsePlanZoneOutlinesOptions): PlanZoneOutline[] {
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const roleId = useViewerStore((s) => s.activeDisciplineSystemId);

  const graph = useSpaceGraph({ enabled, geometryResult, dataStore, modelId, storeyId });

  return useMemo((): PlanZoneOutline[] => {
    if (!enabled || !graph || !modelId) return [];
    // The overlay may not exist yet on a freshly opened model, and the file's
    // own zones are drawn either way.
    const view = mutationViews.get(modelId === 'legacy' ? '__legacy__' : modelId);

    // The file's own zones. Shared with the detector-group derivation, which
    // has to see exactly the zones this draws — see `parsedZonesOf`.
    const parsed = parsedZonesOf(dataStore, RelationshipType.AssignsToGroup);

    const system = findDisciplineSystem(roleId);
    const theme = system?.objectType === 'GasDetection' ? 'gas-trigger' : 'fire-trigger';
    const zones = readZonesForDisplay(parsed, view ? readZones(authoredEntities(view)) : [])
      .filter((zone) => themeOfZone(zone.objectType)?.id === theme);
    if (zones.length === 0) return [];

    // Every door on the storey breaks any boundary it sits in — including a
    // door between two rooms of the same zone, whose wall is internal and
    // therefore not drawn at all. Filtering them per zone would cost a lookup
    // and change nothing.
    const doors: OutlineDoor[] = [];
    for (const door of graph.doors.values()) {
      if (door.width === null) continue;
      doors.push({ centre: door.centre, along: door.along, width: door.width });
    }

    const out: PlanZoneOutline[] = [];
    for (const zone of zones) {
      const rooms = zone.memberIds
        .map((id) => graph.spaces.get(id))
        .filter((space): space is NonNullable<typeof space> => space !== undefined)
        .map((space) => ({
          id: space.id,
          triangles: space.triangles,
          edges: boundaryEdges(space.triangles),
        }));
      // A zone whose rooms are all on another storey has nothing to draw here.
      if (rooms.length === 0) continue;
      out.push({
        zoneId: zone.expressId,
        name: zone.name,
        colour: zone.colour,
        // Half the drawn weight, so the line comes to rest against the wall
        // face instead of straddling it — the fire-plan convention.
        segments: zoneOutline(rooms, doors, { inset: ZONE_LINE_WEIGHT_M / 2 }),
      });
    }
    return out;
    // `mutationVersion` bumps whenever a room is painted into a zone, which is
    // the whole point: the line follows the brush.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, graph, dataStore, modelId, mutationViews, mutationVersion, roleId]);
}

export default usePlanZoneOutlines;
