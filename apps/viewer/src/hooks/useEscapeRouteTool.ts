/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The two-click escape-route tool.
 *
 * First click marks where somebody starts — the far corner of a room, which is
 * where a fire concept measures from. Second click marks the target. Between
 * them the route is DERIVED from the space graph rather than drawn: through
 * doorways, around walls, along the shortest walked path.
 *
 * # Why the tool holds the graph and the annotation hook does not
 * `useAnnotation2D` handles clicks for every 2D tool and knows nothing about
 * models — every dependency it has is passed in. Teaching it about rooms and
 * doors to serve one tool would put model knowledge in the one place that has
 * carefully stayed free of it. So this hook owns the graph and hands down a
 * single callback.
 *
 * # Why a failure is a state and not a toast
 * "Start point is in no room" is not an error, it is a thing the author needs
 * to see and correct while still holding the mouse. It sits in the store and
 * the toolbar shows it until the next click, rather than flashing past.
 */

import { useCallback, useMemo } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';
import { useViewerStore } from '@/store';
import { useSpaceGraph } from './useSpaceGraph';
import { findEscapeRoute, type EscapeTarget } from '@/lib/spaceGraph/escapeRouting';
import { spaceAt } from '@/lib/spaceGraph/spaceGraph';
import type { DrawnEscapeRoute } from '@/store/slices/escapeRoutesSlice';

export interface UseEscapeRouteToolOptions {
  /** Only build the graph while the tool is actually selected. */
  enabled: boolean;
  geometryResult: GeometryResult | null | undefined;
  dataStore: IfcDataStore | null | undefined;
  modelId: string | null;
  storeyId: number | null;
}

export interface EscapeRouteTool {
  /** Feed the tool a click in drawing coordinates. */
  pick: (point: Point2D) => void;
  /**
   * Route straight from the pending start to the nearest stairwell, without a
   * second click. The common case in a concept plan: what matters is the way
   * OUT, and which stair that is follows from the building.
   */
  routeToNearest: (target: Extract<EscapeTarget, { kind: 'stairwell' | 'exterior' }>) => void;
  /** How many rooms and doors the graph found, for the toolbar to show. */
  readonly graphSize: { readonly spaces: number; readonly doors: number } | null;
}

/** Ids only have to be unique among the routes of one session. */
function nextRouteId(existing: readonly { id: string }[]): string {
  const taken = new Set(existing.map((route) => route.id));
  for (let index = 1; ; index += 1) {
    const candidate = `fluchtweg-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function useEscapeRouteTool({
  enabled, geometryResult, dataStore, modelId, storeyId,
}: UseEscapeRouteToolOptions): EscapeRouteTool {
  const graph = useSpaceGraph({ enabled, geometryResult, dataStore, modelId, storeyId });

  const routes = useViewerStore((s) => s.escapeRoutes2D);
  const start = useViewerStore((s) => s.escapeRouteStart);
  const kind = useViewerStore((s) => s.escapeRouteKind);
  const setStart = useViewerStore((s) => s.setEscapeRouteStart);
  const setFailure = useViewerStore((s) => s.setEscapeRouteFailure);
  const addRoute = useViewerStore((s) => s.addEscapeRoute);

  /** Run the router from a start point and keep whatever came back. */
  const route = useCallback((from: Point2D, target: EscapeTarget) => {
    if (!graph) return;

    const outcome = findEscapeRoute(graph, from, target);
    if (!outcome.ok) {
      setFailure(outcome.reason);
      // The start is kept on a failed SECOND click: the author picked a bad
      // target, not a bad start, and clearing it would make them re-click a
      // point that was fine.
      if (outcome.reason === 'start-outside-any-room') setStart(null);
      return;
    }

    const drawn: DrawnEscapeRoute = {
      id: nextRouteId(routes),
      points: outcome.route.points,
      kind,
      length: outcome.route.length,
      spaceIds: outcome.route.spaceIds,
      doorIds: outcome.route.doorIds,
      narrowestDoor: outcome.route.narrowestDoor,
    };
    addRoute(drawn);
  }, [graph, routes, kind, addRoute, setFailure, setStart]);

  const pick = useCallback((point: Point2D) => {
    setFailure(null);

    if (start === null) {
      // Reject a start outside every room at the FIRST click rather than at
      // the second: the author would otherwise pick a target and then be told
      // the problem was two clicks ago. Asked of the graph directly, because
      // running the whole router just to validate one point would walk the
      // building to answer a question about a single coordinate.
      if (graph && spaceAt(point, graph.spaces.values()) === null) {
        setFailure('start-outside-any-room');
        return;
      }
      setStart(point);
      return;
    }

    route(start, { kind: 'point', point });
  }, [start, graph, route, setStart, setFailure]);

  const routeToNearest = useCallback((
    target: Extract<EscapeTarget, { kind: 'stairwell' | 'exterior' }>,
  ) => {
    if (start === null) return;
    route(start, target);
  }, [start, route]);

  const graphSize = useMemo(() => (
    graph ? { spaces: graph.spaces.size, doors: graph.doors.size } : null
  ), [graph]);

  return { pick, routeToNearest, graphSize };
}

export default useEscapeRouteTool;
