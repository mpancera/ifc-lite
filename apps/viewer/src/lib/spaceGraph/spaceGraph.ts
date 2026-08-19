/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The building as a GRAPH of rooms joined by doors.
 *
 * Modelled on Archilogic's Space Graph, which is the clearest published
 * statement of the idea: spaces carry an id, a usage from a taxonomy, an area
 * and a point known to be inside them, and **doors are the connections between
 * spaces**. Everything a route needs follows from that — a plan is a picture,
 * a graph is something you can walk.
 *
 * # Why a graph rather than measuring on the drawing
 * An escape route is the distance somebody WALKS, and walking goes around
 * walls and through doorways. Measured on the drawing, that is a line a person
 * draws by eye and nobody can check; derived from the graph, it follows the
 * building's own topology and changes when the building does.
 *
 * # Where the connection comes from
 * IFC has `IfcRelSpaceBoundary`, and models that carry it carry it well — but
 * most exports do not carry it at all, and a feature that needs it would work
 * on the models that least need help. So the connection is derived from
 * GEOMETRY: step out of each side of the door and see which room you land in.
 * That is the same construction the route itself uses to cross a doorway (see
 * {@link doorThreshold}), which is why the two can never disagree about where
 * a door leads.
 *
 * # Coordinates
 * Everything here is DRAWING space: x is world x, y is world z, the mapping
 * `planPick.ts` pins and `roomLabels.ts` projects into. Nothing in this module
 * knows about plan rotation — rotation turns the picture, and a route is a
 * fact about the building.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';
import { isStairwellSpace } from './circulation.js';

/**
 * A room, as the graph sees it.
 *
 * Carries its triangles rather than an outline. Reconstructing a clean contour
 * from a mesh is its own hard problem (holes, slivers, submesh splits), and
 * every question this module asks — "is this point in this room" — is answered
 * directly and exactly by the triangles. Archilogic's `contour` is the nicer
 * thing to draw; this is the more reliable thing to test against.
 */
export interface SpaceNode {
  /** `IfcSpace` expressId. */
  readonly id: number;
  /** What the room is called, for naming the route. */
  readonly name: string;
  /**
   * The room's usage, lower-cased: `PredefinedType`, or `ObjectType` where
   * that is `USERDEFINED`. Archilogic's `usage`, in IFC's vocabulary.
   */
  readonly usage: string | null;
  /** Floor area in m². */
  readonly area: number;
  /** A point known to be inside — Archilogic's `labelPoint`. */
  readonly labelPoint: Point2D;
  /**
   * Projected triangles, flat: `[ax, ay, bx, by, cx, cy, …]` in drawing space.
   *
   * One flat array rather than an array of objects: a storey of rooms is tens
   * of thousands of triangles, and a point test walks all of them.
   */
  readonly triangles: Float32Array;
  /** Which storey the room belongs to, for keeping routes on one floor. */
  readonly storeyId: number | null;
  /**
   * Whether stair geometry stands inside this room.
   *
   * The fact that settles what a name like "Erschliessung" leaves open — see
   * `circulation.ts`. Carried on the node rather than looked up on demand
   * because it costs one pass over the meshes and would otherwise be
   * recomputed on every routing question.
   */
  readonly containsStair?: boolean;
}

/**
 * A door, as the graph sees it: an edge between two rooms.
 *
 * `along` and `across` come from `planAxes` in `openingSymbols.ts` — the same
 * two axes the swing arc is drawn from, so a route crosses a doorway in
 * exactly the direction the drawing shows it opening.
 */
export interface DoorNode {
  /** `IfcDoor` expressId. */
  readonly id: number;
  readonly name: string;
  /** Centre of the opening, in drawing space. */
  readonly centre: Point2D;
  /** Unit vector along the door's width. */
  readonly along: Point2D;
  /** Unit vector through the doorway — the direction somebody walks. */
  readonly across: Point2D;
  /**
   * Clear width in metres, or `null` where the geometry states none.
   *
   * `null` rather than `0`: a door whose width could not be measured still
   * joins the two rooms it sits between, and a zero would read as a doorway
   * too narrow to pass — a claim about the building that nothing supports.
   */
  readonly width: number | null;
  readonly storeyId: number | null;
}

/** A door edge, once it is known which rooms it joins. */
export interface SpaceEdge {
  readonly doorId: number;
  /**
   * The rooms on either side. `null` means the step landed in no room at all,
   * which is what an exterior door looks like — and an exterior door is
   * exactly where an escape route wants to end.
   */
  readonly from: number | null;
  readonly to: number | null;
  /** Where a route crosses: two points, one each side of the leaf. */
  readonly threshold: readonly [Point2D, Point2D];
}

export interface SpaceGraph {
  readonly spaces: ReadonlyMap<number, SpaceNode>;
  readonly doors: ReadonlyMap<number, DoorNode>;
  readonly edges: readonly SpaceEdge[];
  /** Space id to the edges touching it, for walking without a scan. */
  readonly adjacency: ReadonlyMap<number, readonly SpaceEdge[]>;
}

