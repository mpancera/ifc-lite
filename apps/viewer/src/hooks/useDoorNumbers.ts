/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Door numbers for the storey in scope, ready to be written.
 *
 * The decision is `lib/doorNumbers`; this is where the three things it needs
 * come from, and each has to be the same source the rest of the plan uses or
 * the numbering would describe a different building than the drawing:
 *
 * - **the graph** — which rooms a door joins — from `useSpaceGraph`, the one
 *   the escape routes are walked on. Marc asked for the numbering to follow
 *   the escape path, and this way it is literally the same path.
 * - **the room number** from the overlay first, so a room renamed a minute ago
 *   numbers its doors under the new number rather than the parsed one.
 * - **the swing** from the opening symbols, which is the fallback where two
 *   rooms are equally far from the way out.
 *
 * # Single model, single storey
 * Express ids are local and the graph is built per storey, the same
 * restriction the plan labels and the escape routes carry.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';
import { useViewerStore } from '@/store';
import { overlayAttribute } from '@/lib/mutations/overlayAttribute';
import { isStairwell } from '@/lib/spaceGraph/spaceGraph';
import { useSpaceGraph } from './useSpaceGraph';
import { usePlanOpeningSymbols } from './usePlanOpeningSymbols';
import {
  planDoorNumbers,
  type DoorNumberPlan, type NumberingDoor, type NumberingRoom,
} from '@/lib/doorNumbers/doorNumbers';

export interface UseDoorNumbersOptions {
  enabled: boolean;
  geometryResult: GeometryResult | null | undefined;
  dataStore: IfcDataStore | null | undefined;
  modelId: string | null;
  storeyId: number | null;
}

export interface DoorNumbersSource {
  readonly plan: DoorNumberPlan;
  /** Room id to its number and name, for showing what a door was named after. */
  readonly rooms: ReadonlyMap<number, { number: string; name: string }>;
  /** Door id to the mark it carries right now, so a change is visible as one. */
  readonly current: ReadonlyMap<number, string>;
  /** False when there is no graph to decide on — no model, no storey, no rooms. */
  readonly ready: boolean;
}

const EMPTY: DoorNumbersSource = {
  plan: { numbers: [], problems: [], steps: new Map() },
  rooms: new Map(),
  current: new Map(),
  ready: false,
};

export function useDoorNumbers({
  enabled, geometryResult, dataStore, modelId, storeyId,
}: UseDoorNumbersOptions): DoorNumbersSource {
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  const graph = useSpaceGraph({ enabled, geometryResult, dataStore, modelId, storeyId });
  const { symbols } = usePlanOpeningSymbols({
    enabled, geometryResult, dataStore, storeyId, modelId, drawing: null,
  });

  return useMemo((): DoorNumbersSource => {
    if (!enabled || !graph || !dataStore) return EMPTY;

    const overlay = modelId
      ? mutationViews.get(modelId === 'legacy' ? '__legacy__' : modelId)
      : undefined;
    const text = (value: unknown): string => {
      if (value === undefined || value === null) return '';
      const s = String(value).trim();
      return s === '$' || s === '*' ? '' : s;
    };

    const rooms = new Map<number, { number: string; name: string }>();
    const numberingRooms: NumberingRoom[] = [];
    for (const space of graph.spaces.values()) {
      // `Name` is the room NUMBER in this convention — `LongName` is what it
      // is called. The graph node carries the readable name, so the number is
      // read here, overlay first.
      const number = overlayAttribute(overlay, space.id, 'Name')
        ?? text(dataStore.entities?.getName?.(space.id));
      rooms.set(space.id, { number, name: space.name });
      numberingRooms.push({
        id: space.id,
        number,
        centre: space.labelPoint,
        // A stairwell is where a route ends, so it is where the counting
        // starts. `isStairwell` reads the same name and usage the escape
        // routing does, so the two cannot disagree about what a stair is.
        safe: isStairwell(space),
      });
    }

    /** Which room a leaf swings into: `+across` is the edge's `to` side. */
    const swing = new Map<number, number | null>();
    for (const symbol of symbols) {
      if (symbol.openTowards === null) continue;
      const edge = graph.edges.find((e) => e.doorId === symbol.expressId);
      if (!edge) continue;
      // `+across` is the side the edge calls `to` — see `doorThreshold`.
      swing.set(symbol.expressId, symbol.openTowards === 1 ? edge.to : edge.from);
    }

    const doors: NumberingDoor[] = [];
    const current = new Map<number, string>();
    for (const edge of graph.edges) {
      const door = graph.doors.get(edge.doorId);
      if (!door) continue;
      doors.push({
        id: edge.doorId,
        centre: door.centre,
        sides: [edge.from, edge.to],
        opensInto: swing.get(edge.doorId) ?? null,
      });
      current.set(edge.doorId, overlayAttribute(overlay, edge.doorId, 'Name')
        ?? text(dataStore.entities?.getName?.(edge.doorId)));
    }

    return {
      plan: planDoorNumbers(numberingRooms, doors),
      rooms,
      current,
      ready: numberingRooms.length > 0 && doors.length > 0,
    };
    // `mutationVersion` is deliberate: a room renamed a moment ago changes
    // every door number derived from it, and the overlay is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, graph, symbols, dataStore, modelId, mutationViews, mutationVersion]);
}

export default useDoorNumbers;
