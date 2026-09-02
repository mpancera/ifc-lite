/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The space graph, in the three levels Archilogic describes
 * (developers.archilogic.com/space-graph):
 *
 * 1. **Planar graph** — corners are nodes, walls are edges, a loop of edges
 *    is a face. That is what the room finder builds; it comes in as input.
 * 2. **Adjacency** — two spaces are adjacent when they share an edge. This
 *    needs no calculation: it is read off the planar graph, which makes it
 *    ground truth rather than a guess.
 * 3. **Connectivity** — adjacency plus an element that lets you through: a
 *    door on the shared wall, or a divider (a boundary drawn without a wall).
 *    A door on an outer wall connects the space to the outside.
 *
 * Assets (block references: detectors, readers, furniture) hang off the
 * space that contains them. The nodes reuse the candidate ids, so the graph
 * and the draft IFC talk about the same things; the outside is one node.
 */

import { centroid, pointInPolygon } from '../interpret/geometry.js';
import type { Candidate, Point2 } from '../types.js';
import type { PlanarGraph } from './enclosed-areas.js';

export type SpaceGraphNodeKind = 'space' | 'door' | 'asset' | 'outside';

export interface SpaceGraphNode {
  id: string;
  kind: SpaceGraphNodeKind;
  position: Point2;
  /** Room name, symbol class, or nothing. */
  label?: string;
  /** Index into `PlanarGraph.faces` for a space node. */
  face?: number;
  /** Candidate id when the node comes from the interpretation. */
  candidateId?: string;
  areaM2?: number;
}

export type SpaceGraphEdgeKind = 'adjacent' | 'connected' | 'contains';

export interface SpaceGraphEdge {
  kind: SpaceGraphEdgeKind;
  a: string;
  b: string;
  /** For 'connected': the door node, or undefined for an open divider. */
  via?: string;
  /** Planar edges that carry this relation (walls shared, or the wall the door sits in). */
  planarEdges: number[];
  /** Shared wall length in metres, for adjacency. */
  lengthM?: number;
}

export interface SpaceGraph {
  nodes: SpaceGraphNode[];
  edges: SpaceGraphEdge[];
  /** Space nodes that no door or divider reaches from the outside. */
  unreachable: string[];
  stats: {
    spaces: number;
    doors: number;
    doorsPlaced: number;
    assets: number;
    adjacencies: number;
    connections: number;
    unreachable: number;
  };
}

export interface SpaceGraphOptions {
  /** How far a door's hinge may sit from the wall it opens in. Default 0.25 m. */
  doorToWallM?: number;
}

