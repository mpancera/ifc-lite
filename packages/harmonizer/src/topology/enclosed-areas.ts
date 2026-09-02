/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage D, topology: rooms from the stroke network.
 *
 * The pipeline is the one the viewer's room finder uses for wall axes —
 * snap corners, split at crossings, walk the half-edge graph, keep the
 * faces that wind counter-clockwise — with two changes that make it work
 * on a drawing instead of a few dozen axes:
 *
 * 1. Every neighbour search goes through a {@link SegmentGrid}. The old
 *    finder compared every pair; a full storey with five thousand strokes
 *    never finished. Here each stroke meets only the strokes in its cells.
 * 2. It reports what it did NOT keep. The narrow faces (wall cavities, since
 *    a drawing shows both faces of a wall), the small ones, and the dangling
 *    ends where a loop failed to close. A room finder that only shows rooms
 *    hides exactly the places a person needs to look at.
 */

import { area, normaliseLoop, regionWidth, signedArea } from '../interpret/geometry.js';
import type { Point2 } from '../types.js';
import { SegmentGrid, cellSizeFor, type SegmentLike } from './spatial-hash.js';

export interface TopologyOptions {
  /** Endpoints closer than this are one corner. Default 0.05 m. */
  snapTolerance?: number;
  /** Faces smaller than this are not rooms. Default 1 m². */
  minAreaM2?: number;
  /** Faces narrower than 2·A/P are wall cavities. Default 0.35 m. */
  minWidthM?: number;
  /** Strokes shorter than this are hatching and are dropped before anything else. Default 0.03 m. */
  minStrokeM?: number;
  /** Stop after this many strokes to keep the browser responsive. Default 60 000. */
  maxSegments?: number;
}

export interface Face {
  /** Counter-clockwise outline without a repeated closing point. */
  outline: Point2[];
  area: number;
  /** 2·A/P, the "width" of the region. */
  width: number;
}

export interface RejectedFace extends Face {
  reason: 'narrow' | 'small';
}

export interface TopologyStats {
  inputSegments: number;
  droppedShort: number;
  truncated: boolean;
  vertices: number;
  edgesAfterSplit: number;
  faces: number;
  outerFaces: number;
  cellSize: number;
  timeMs: number;
}

/** One undirected edge of the planar graph: a piece of wall (or divider) between two corners. */
export interface PlanarEdge {
  a: number;
  b: number;
  kind: 'wall' | 'divider';
  /** Index into `PlanarGraph.faces` on the left when walking a→b, or -1. */
  faceLeft: number;
  /** Index into `PlanarGraph.faces` on the right when walking a→b, or -1. */
  faceRight: number;
}

export interface PlanarFace extends Face {
  kind: 'room' | 'narrow' | 'small' | 'outer';
}

/**
 * Level 1 of a space graph: corners as nodes, walls as edges, and the faces
 * each edge borders. Everything else (adjacency, connectivity) reads off it.
 */
export interface PlanarGraph {
  vertices: Point2[];
  edges: PlanarEdge[];
  faces: PlanarFace[];
}

export interface TopologyResult {
  faces: Face[];
  rejected: RejectedFace[];
  /** Ends of strokes that meet nothing: where a loop leaks. */
  dangling: Point2[];
  /** The planar graph the faces came from. */
  graph: PlanarGraph;
  stats: TopologyStats;
}

const EPS = 1e-9;

interface Vertex {
  x: number;
  y: number;
}

interface HalfEdge {
  origin: number;
  dest: number;
  twin: number;
  angle: number;
  face: number;
  next: number;
}

