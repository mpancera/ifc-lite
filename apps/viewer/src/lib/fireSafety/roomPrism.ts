/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A room's outline and height, from its mesh.
 *
 * What a derived compartment body is made of. The mesh is what the viewer
 * actually has for every room, whatever the file modelled it as — an extruded
 * profile, a brep, a clipped solid — so taking the outline from it works where
 * reading `IfcExtrudedAreaSolid.SweptArea` would only work for the easy case.
 *
 * # Why the boundary and not the convex hull
 *
 * An L-shaped room is ordinary, and its hull includes the corner it does not
 * occupy. For a compartment that corner is another compartment, so the hull
 * would produce two bodies claiming the same floor — and the claim would be
 * invisible until somebody measured it.
 *
 * # One ring, the largest
 *
 * A room with a column in it has a hole, and a mesh that happens to split into
 * two islands has two outer rings. Neither is worth carrying here: the profile
 * a compartment body extrudes is the room's extent, a column inside it changes
 * nothing about which compartment the floor belongs to, and a second island is
 * a modelling accident. Largest by area, and the count is reported so a caller
 * can say what it dropped.
 */

import { boundaryEdges, type OutlineSegment } from '@/lib/zoneOutline/zoneOutline';

/** A mesh as the geometry result carries it. */
export interface PrismMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Local-frame origin; world = origin + position. Absent means world-space. */
  readonly origin?: readonly [number, number, number];
}

export interface RoomPrism {
  /**
   * The room's outline as a closed ring, in RENDER-frame X/Z metres — the
   * plan-view axes. Not yet IFC world: only the caller knows which model's
   * shifts to undo.
   */
  readonly ring: Array<[number, number]>;
  /** Render-frame Y of the floor. */
  readonly baseY: number;
  /** Floor to ceiling, metres. */
  readonly height: number;
  /** Rings the mesh produced, of which `ring` is the largest. */
  readonly rings: number;
}

/** Quantised, so two coordinates that should be one point are one key. */
const GRID = 1e4;
const key = (x: number, y: number) => `${Math.round(x * GRID)},${Math.round(y * GRID)}`;

function ringArea(ring: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * Chain unshared edges into closed rings.
 *
 * Each edge is walked once, from whichever end it is reached: the segments
 * come back from `boundaryEdges` in map order with no consistent winding, so a
 * walk that only followed `a → b` would stop at the first edge stored
 * backwards and return a ring with one segment in it.
 */
export function chainRings(segments: readonly OutlineSegment[]): Array<Array<[number, number]>> {
  const byPoint = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    for (const point of [segment.a, segment.b]) {
      const k = key(point.x, point.y);
      const list = byPoint.get(k);
      if (list) list.push(index);
      else byPoint.set(k, [index]);
    }
  });

  const used = new Set<number>();
  const rings: Array<Array<[number, number]>> = [];

  for (let start = 0; start < segments.length; start += 1) {
    if (used.has(start)) continue;
    used.add(start);
    const first = segments[start].a;
    let cursor = segments[start].b;
    const ring: Array<[number, number]> = [[first.x, first.y]];

    // Bounded by the edge count: every step consumes one, so a mesh whose
    // edges form a figure of eight terminates instead of spinning.
    for (let step = 0; step < segments.length; step += 1) {
      ring.push([cursor.x, cursor.y]);
      if (key(cursor.x, cursor.y) === key(first.x, first.y)) break;
      const next = (byPoint.get(key(cursor.x, cursor.y)) ?? []).find((i) => !used.has(i));
      if (next === undefined) break;
      used.add(next);
      const segment = segments[next];
      cursor = key(segment.a.x, segment.a.y) === key(cursor.x, cursor.y) ? segment.b : segment.a;
    }

    // The closing repeat is dropped: a profile is a ring, and the emitter
    // closes it itself.
    if (ring.length > 1 && key(ring[0][0], ring[0][1]) === key(ring[ring.length - 1][0], ring[ring.length - 1][1])) {
      ring.pop();
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * The plan outline and vertical extent of one room.
 *
 * `null` when the meshes carry no usable area — an empty mesh, or one so
 * degenerate that every triangle collapses edge-on. A room like that has no
 * business becoming a prism, and saying so beats emitting a sliver.
 */
export function roomPrism(meshes: readonly PrismMesh[]): RoomPrism | null {
  const flat: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;

  for (const mesh of meshes) {
    const { positions, indices } = mesh;
    const ox = mesh.origin?.[0] ?? 0;
    const oy = mesh.origin?.[1] ?? 0;
    const oz = mesh.origin?.[2] ?? 0;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = indices[i] * 3;
      const b = indices[i + 1] * 3;
      const c = indices[i + 2] * 3;
      // The plan axes are X and Z; Y is the height the room is extruded along.
      flat.push(
        positions[a] + ox, positions[a + 2] + oz,
        positions[b] + ox, positions[b + 2] + oz,
        positions[c] + ox, positions[c + 2] + oz,
      );
      for (const v of [a, b, c]) {
        const y = positions[v + 1] + oy;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (flat.length === 0 || !Number.isFinite(minY)) return null;

  const rings = chainRings(boundaryEdges(new Float32Array(flat)));
  if (rings.length === 0) return null;

  let best = rings[0];
  let bestArea = ringArea(best);
  for (const ring of rings.slice(1)) {
    const area = ringArea(ring);
    if (area > bestArea) {
      best = ring;
      bestArea = area;
    }
  }
  if (!(bestArea > 0)) return null;

  return {
    ring: best,
    baseY: minY,
    // A flat mesh — a room modelled as a slab with no height — would extrude
    // to nothing and produce a solid no reader can use. The caller is told by
    // the height being zero rather than by an exception out of the builder.
    height: maxY - minY,
    rings: rings.length,
  };
}
