/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Finding the way out: click a corner, click the exit, get the walked path.
 *
 * The author picks two points; this walks the space graph between them and
 * returns the polyline that `plan/escapeRoutes.ts` turns into a drawn route
 * with arrows and a length. Nothing here draws anything.
 *
 * # What "shortest" means here
 * Shortest by WALKED DISTANCE, not by number of rooms. A route through four
 * small rooms can be shorter than one through two long ones, and the number
 * that matters — the one a fire concept is assessed on — is metres. So the
 * search is Dijkstra over door-to-door distances rather than a breadth-first
 * hop count.
 *
 * # Why the path bends where it does
 * Inside a room the path runs straight from where it entered to where it
 * leaves. That is a deliberate simplification and it is the honest one: the
 * true walked line inside a furnished room is not knowable from an IFC model,
 * and a straight segment between doorways is what a fire concept draws by
 * hand anyway. Where it is wrong it is wrong by being slightly SHORT, and the
 * author can drag the route afterwards — which is why the result is a plain
 * polyline rather than something the router owns.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';
import {
  spaceAt, edgeTarget, edgeThreshold, isStairwell,
  type SpaceGraph, type SpaceEdge, type SpaceNode,
} from './spaceGraph.js';

/** Straight-line distance between two drawing points. */
function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Where a route may end. */
export type EscapeTarget =
  /** A point the author clicked. */
  | { readonly kind: 'point'; readonly point: Point2D }
  /** The nearest stairwell, by walked distance. */
  | { readonly kind: 'stairwell' }
  /** The nearest door leading outside. */
  | { readonly kind: 'exterior' };

export interface EscapeRouteResult {
  /** The walked path, ready for `escapeRouteAnnotations`. */
  readonly points: readonly Point2D[];
  /** Walked length in metres. */
  readonly length: number;
  /** Rooms passed through, in order. */
  readonly spaceIds: readonly number[];
  /** Doors passed through, in order. */
  readonly doorIds: readonly number[];
  /** The narrowest door on the route, in metres — `null` for a route with none. */
  readonly narrowestDoor: number | null;
}

/** Why a route could not be found. */
export type EscapeRouteFailure =
  | 'start-outside-any-room'
  | 'end-outside-any-room'
  | 'no-target-found'
  | 'no-path';

export type EscapeRouteOutcome =
  | { readonly ok: true; readonly route: EscapeRouteResult }
  | { readonly ok: false; readonly reason: EscapeRouteFailure };

/** One step of the search, kept so the path can be rebuilt at the end. */
interface Visit {
  readonly spaceId: number;
  /** Where the route stands in that room: the point it entered by. */
  readonly at: Point2D;
  readonly cost: number;
  readonly viaEdge: SpaceEdge | null;
  readonly from: Visit | null;
}

/**
 * Walk the graph from a start point, cheapest-first.
 *
 * Returns every room reached with the cheapest visit to it. Dijkstra rather
 * than A*: a storey has tens of rooms, the heuristic would save nothing
 * measurable, and an admissible heuristic through doorways is fiddly enough
 * to get subtly wrong.
 */
function walk(graph: SpaceGraph, startSpace: SpaceNode, start: Point2D): Map<number, Visit> {
  const best = new Map<number, Visit>();
  const queue: Visit[] = [{
    spaceId: startSpace.id, at: start, cost: 0, viaEdge: null, from: null,
  }];
  best.set(startSpace.id, queue[0]);

  while (queue.length > 0) {
    // Linear scan for the cheapest. A real heap would matter at thousands of
    // rooms; a storey has tens, and the scan keeps this readable.
    let index = 0;
    for (let i = 1; i < queue.length; i += 1) {
      if (queue[i].cost < queue[index].cost) index = i;
    }
    const current = queue.splice(index, 1)[0];

    // A cheaper way here turned up after this was queued.
    if ((best.get(current.spaceId)?.cost ?? Infinity) < current.cost) continue;

    for (const edge of graph.adjacency.get(current.spaceId) ?? []) {
      const nextId = edgeTarget(edge, current.spaceId);
      // The outside is a destination, not somewhere to route onward through.
      if (nextId === null) continue;

      const [enter, exit] = edgeThreshold(edge, current.spaceId);
      // Walk to the near side of the door, then through it.
      const cost = current.cost + distance(current.at, enter) + distance(enter, exit);

      if (cost >= (best.get(nextId)?.cost ?? Infinity)) continue;
      const visit: Visit = {
        spaceId: nextId, at: exit, cost, viaEdge: edge, from: current,
      };
      best.set(nextId, visit);
      queue.push(visit);
    }
  }

  return best;
}

