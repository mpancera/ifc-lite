/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The rooms of the target storey, and what the device run would do to them.
 *
 * Binds the pure planner in `lib/placeBySpace` to the model: rooms come from
 * the same `useSpaceGraph` the escape routes and the door numbers are built
 * on, so the tool can never place into a room the rest of the software does
 * not see. Rooms authored this session count — the ordinary sequence is detect
 * rooms, then equip them.
 *
 * # Which rooms already count as equipped
 * From the spatial containment: `addSensor` and `addLibraryElement` both
 * contain a device in the room it stands in, and `registerAuthoredElement`
 * records that in `bySpace`. So "has this room got one already" is answered by
 * the model rather than by remembering what this session did — which is what
 * makes a second run after drawing three more rooms safe.
 */

import { useMemo } from 'react';
import { useViewerStore } from '@/store';
import { useIfc } from './useIfc';
import { useSpaceGraph } from './useSpaceGraph';
import { overlayAttribute } from '@/lib/mutations/overlayAttribute';
import type { SpaceNode } from '@/lib/spaceGraph/spaceGraph';
import {
  planDevicesBySpace,
  type PlaceBySpaceParams,
  type PlaceBySpacePlan,
} from '@/lib/placeBySpace/placeBySpace';

export interface UsePlaceBySpaceOptions {
  /** Off unless the panel is actually showing the tool. */
  enabled: boolean;
  modelId: string | null;
  storeyId: number | null;
  /**
   * The IFC entity the devices will be, e.g. `'IfcSensor'`. Decides which
   * rooms count as equipped: a room with a camera in it still needs a
   * detector.
   */
  ifcEntity: string;
  params: PlaceBySpaceParams;
}

export interface PlaceBySpaceSource {
  plan: PlaceBySpacePlan;
  /** Floor-to-floor height of the target storey, or `null` where the model states none. */
  storeyHeight: number | null;
  /** True once there is a model and a storey to work on. */
  ready: boolean;
}

const EMPTY: PlaceBySpacePlan = { placements: [], skipped: [], roomsConsidered: 0 };

export function usePlaceBySpace({
  enabled, modelId, storeyId, ifcEntity, params,
}: UsePlaceBySpaceOptions): PlaceBySpaceSource {
  const { models, ifcDataStore: legacyStore, geometryResult: legacyGeometry } = useIfc();
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  const model = modelId ? models.get(modelId) : null;
  const dataStore = model?.ifcDataStore ?? (modelId === 'legacy' ? legacyStore : null);
  const geometryResult = model?.geometryResult ?? (modelId === 'legacy' ? legacyGeometry : null);

  const graph = useSpaceGraph({ enabled, geometryResult, dataStore, modelId, storeyId });

  return useMemo((): PlaceBySpaceSource => {
    const ready = enabled && !!dataStore && storeyId !== null;
    if (!ready || !graph) return { plan: EMPTY, storeyHeight: null, ready };

    const overlay = modelId
      ? mutationViews.get(modelId === 'legacy' ? '__legacy__' : modelId)
      : undefined;

    // One pass over the overlay: a device authored this session has no entry
    // in the parsed store's type index.
    const overlayTypes = new Map<number, string>();
    if (overlay) {
      for (const entity of overlay.getNewEntities()) overlayTypes.set(entity.expressId, entity.type);
    }
    const wanted = ifcEntity.toUpperCase();
    const typeOf = (id: number): string =>
      (overlayTypes.get(id) ?? dataStore?.entities?.getTypeName?.(id) ?? '').toUpperCase();

    const bySpace = dataStore?.spatialHierarchy?.bySpace;
    const occupied = new Set<number>();
    for (const space of graph.spaces.values()) {
      const contained = bySpace?.get(space.id);
      if (contained?.some((id) => typeOf(id) === wanted)) occupied.add(space.id);
    }

    // `Name` is the room NUMBER in this convention and `LongName` is what the
    // room is called — the same reading the door numbers take, overlay first
    // so a number given a minute ago is the one in the summary.
    const labelOf = (space: SpaceNode): string => {
      const number = overlayAttribute(overlay, space.id, 'Name')
        ?? String(dataStore?.entities?.getName?.(space.id) ?? '').trim();
      return number || space.name;
    };

    const spaces = [...graph.spaces.values()];
    return {
      plan: planDevicesBySpace(spaces, params, { occupied, labelOf }),
      storeyHeight: dataStore?.spatialHierarchy?.storeyHeights?.get(storeyId) ?? null,
      ready,
    };
    // `mutationVersion` bumps on every authoring edit, so the summary counts
    // the devices placed a moment ago instead of offering to place them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, graph, dataStore, modelId, storeyId, ifcEntity, params, mutationViews, mutationVersion]);
}

export default usePlaceBySpace;
