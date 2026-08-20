/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The space graph as geometry, for the 3D view.
 *
 * The same diagram the plan draws, built as meshes so it can float over the
 * building: a small cube per room and a bar per doorway, at head height above
 * the floor. Seeing it in 3D is what makes a graph across several storeys
 * believable — in plan every line lies in one plane and a stair connecting two
 * floors looks like a line to nowhere.
 *
 * # Coordinates
 * The view's points are in DRAWING space, which is the renderer's X and Z
 * (`planPick` pins that mapping). The vertical is the storey elevation plus a
 * fixed height, so the diagram hangs above the floor it describes rather than
 * inside it.
 *
 * # Why boxes and not lines
 * The overlay channel takes meshes. A line primitive would be thinner and
 * cheaper, and there is no line primitive here — so a bar it is, sized in
 * metres so it stays readable at building scale.
 *
 * # The ids MUST be synthetic
 * Clearing the overlay drops every id it put in the scene — but only those
 * that resolve to no real entity, a guard that exists so a leaked ghost can
 * never delete building geometry. Meshes stamped with a room's OWN express id
 * are therefore never removed, and the diagram stays in the scene after it has
 * been switched off. So the ids are counted off {@link GRAPH_ID_BASE} and the
 * room and door they stand for live in the view, not in the mesh.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { SpaceGraphView, GraphNodeKind } from './graphView.js';

/**
 * Where the diagram's synthetic ids start.
 *
 * Above `GHOST_ID_BASE` (0x70000000) so the space-sketch ghosts and this
 * diagram can never claim the same id, and far above any real express id so
 * the overlay's clear-up can actually remove them.
 */
export const GRAPH_ID_BASE = 0x71000000;

/** Metres. A node is a cube of this size, an edge a bar of this thickness. */
export const NODE_SIZE = 0.6;
export const EDGE_THICKNESS = 0.12;
/** Metres above the storey floor — head height, clear of furniture. */
export const GRAPH_HEIGHT = 2.2;

const NODE_COLOR: Record<GraphNodeKind, [number, number, number, number]> = {
  room: [0.055, 0.647, 0.914, 0.95],       // sky
  safe: [0.063, 0.725, 0.506, 0.95],       // emerald — the way out
  stranded: [0.961, 0.620, 0.043, 0.95],   // amber — nothing leads out
};
const EDGE_COLOR: [number, number, number, number] = [0.055, 0.647, 0.914, 0.9];
const EXTERIOR_EDGE_COLOR: [number, number, number, number] = [0.063, 0.725, 0.506, 0.9];

/** A box from its centre and half-extents, in renderer coordinates. */
function box(
  expressId: number,
  centre: readonly [number, number, number],
  half: readonly [number, number, number],
  color: [number, number, number, number],
  rotation = 0,
): MeshData {
  const [cx, cy, cz] = centre;
  const [hx, hy, hz] = half;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const corners: Array<[number, number, number]> = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * hx;
        const z = sz * hz;
        corners.push([cx + x * c - z * s, cy + sy * hy, cz + x * s + z * c]);
      }
    }
  }
  const positions = new Float32Array(corners.flat());
  // Index order for the eight corners laid out as (x, y, z) sign triples.
  const faces = [
    [0, 1, 3, 2], [4, 6, 7, 5],   // -X, +X
    [0, 4, 5, 1], [2, 3, 7, 6],   // -Y, +Y
    [0, 2, 6, 4], [1, 5, 7, 3],   // -Z, +Z
  ];
  const indices: number[] = [];
  for (const [a, b, cc, d] of faces) indices.push(a, b, cc, a, cc, d);
  const normals = new Float32Array(positions.length);
  // Flat-ish normals: the diagram is read by colour and position, not shading,
  // and a per-face normal set would triple the vertex count for nothing.
  for (let i = 0; i < corners.length; i += 1) {
    normals[i * 3 + 1] = 1;
  }
  return {
    expressId,
    ifcType: 'IfcAnnotation',
    positions,
    normals,
    indices: new Uint32Array(indices),
    color,
  };
}

export interface GraphMeshOptions {
  /** Storey floor level in renderer units (metres). */
  readonly elevation: number;
  /**
   * First synthetic id. Defaults to {@link GRAPH_ID_BASE}; pass a different
   * one only to keep two diagrams apart in the same scene.
   */
  readonly idBase?: number;
  /** Metres above the floor. */
  readonly height?: number;
  readonly nodeSize?: number;
  readonly edgeThickness?: number;
}

export function spaceGraphMeshes(
  view: SpaceGraphView,
  options: GraphMeshOptions,
): MeshData[] {
  const y = options.elevation + (options.height ?? GRAPH_HEIGHT);
  const nodeHalf = (options.nodeSize ?? NODE_SIZE) / 2;
  const edgeHalf = (options.edgeThickness ?? EDGE_THICKNESS) / 2;
  const out: MeshData[] = [];
  // Synthetic, never the room's or the door's own id — see the note above.
  let nextId = options.idBase ?? GRAPH_ID_BASE;

  for (const edge of view.edges) {
    const dx = edge.to.x - edge.from.x;
    const dz = edge.to.y - edge.from.y;
    const length = Math.hypot(dx, dz);
    // A doorway between two rooms whose centres coincide has no direction and
    // nothing to draw — it happens where a room was detected twice.
    if (length < 1e-6) continue;
    out.push(box(
      nextId += 1,
      [(edge.from.x + edge.to.x) / 2, y, (edge.from.y + edge.to.y) / 2],
      [length / 2, edgeHalf, edgeHalf],
      edge.exterior ? EXTERIOR_EDGE_COLOR : EDGE_COLOR,
      Math.atan2(dz, dx),
    ));
  }

  for (const node of view.nodes) {
    out.push(box(
      nextId += 1,
      [node.at.x, y, node.at.y],
      [nodeHalf, nodeHalf, nodeHalf],
      NODE_COLOR[node.kind],
    ));
  }

  return out;
}

export default spaceGraphMeshes;
