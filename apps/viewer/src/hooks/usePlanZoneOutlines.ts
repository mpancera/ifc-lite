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
 * # Layers, not one theme
 * A room is in one Brandabschnitt AND in one Meldezone, and the two do not
 * coincide — see `lib/zoneOutline/zoneLayers.ts` for why they are drawn
 * together and how they keep out of each other's way. Which DETECTION theme is
 * meant still follows the active installation: on Branddetektion the fire
 * trigger zone, on Gasdetektion the gas one.
 *
 * Every layer the MODEL has is computed, whether or not it is switched on:
 * the toolbar reads these counts to decide whether a layer can be shown at
 * all, so computing only the visible ones would disable the switch that turns
 * them on. The caller filters by `themeId` for drawing.
 *
 * The nesting follows the model for the same reason it must not follow the
 * switches: a boundary would otherwise move on the sheet because somebody
 * toggled a different layer. A storey with no Brandabschnitt has nothing to
 * nest behind, and its detection zones sit against the wall exactly as before.
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
import {
  COMPARTMENT_LAYER, FIRE_TRIGGER_LAYER, GAS_TRIGGER_LAYER,
  layerInsets, type ZoneLayer,
} from '@/lib/zoneOutline/zoneLayers';

/** Shared, so a layer that does not tint allocates nothing per zone. */
const EMPTY_FILLS: readonly Float32Array[] = [];

export interface PlanZoneOutline {
  readonly zoneId: number;
  readonly name: string;
  /** Which layer drew it — a theme id from `lib/ifcZones/themes.ts`. Decides
   *  the drawn weight and the fallback colour, on screen and on the sheet. */
  readonly themeId: string;
  /** Metres. The drawn weight of THIS boundary, before any zoom. */
  readonly weightM: number;
  /** `#RRGGBB` from the zone, or `null` — the plan then picks its own. */
  readonly colour: string | null;
  readonly segments: readonly OutlineSegment[];
  /**
   * The zone's rooms as projected triangles, for the tint inside the line.
   *
   * The same triangles the outline was built from — they are already here, and
   * a second derivation would be a second chance for the fill and the boundary
   * to disagree about where the zone is.
   *
   * EMPTY for every layer but the innermost one drawn; see the tinting rule
   * where it is filled in.
   */
  readonly fills: readonly Float32Array[];
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
    const detection = system?.objectType === 'GasDetection' ? GAS_TRIGGER_LAYER : FIRE_TRIGGER_LAYER;

    const all = readZonesForDisplay(parsed, view ? readZones(authoredEntities(view)) : []);
    const has = (layer: ZoneLayer) =>
      all.some((zone) => themeOfZone(zone.objectType)?.id === layer.themeId);
    // Outermost first: the compartment encloses the detection zone, on the
    // plan as in the building, and that order is what the insets stack along.
    // A layer the model does not have is left OUT of the stack rather than
    // reserved a place in it — otherwise a plan with no compartments would
    // float its detection boundaries a compartment's width inside the wall.
    const layers: ZoneLayer[] = [COMPARTMENT_LAYER, detection].filter(has);
    if (layers.length === 0) return [];
    const insets = layerInsets(layers);

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
    layers.forEach((layer, index) => {
      for (const zone of all) {
        if (themeOfZone(zone.objectType)?.id !== layer.themeId) continue;
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
          themeId: layer.themeId,
          weightM: layer.weightM,
          colour: zone.colour,
          // Half this layer's weight plus everything outside it, so the line
          // comes to rest ON its boundary rather than straddling it, and the
          // layers touch instead of overlapping.
          segments: zoneOutline(rooms, doors, { inset: insets[index] }),
          // Only the INNERMOST layer tints. Two tints over one room is 32 % of
          // two different hues, which reads as a third colour and hides the
          // floor under it; and the finest subdivision on the sheet is the one
          // the tint should be answering for. So the compartment fills when it
          // is drawn alone, and drops to a line as soon as the detection zones
          // subdivide it.
          fills: index === layers.length - 1 ? rooms.map((room) => room.triangles) : EMPTY_FILLS,
        });
      }
    });
    return out;
    // `mutationVersion` bumps whenever a room is painted into a zone, which is
    // the whole point: the line follows the brush.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, graph, dataStore, modelId, mutationViews, mutationVersion, roleId]);
}

export default usePlanZoneOutlines;