/**
 * How far a route steps clear of a doorway on each side, in metres.
 *
 * Marc's rule (2026-08-18): a route crosses a door "mittig mit 1.2 m
 * orthogonaler Strecke durch die Tür" — 1.2 m in total, so 0.6 m each side of
 * the leaf. The number is not cosmetic. It has to clear the wall so the two
 * points land in the ROOMS rather than inside the construction, and a wall
 * thicker than 1.2 m would defeat it — which is why {@link buildSpaceGraph}
 * takes the clearance as an argument rather than baking it in.
 */
export const DOOR_CLEARANCE_M = 1.2;

/** The two points a route uses to cross a door: centre ± half the clearance. */
export function doorThreshold(
  door: DoorNode,
  clearance = DOOR_CLEARANCE_M,
): readonly [Point2D, Point2D] {
  const half = clearance / 2;
  return [
    { x: door.centre.x - door.across.x * half, y: door.centre.y - door.across.y * half },
    { x: door.centre.x + door.across.x * half, y: door.centre.y + door.across.y * half },
  ];
}

/**
 * Whether a point lies in a triangle, by sign of the three cross products.
 *
 * Accepts either winding: a projected mesh has no reliable orientation, and
 * demanding one would reject half the triangles in any real model.
 */
function pointInTriangle(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Whether a point falls inside a room's footprint. */
export function pointInSpace(point: Point2D, space: SpaceNode): boolean {
  const t = space.triangles;
  for (let i = 0; i + 5 < t.length; i += 6) {
    if (pointInTriangle(point.x, point.y, t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4], t[i + 5])) {
      return true;
    }
  }
  return false;
}

/**
 * The room a point is in, or `null` for a point in no room.
 *
 * Where rooms overlap — and they do, because exporters emit spaces that share
 * a boundary and sometimes a sliver — the SMALLEST wins. A corridor and the
 * storey-sized "circulation" space that contains it are both hits, and the
 * corridor is the useful answer; picking by area is a rule that needs no
 * per-model tuning.
 */
export function spaceAt(
  point: Point2D,
  spaces: Iterable<SpaceNode>,
): SpaceNode | null {
  let best: SpaceNode | null = null;
  for (const space of spaces) {
    if (!pointInSpace(point, space)) continue;
    if (best === null || space.area < best.area) best = space;
  }
  return best;
}

/**
 * Build the graph: rooms as nodes, doors as edges between them.
 *
 * A door whose two sides land in the SAME room contributes nothing — that
 * happens with a door into a cupboard modelled inside its room, and an edge
 * from a room to itself would just be a detour the router could take. A door
 * with neither side in a room is dropped too: it connects nothing this graph
 * knows about.
 */
export function buildSpaceGraph(
  spaces: readonly SpaceNode[],
  doors: readonly DoorNode[],
  clearance = DOOR_CLEARANCE_M,
): SpaceGraph {
  const spaceMap = new Map<number, SpaceNode>();
  for (const space of spaces) spaceMap.set(space.id, space);

  const doorMap = new Map<number, DoorNode>();
  const edges: SpaceEdge[] = [];
  const adjacency = new Map<number, SpaceEdge[]>();

  for (const door of doors) {
    doorMap.set(door.id, door);
    const threshold = doorThreshold(door, clearance);

    // Only rooms on the door's own storey: a door on the ground floor must not
    // connect to the room directly above it, which in plan sits at the very
    // same coordinates.
    const onStorey = spaces.filter(
      (space) => door.storeyId === null
        || space.storeyId === null
        || space.storeyId === door.storeyId,
    );

    const from = spaceAt(threshold[0], onStorey);
    const to = spaceAt(threshold[1], onStorey);

    if (from === null && to === null) continue;
    if (from !== null && to !== null && from.id === to.id) continue;

    const edge: SpaceEdge = {
      doorId: door.id,
      from: from?.id ?? null,
      to: to?.id ?? null,
      threshold,
    };
    edges.push(edge);

    for (const id of [edge.from, edge.to]) {
      if (id === null) continue;
      const list = adjacency.get(id);
      if (list) list.push(edge);
      else adjacency.set(id, [edge]);
    }
  }

  return { spaces: spaceMap, doors: doorMap, edges, adjacency };
}

/** The room on the other side of an edge, or `null` for the outside. */
export function edgeTarget(edge: SpaceEdge, fromSpaceId: number): number | null {
  return edge.from === fromSpaceId ? edge.to : edge.from;
}

/** The threshold points in walking order, entering from a given room. */
export function edgeThreshold(
  edge: SpaceEdge,
  fromSpaceId: number,
): readonly [Point2D, Point2D] {
  // `threshold[0]` sits on the `from` side by construction, so a route
  // arriving from `to` crosses the pair backwards.
  return edge.from === fromSpaceId
    ? edge.threshold
    : [edge.threshold[1], edge.threshold[0]];
}

/**
 * Whether a room reads as a stairwell — the end of an escape route.
 *
 * Delegates to `circulation.ts`, which carries the reasoning: "Erschliessung"
 * is an umbrella term and does NOT by itself make a stairwell, while stair
 * geometry standing in the room does whatever the room is called.
 */
export function isStairwell(space: SpaceNode): boolean {
  return isStairwellSpace(space, space.containsStair === true);
}

/** Edges that lead out of the building — a door with nothing on one side. */
export function exteriorEdges(graph: SpaceGraph): SpaceEdge[] {
  return graph.edges.filter((edge) => edge.from === null || edge.to === null);
}
