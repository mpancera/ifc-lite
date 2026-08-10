/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Recovering a plan outline from a triangulated surface.
 *
 * The parcel fit needs a ring; a model offers triangles. For an open surface —
 * a site plate, a terrain patch, a slab face — the ring is already in there:
 * the edges belonging to exactly ONE triangle are the surface's border, and
 * chaining them gives the outline back exactly. No hull, no alpha shape, no
 * tolerance to tune, and concave boundaries come out concave, which matters
 * because real parcels are not convex.
 *
 * ## Two properties of this codebase's meshes decide the approach
 *
 * - **Winding is unreliable** — `MeshData.indices` says so outright, because
 *   meshes are double-sided by design. So edges are counted as UNORDERED
 *   vertex pairs. An interior edge is used by two triangles whichever way each
 *   one is wound, which makes the count winding-independent. Anything relying
 *   on directed half-edges would silently mis-classify half the surface.
 * - **Vertices are not shared** — a tessellator commonly emits three fresh
 *   vertices per triangle, so neighbouring triangles never mention the same
 *   index and EVERY edge would look like a border. Welding by position first
 *   is not an optimisation here, it is what makes the method work at all.
 *
 * ## What this cannot do
 *
 * A closed solid has no boundary edges — every edge is shared — so a building
 * gives nothing and says so. That is the honest result: the plan outline of a
 * solid is its projected silhouette, a different computation, and returning a
 * hull instead would hand the fit a shape that is not the building's footprint.
 */

import type { Point2 } from './fit-outline';

export interface TriangleSoup {
  /** `[x,y,z, …]` in viewer space (Y-up), as `MeshData.positions`. */
  positions: ArrayLike<number>;
  /** Three indices per triangle, as `MeshData.indices`. */
  indices: ArrayLike<number>;
}

export interface ExtractOutlineOptions {
  /**
   * Welding grid in model units. Vertices landing in the same cell become one.
   *
   * 0.1 mm by default: coarse enough to close the gaps float32 positions leave
   * between what should be the same corner, fine enough that two genuinely
   * distinct points never merge. Raise it for a mesh that still comes out
   * unclosed, lower it only for a model authored in a huge unit.
   */
  weldTolerance?: number;
}

export type ExtractOutlineResult =
  | {
    ok: true;
    /** The largest closed ring, in IFC plan coordinates (X east, Y north). */
    ring: Point2[];
    /** Enclosed area of `ring` in squared model units — the selection reason. */
    area: number;
    /** How many closed rings were found; more than one means holes or parts. */
    ringCount: number;
  }
  | { ok: false; reason: ExtractOutlineFailure };

export type ExtractOutlineFailure =
  /** Not enough triangles to have a border. */
  | 'empty'
  /** Every edge is shared: a closed solid, whose outline is a silhouette. */
  | 'no-boundary'
  /** Border edges found, but none of them close into a loop. */
  | 'no-closed-ring';

const DEFAULT_WELD_TOLERANCE = 1e-4;

/**
 * Viewer space is Y-up and IFC is Z-up, related by `(vx,vy,vz) → (vx,-vz,vy)`.
 * The plan is therefore the viewer's X and negated Z; the viewer's Y is the
 * height and is dropped.
 */
function toPlan(x: number, z: number): Point2 {
  return { x, y: -z };
}

/** Signed area of a closed ring (shoelace), about its first vertex to keep the
 *  arithmetic well conditioned. */
export function ringSignedArea(ring: readonly Point2[]): number {
  if (ring.length < 3) return 0;
  const origin = ring[0];
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    twice += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
  }
  return twice / 2;
}

/**
 * Pull the plan outline out of a triangle soup.
 *
 * Returns the largest closed ring by enclosed area. With holes or several
 * parts, that is the outer boundary — the one a parcel fit wants.
 */
