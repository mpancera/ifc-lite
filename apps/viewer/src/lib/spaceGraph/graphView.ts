/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The space graph made visible.
 *
 * The graph decides escape routes and door numbers, and until now nobody could
 * look at it — the first question about a wrong door number is "did it even
 * find that doorway?", and there was no way to answer it except by reading
 * code. This turns the graph into things that can be drawn: a node per room, a
 * line per door, and the one number the numbering actually runs on.
 *
 * # What is worth seeing, and what is noise
 * The steps-to-safety count is the heart of it: every door number follows from
 * comparing two of them, so a number that looks wrong is nearly always a count
 * that looks wrong, and the count is checkable by eye — the corridor should be
 * 1, the rooms off it 2, the store room behind one of them 3. A room the
 * search never reached has no count, and that is the interesting case rather
 * than an omission: it means the plan has no way out that the graph can find.
 *
 * # Where the outside is
 * An exterior door joins a room to nothing. Drawing it as a stub into the open
 * says that better than leaving it out, which would make the exit look like a
 * wall. The stub ends at the door's own threshold point on the empty side —
 * the same point the routing steps through — so it points the way somebody
 * would actually walk.
 */

import type { SpaceGraph } from './spaceGraph.js';

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export type GraphNodeKind =
  /** An ordinary room. */
  | 'room'
  /** A room that IS the way out — a stairwell. Counting starts here. */
  | 'safe'
  /** A room the search could not reach from any exit. */
  | 'stranded';

export interface GraphNodeView {
  readonly spaceId: number;
  readonly at: Point2D;
  /** The room's number or name, whichever it has. */
  readonly label: string;
  readonly kind: GraphNodeKind;
  /** Doors to pass before somebody is safe; `null` where none was found. */
  readonly steps: number | null;
  /** How many doors touch this room — a room with one is a dead end. */
  readonly degree: number;
}

export interface GraphEdgeView {
  readonly doorId: number;
  readonly from: Point2D;
  readonly to: Point2D;
  /** True when one end is the outside rather than a room. */
  readonly exterior: boolean;
  /** Room ids the edge joins; one entry for an exterior door. */
  readonly spaceIds: readonly number[];
}

export interface SpaceGraphView {
  readonly nodes: readonly GraphNodeView[];
  readonly edges: readonly GraphEdgeView[];
}

export interface SpaceGraphViewOptions {
  /** Steps to safety per room — see `lib/doorNumbers`. */
  readonly steps?: ReadonlyMap<number, number>;
  /** Which rooms count as safety themselves, for the node kind. */
  readonly safe?: ReadonlySet<number>;
  /** Room id to the label to draw; falls back to the graph's own name. */
  readonly labels?: ReadonlyMap<number, string>;
}

export function spaceGraphView(
  graph: SpaceGraph,
  options: SpaceGraphViewOptions = {},
): SpaceGraphView {
  const degree = new Map<number, number>();
  for (const edge of graph.edges) {
    for (const id of [edge.from, edge.to]) {
      if (id === null) continue;
      degree.set(id, (degree.get(id) ?? 0) + 1);
    }
  }

  const nodes: GraphNodeView[] = [];
  for (const space of graph.spaces.values()) {
    const steps = options.steps?.get(space.id) ?? null;
    nodes.push({
      spaceId: space.id,
      at: space.labelPoint,
      label: options.labels?.get(space.id)?.trim() || space.name,
      kind: options.safe?.has(space.id) ? 'safe' : steps === null ? 'stranded' : 'room',
      steps,
      degree: degree.get(space.id) ?? 0,
    });
  }

  const edges: GraphEdgeView[] = [];
  for (const edge of graph.edges) {
    const a = edge.from === null ? null : graph.spaces.get(edge.from);
    const b = edge.to === null ? null : graph.spaces.get(edge.to);
    // A door whose rooms are not in this graph has nothing to join — it
    // belongs to another storey, and drawing it would put a line across the
    // plan to a room that is not on it.
    if (!a && !b) continue;

    const spaceIds = [a?.id, b?.id].filter((id): id is number => id !== undefined);
    edges.push({
      doorId: edge.doorId,
      // The threshold points are the two sides of the doorway; the end that
      // has a room is drawn to the room's own point, the end that has none
      // stops at the threshold — a stub into the open.
      from: a ? a.labelPoint : edge.threshold[0],
      to: b ? b.labelPoint : edge.threshold[1],
      exterior: !a || !b,
      spaceIds,
    });
  }

  return { nodes, edges };
}

export default spaceGraphView;