function lineIntersection(a1: Point2, b1: Point2, a2: Point2, b2: Point2): Point2 | null {
  const d1x = b1.x - a1.x;
  const d1y = b1.y - a1.y;
  const d2x = b2.x - a2.x;
  const d2y = b2.y - a2.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null;
  const t = ((a2.x - a1.x) * d2y - (a2.y - a1.y) * d2x) / denom;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

function closestOnSegment(q: Point2, a: Point2, b: Point2): { point: Point2; t: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return null;
  let t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { point: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

function crossing(p1: Point2, p2: Point2, p3: Point2, p4: Point2): { point: Point2; t: number; u: number } | null {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < EPS) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / denom;
  const tol = 1e-7;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  if ((t < tol || t > 1 - tol) && (u < tol || u > 1 - tol)) return null;
  return { point: { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }, t, u };
}

export function findEnclosedAreas(input: readonly SegmentLike[], options: TopologyOptions = {}): TopologyResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const snap = options.snapTolerance ?? 0.05;
  const minArea = options.minAreaM2 ?? 1;
  const minWidth = options.minWidthM ?? 0.35;
  const minStroke = options.minStrokeM ?? 0.03;
  const maxSegments = options.maxSegments ?? 60000;

  // 0. Hatching out, cap in.
  let droppedShort = 0;
  const segs: SegmentLike[] = [];
  for (const s of input) {
    if (Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < minStroke) {
      droppedShort += 1;
      continue;
    }
    segs.push({ a: { x: s.a.x, y: s.a.y }, b: { x: s.b.x, y: s.b.y }, kind: s.kind ?? 'wall' });
    if (segs.length >= maxSegments) break;
  }
  const truncated = input.length - droppedShort > segs.length;
  const stats: TopologyStats = {
    inputSegments: input.length,
    droppedShort,
    truncated,
    vertices: 0,
    edgesAfterSplit: 0,
    faces: 0,
    outerFaces: 0,
    cellSize: 0,
    timeMs: 0,
  };
  const finish = (faces: Face[], rejected: RejectedFace[], dangling: Point2[], graph: PlanarGraph = { vertices: [], edges: [], faces: [] }): TopologyResult => {
    stats.timeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    return { faces, rejected, dangling, graph, stats };
  };
  if (segs.length < 3) return finish([], [], []);

  const cellSize = cellSizeFor(segs, snap);
  stats.cellSize = cellSize;
  const tol2 = snap * snap;

  // 1. Pull stroke ends onto the true corner with the nearest crossing stroke.
  {
    const grid = new SegmentGrid(segs, cellSize);
    const scratch: number[] = [];
    const snapEnd = (e: Point2, i: number): Point2 => {
      let best: Point2 | null = null;
      let bestD2 = tol2;
      scratch.length = 0;
      for (const j of grid.queryPoint(e, snap, scratch)) {
        if (j === i) continue;
        const p = lineIntersection(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
        if (!p) continue;
        const host = closestOnSegment(p, segs[j].a, segs[j].b);
        if (!host || (host.point.x - p.x) ** 2 + (host.point.y - p.y) ** 2 > tol2) continue;
        const d2 = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = p;
        }
      }
      return best ?? e;
    };
    const snapped = segs.map((s, i) => ({ a: snapEnd(s.a, i), b: snapEnd(s.b, i), kind: s.kind }));
    for (let i = 0; i < segs.length; i++) segs[i] = snapped[i];
  }

  // 2. Snap endpoints into vertices (grid keyed on the snap distance).
  const vertices: Vertex[] = [];
  const vgrid = new Map<string, number[]>();
  const vcell = Math.max(snap, EPS);
  const lookup = (p: Point2): number => {
    const cx = Math.floor(p.x / vcell);
    const cy = Math.floor(p.y / vcell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = vgrid.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const id of bucket) {
          const v = vertices[id];
          if ((v.x - p.x) ** 2 + (v.y - p.y) ** 2 <= tol2) return id;
        }
      }
    }
    const id = vertices.length;
    vertices.push({ x: p.x, y: p.y });
    const k = `${cx},${cy}`;
    const bucket = vgrid.get(k);
    if (bucket) bucket.push(id);
    else vgrid.set(k, [id]);
    return id;
  };
  const indexed: Array<[number, number]> = [];
  const indexedKind: Array<'wall' | 'divider'> = [];
  for (const s of segs) {
    const a = lookup(s.a);
    const b = lookup(s.b);
    if (a !== b) {
      indexed.push([a, b]);
      indexedKind.push(s.kind ?? 'wall');
    }
  }

  // 3. Splits: T-junctions (an endpoint on another stroke's interior) and
  //    crossings, both collected per host in one pass, applied in one pass.
  const geom: SegmentLike[] = indexed.map(([a, b]) => ({ a: vertices[a], b: vertices[b] }));
  const grid = new SegmentGrid(geom, cellSize);
  const splits: Array<Array<{ t: number; v: number }>> = indexed.map(([a, b]) => [
    { t: 0, v: a },
    { t: 1, v: b },
  ]);
  const scratch: number[] = [];
  const endpointDone = new Set<number>();
  for (let i = 0; i < indexed.length; i++) {
    const [ai, bi] = indexed[i];
    for (const vid of [ai, bi]) {
      if (endpointDone.has(vid)) continue;
      endpointDone.add(vid);
      const p = vertices[vid];
      scratch.length = 0;
      for (const j of grid.queryPoint(p, snap, scratch)) {
        const [aj, bj] = indexed[j];
        if (aj === vid || bj === vid) continue;
        const proj = closestOnSegment(p, vertices[aj], vertices[bj]);
        if (!proj) continue;
        if ((proj.point.x - p.x) ** 2 + (proj.point.y - p.y) ** 2 > tol2) continue;
        if (proj.t < 1e-6 || proj.t > 1 - 1e-6) continue;
        splits[j].push({ t: proj.t, v: vid });
      }
    }
    const s = geom[i];
    scratch.length = 0;
    const minX = Math.min(s.a.x, s.b.x);
    const maxX = Math.max(s.a.x, s.b.x);
    const minY = Math.min(s.a.y, s.b.y);
    const maxY = Math.max(s.a.y, s.b.y);
    for (const j of grid.queryBox(minX, minY, maxX, maxY, scratch)) {
      if (j <= i) continue;
      const [aj, bj] = indexed[j];
      if (ai === aj || ai === bj || bi === aj || bi === bj) continue;
      const ip = crossing(vertices[ai], vertices[bi], vertices[aj], vertices[bj]);
      if (!ip) continue;
      const v = lookup(ip.point);
      if (v !== ai && v !== bi) splits[i].push({ t: ip.t, v });
      if (v !== aj && v !== bj) splits[j].push({ t: ip.u, v });
    }
  }

  const undirected = new Map<string, number>();
  const edgesIn: Array<[number, number]> = [];
  const edgeKind: Array<'wall' | 'divider'> = [];
  splits.forEach((list, host) => {
    list.sort((p, q) => p.t - q.t);
    for (let k = 0; k < list.length - 1; k++) {
      const a = list[k].v;
      const b = list[k + 1].v;
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const existing = undirected.get(key);
      if (existing !== undefined) {
        // Drawn twice: a wall beats a divider.
        if (indexedKind[host] === 'wall') edgeKind[existing] = 'wall';
        continue;
      }
      undirected.set(key, edgesIn.length);
      edgesIn.push([a, b]);
      edgeKind.push(indexedKind[host]);
    }
  });
  stats.vertices = vertices.length;
  stats.edgesAfterSplit = edgesIn.length;
  if (edgesIn.length < 3) return finish([], [], []);

  // 4. Half-edge graph.
  const edges: HalfEdge[] = [];
  const fans: number[][] = vertices.map(() => []);
  for (const [a, b] of edgesIn) {
    const dx = vertices[b].x - vertices[a].x;
    const dy = vertices[b].y - vertices[a].y;
    const fwd = edges.length;
    const bwd = fwd + 1;
    edges.push({ origin: a, dest: b, twin: bwd, angle: Math.atan2(dy, dx), face: -1, next: -1 });
    edges.push({ origin: b, dest: a, twin: fwd, angle: Math.atan2(-dy, -dx), face: -1, next: -1 });
    fans[a].push(fwd);
    fans[b].push(bwd);
  }
  for (const fan of fans) fan.sort((p, q) => edges[p].angle - edges[q].angle);
  const dangling: Point2[] = [];
  fans.forEach((fan, vid) => {
    if (fan.length === 1) dangling.push({ x: vertices[vid].x, y: vertices[vid].y });
  });
  for (let e = 0; e < edges.length; e++) {
    const fan = fans[edges[e].dest];
    const idx = fan.indexOf(edges[e].twin);
    if (idx < 0) continue;
    edges[e].next = fan[(idx - 1 + fan.length) % fan.length];
  }

  // 5. Faces by the leftmost-turn walk.
  const cycles: number[][] = [];
  for (let e = 0; e < edges.length; e++) {
    if (edges[e].face !== -1) continue;
    const cycle: number[] = [];
    let cur = e;
    let guard = 0;
    while (cur !== -1 && edges[cur].face === -1 && guard++ < edges.length + 4) {
      edges[cur].face = cycles.length;
      cycle.push(cur);
      cur = edges[cur].next;
      if (cur === e) break;
    }
    cycles.push(cycle);
  }
  stats.faces = cycles.length;

  // 6. Keep the counter-clockwise faces that are rooms; report the rest.
  //    Every cycle becomes a planar face so the graph can name what borders
  //    an edge, rooms and non-rooms alike.
  const faces: Face[] = [];
  const rejected: RejectedFace[] = [];
  const planarFaces: PlanarFace[] = [];
  const faceOfCycle: number[] = cycles.map(() => -1);
  cycles.forEach((cycle, ci) => {
    const outline = normaliseLoop(cycle.map((eid) => ({ x: vertices[edges[eid].origin].x, y: vertices[edges[eid].origin].y })));
    if (outline.length < 3) return;
    const a = area(outline);
    const w = regionWidth(outline);
    let kind: PlanarFace['kind'];
    if (signedArea(outline) <= 0) {
      stats.outerFaces += 1;
      kind = 'outer';
    } else if (a < minArea) {
      kind = 'small';
      rejected.push({ outline, area: a, width: w, reason: 'small' });
    } else if (w < minWidth) {
      kind = 'narrow';
      rejected.push({ outline, area: a, width: w, reason: 'narrow' });
    } else {
      kind = 'room';
      faces.push({ outline, area: a, width: w });
    }
    faceOfCycle[ci] = planarFaces.length;
    planarFaces.push({ outline, area: a, width: w, kind });
  });
  faces.sort((p, q) => q.area - p.area);

  const planarEdges: PlanarEdge[] = edgesIn.map(([a, b], i) => {
    const fwd = edges[2 * i];
    const bwd = edges[2 * i + 1];
    return {
      a,
      b,
      kind: edgeKind[i],
      faceLeft: fwd.face >= 0 ? faceOfCycle[fwd.face] : -1,
      faceRight: bwd.face >= 0 ? faceOfCycle[bwd.face] : -1,
    };
  });
  return finish(faces, rejected, dangling, { vertices: vertices.map((v) => ({ x: v.x, y: v.y })), edges: planarEdges, faces: planarFaces });
}