/** Rebuild the polyline and the ids from a chain of visits. */
function assemble(
  graph: SpaceGraph,
  last: Visit,
  finish: Point2D,
): EscapeRouteResult {
  const chain: Visit[] = [];
  for (let visit: Visit | null = last; visit !== null; visit = visit.from) chain.unshift(visit);

  const points: Point2D[] = [chain[0].at];
  const spaceIds: number[] = [chain[0].spaceId];
  const doorIds: number[] = [];
  let narrowest: number | null = null;

  for (let i = 1; i < chain.length; i += 1) {
    const visit = chain[i];
    const edge = visit.viaEdge;
    if (edge === null) continue;

    const [enter, exit] = edgeThreshold(edge, chain[i - 1].spaceId);
    points.push(enter, exit);
    spaceIds.push(visit.spaceId);
    doorIds.push(edge.doorId);

    const width = graph.doors.get(edge.doorId)?.width;
    if (typeof width === 'number' && (narrowest === null || width < narrowest)) {
      narrowest = width;
    }
  }

  points.push(finish);

  // Consecutive duplicates make a zero-length segment, which has no direction
  // and would put a NaN arrow on the drawing.
  const cleaned: Point2D[] = [];
  for (const point of points) {
    const previous = cleaned[cleaned.length - 1];
    if (previous && distance(previous, point) < 1e-6) continue;
    cleaned.push(point);
  }

  let length = 0;
  for (let i = 1; i < cleaned.length; i += 1) length += distance(cleaned[i - 1], cleaned[i]);

  return { points: cleaned, length, spaceIds, doorIds, narrowestDoor: narrowest };
}

/**
 * The route from a clicked point to a target.
 *
 * The start must be inside a room: a click in the middle of a wall has no
 * room to start walking from, and guessing the nearest one would silently
 * measure from somewhere the author did not point at.
 */
export function findEscapeRoute(
  graph: SpaceGraph,
  start: Point2D,
  target: EscapeTarget,
): EscapeRouteOutcome {
  const startSpace = spaceAt(start, graph.spaces.values());
  if (!startSpace) return { ok: false, reason: 'start-outside-any-room' };

  const reached = walk(graph, startSpace, start);

  if (target.kind === 'point') {
    const endSpace = spaceAt(target.point, graph.spaces.values());
    if (!endSpace) return { ok: false, reason: 'end-outside-any-room' };

    const visit = reached.get(endSpace.id);
    if (!visit) return { ok: false, reason: 'no-path' };
    return { ok: true, route: assemble(graph, visit, target.point) };
  }

  if (target.kind === 'stairwell') {
    let best: Visit | null = null;
    for (const visit of reached.values()) {
      const space = graph.spaces.get(visit.spaceId);
      if (!space || !isStairwell(space)) continue;
      if (best === null || visit.cost < best.cost) best = visit;
    }
    if (best === null) return { ok: false, reason: 'no-target-found' };
    // Ends at the point it entered the stairwell by: reaching the stair IS
    // reaching safety, and walking on to the middle of the room would add
    // metres nobody has to walk.
    return { ok: true, route: assemble(graph, best, best.at) };
  }

  // Exterior: the cheapest room that has a door to nowhere, ending at that
  // door's outer threshold.
  let best: { visit: Visit; exit: Point2D; cost: number } | null = null;
  for (const visit of reached.values()) {
    for (const edge of graph.adjacency.get(visit.spaceId) ?? []) {
      if (edgeTarget(edge, visit.spaceId) !== null) continue;

      const [enter, exit] = edgeThreshold(edge, visit.spaceId);
      const cost = visit.cost + distance(visit.at, enter) + distance(enter, exit);
      if (best === null || cost < best.cost) best = { visit, exit, cost };
    }
  }
  if (best === null) return { ok: false, reason: 'no-target-found' };
  return { ok: true, route: assemble(graph, best.visit, best.exit) };
}

/** What to tell the author when no route came back. */
export const FAILURE_MESSAGES: Readonly<Record<EscapeRouteFailure, string>> = {
  'start-outside-any-room': 'Startpunkt liegt in keinem Raum — in einen Raum klicken.',
  'end-outside-any-room': 'Zielpunkt liegt in keinem Raum.',
  'no-target-found': 'Kein Treppenhaus und kein Ausgang gefunden.',
  'no-path': 'Kein Weg zwischen den beiden Punkten — fehlt eine Tür im Modell?',
};