export const OUTSIDE_ID = 'outside';

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function buildSpaceGraph(planar: PlanarGraph, candidates: readonly Candidate[], options: SpaceGraphOptions = {}): SpaceGraph {
  const doorToWall = options.doorToWallM ?? 0.25;
  const nodes: SpaceGraphNode[] = [];
  const edges: SpaceGraphEdge[] = [];
  const spaceCands = candidates.filter((c) => c.type === 'space');

  // Space nodes: one per room face, named by the candidate that covers it.
  const nodeOfFace = new Map<number, string>();
  planar.faces.forEach((face, fi) => {
    if (face.kind !== 'room') return;
    const c = centroid(face.outline);
    const cand = spaceCands.find((s) => pointInPolygon(c, s.geometry)) ?? spaceCands.find((s) => pointInPolygon(centroid(s.geometry), face.outline));
    const id = cand?.id ?? `face:${fi}`;
    nodeOfFace.set(fi, id);
    nodes.push({ id, kind: 'space', position: c, ...(cand?.text ? { label: cand.text } : {}), face: fi, ...(cand ? { candidateId: cand.id } : {}), areaM2: face.area });
  });
  nodes.push({ id: OUTSIDE_ID, kind: 'outside', position: { x: NaN, y: NaN } });

  const sideId = (fi: number): string | null => {
    if (fi < 0) return OUTSIDE_ID;
    const f = planar.faces[fi];
    if (f.kind === 'room') return nodeOfFace.get(fi) ?? null;
    if (f.kind === 'outer') return OUTSIDE_ID;
    // A wall cavity or a fragment: the other side of it is not a neighbour we can name.
    return null;
  };

  // Level 2: adjacency, read off shared edges. Level 3 for dividers: open connections.
  const adjacency = new Map<string, SpaceGraphEdge>();
  const openConnections = new Map<string, SpaceGraphEdge>();
  planar.edges.forEach((e, ei) => {
    const left = sideId(e.faceLeft);
    const right = sideId(e.faceRight);
    if (!left || !right || left === right) return;
    if (left === OUTSIDE_ID || right === OUTSIDE_ID) return;
    const len = Math.hypot(planar.vertices[e.b].x - planar.vertices[e.a].x, planar.vertices[e.b].y - planar.vertices[e.a].y);
    const key = pairKey(left, right);
    const adj = adjacency.get(key);
    if (adj) {
      adj.planarEdges.push(ei);
      adj.lengthM = (adj.lengthM ?? 0) + len;
    } else {
      adjacency.set(key, { kind: 'adjacent', a: left, b: right, planarEdges: [ei], lengthM: len });
    }
    if (e.kind === 'divider') {
      const open = openConnections.get(key);
      if (open) open.planarEdges.push(ei);
      else openConnections.set(key, { kind: 'connected', a: left, b: right, planarEdges: [ei] });
    }
  });
  edges.push(...adjacency.values(), ...openConnections.values());

  // Level 3: doors. A door sits in the wall nearest its hinge; that wall's two sides are what it connects.
  let doorsPlaced = 0;
  const connectedKeys = new Set(openConnections.keys());
  for (const door of candidates.filter((c) => c.type === 'door')) {
    const hinge = door.geometry[0];
    const reach = Math.max(doorToWall, (door.thickness ?? 0) * 0.35);
    let best: { ei: number; d: number } | null = null;
    planar.edges.forEach((e, ei) => {
      const d = distanceToSegment(hinge, planar.vertices[e.a], planar.vertices[e.b]);
      if (d <= reach && (!best || d < best.d)) best = { ei, d };
    });
    const doorNode: SpaceGraphNode = { id: door.id, kind: 'door', position: hinge, candidateId: door.id, label: 'door' };
    nodes.push(doorNode);
    if (!best) continue;
    const e = planar.edges[(best as { ei: number }).ei];
    const left = sideId(e.faceLeft);
    const right = sideId(e.faceRight);
    if (!left || !right || left === right) continue;
    doorsPlaced += 1;
    const key = pairKey(left, right);
    if (connectedKeys.has(key) && !edges.some((x) => x.kind === 'connected' && x.via === door.id)) {
      // Already open between these two; still record the door as a way through.
    }
    connectedKeys.add(key);
    edges.push({ kind: 'connected', a: left, b: right, via: door.id, planarEdges: [(best as { ei: number }).ei] });
  }

  // Assets: symbols in a room.
  let assets = 0;
  for (const sym of candidates.filter((c) => c.type === 'symbol')) {
    const p = sym.geometry[0];
    const fi = planar.faces.findIndex((f) => f.kind === 'room' && pointInPolygon(p, f.outline));
    nodes.push({ id: sym.id, kind: 'asset', position: p, candidateId: sym.id, label: sym.symbol?.classified ?? sym.symbol?.blockName });
    assets += 1;
    const space = fi >= 0 ? nodeOfFace.get(fi) : undefined;
    if (space) edges.push({ kind: 'contains', a: space, b: sym.id, planarEdges: [] });
  }

  // Reachability from the outside over connections.
  const reachable = new Set<string>([OUTSIDE_ID]);
  const queue = [OUTSIDE_ID];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const e of edges) {
      if (e.kind !== 'connected') continue;
      const other = e.a === cur ? e.b : e.b === cur ? e.a : null;
      if (other && !reachable.has(other)) {
        reachable.add(other);
        queue.push(other);
      }
    }
  }
  const unreachable = nodes.filter((n) => n.kind === 'space' && !reachable.has(n.id)).map((n) => n.id);

  const spaces = nodes.filter((n) => n.kind === 'space').length;
  return {
    nodes,
    edges,
    unreachable,
    stats: {
      spaces,
      doors: nodes.filter((n) => n.kind === 'door').length,
      doorsPlaced,
      assets,
      adjacencies: adjacency.size,
      connections: edges.filter((e) => e.kind === 'connected').length,
      unreachable: unreachable.length,
    },
  };
}

/** Neighbours of a space node, grouped by relation, for a list next to the picture. */
export function neighboursOf(graph: SpaceGraph, id: string): { adjacent: string[]; connected: Array<{ to: string; via?: string }>; assets: string[] } {
  const adjacent: string[] = [];
  const connected: Array<{ to: string; via?: string }> = [];
  const assets: string[] = [];
  for (const e of graph.edges) {
    const other = e.a === id ? e.b : e.b === id ? e.a : null;
    if (!other) continue;
    if (e.kind === 'adjacent') adjacent.push(other);
    else if (e.kind === 'connected') connected.push({ to: other, ...(e.via ? { via: e.via } : {}) });
    else if (e.kind === 'contains' && e.a === id) assets.push(e.b);
  }
  return { adjacent, connected, assets };
}