export function extractPlanOutline(
  mesh: TriangleSoup,
  options: ExtractOutlineOptions = {},
): ExtractOutlineResult {
  const tolerance = options.weldTolerance ?? DEFAULT_WELD_TOLERANCE;
  const triangleCount = Math.floor(mesh.indices.length / 3);
  if (triangleCount === 0) return { ok: false, reason: 'empty' };

  // ── Weld by position ────────────────────────────────────────────────────
  const inverse = 1 / tolerance;
  const welded = new Map<string, number>();
  const nodes: Array<{ x: number; y: number; z: number }> = [];
  const nodeOf = new Map<number, number>();

  const resolve = (vertexIndex: number): number => {
    const cached = nodeOf.get(vertexIndex);
    if (cached !== undefined) return cached;
    const base = vertexIndex * 3;
    const x = mesh.positions[base];
    const y = mesh.positions[base + 1];
    const z = mesh.positions[base + 2];
    const key = `${Math.round(x * inverse)},${Math.round(y * inverse)},${Math.round(z * inverse)}`;
    let node = welded.get(key);
    if (node === undefined) {
      node = nodes.length;
      nodes.push({ x, y, z });
      welded.set(key, node);
    }
    nodeOf.set(vertexIndex, node);
    return node;
  };

  // ── Count each undirected edge ──────────────────────────────────────────
  const edgeUse = new Map<string, { a: number; b: number; count: number }>();
  const note = (a: number, b: number): void => {
    if (a === b) return; // collapsed by welding — not an edge
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    const key = `${low}:${high}`;
    const seen = edgeUse.get(key);
    if (seen) seen.count += 1;
    else edgeUse.set(key, { a: low, b: high, count: 1 });
  };

  for (let t = 0; t < triangleCount; t += 1) {
    const i = resolve(mesh.indices[t * 3]);
    const j = resolve(mesh.indices[t * 3 + 1]);
    const k = resolve(mesh.indices[t * 3 + 2]);
    note(i, j);
    note(j, k);
    note(k, i);
  }

  // ── Chain the border ────────────────────────────────────────────────────
  const adjacency = new Map<number, number[]>();
  let borderEdges = 0;
  for (const edge of edgeUse.values()) {
    if (edge.count !== 1) continue;
    borderEdges += 1;
    const fromA = adjacency.get(edge.a);
    if (fromA) fromA.push(edge.b); else adjacency.set(edge.a, [edge.b]);
    const fromB = adjacency.get(edge.b);
    if (fromB) fromB.push(edge.a); else adjacency.set(edge.b, [edge.a]);
  }
  if (borderEdges === 0) return { ok: false, reason: 'no-boundary' };

  const used = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const rings: Point2[][] = [];

  for (const start of adjacency.keys()) {
    // Every edge belongs to at most one ring, so a start whose edges are all
    // spent has already been walked.
    const startNeighbours = adjacency.get(start) ?? [];
    if (startNeighbours.every(next => used.has(edgeKey(start, next)))) continue;

    const chain: number[] = [start];
    let current = start;
    let closed = false;

    // A pinch point can carry more than two border edges; taking the first
    // unused one is a choice, and a wrong choice only costs this ring, which
    // is then dropped as unclosed rather than reported as a shape.
    while (chain.length <= borderEdges + 1) {
      const neighbours = adjacency.get(current);
      if (!neighbours) break;
      const next = neighbours.find(candidate => !used.has(edgeKey(current, candidate)));
      if (next === undefined) break;
      used.add(edgeKey(current, next));
      if (next === start) { closed = true; break; }
      chain.push(next);
      current = next;
    }

    if (closed && chain.length >= 3) {
      rings.push(chain.map((node) => toPlan(nodes[node].x, nodes[node].z)));
    }
  }

  if (rings.length === 0) return { ok: false, reason: 'no-closed-ring' };

  let best = rings[0];
  let bestArea = Math.abs(ringSignedArea(best));
  for (const ring of rings.slice(1)) {
    const area = Math.abs(ringSignedArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }

  if (bestArea <= 0) return { ok: false, reason: 'no-closed-ring' };
  return { ok: true, ring: best, area: bestArea, ringCount: rings.length };
}
