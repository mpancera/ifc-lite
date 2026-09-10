/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A model's rooms, grouped by the storey they stand on, in the model's own
 * frame.
 *
 * # Read from the meshes
 *
 * A room's position could be read from its placement chain or from its
 * profile, but the RENDERED mesh is the one representation that exists for
 * both kinds of room this has to see: the ones parsed from a file and the ones
 * baked in this session, which have no file to be read out of yet. One source,
 * so a room that was just created is not invisible to the very step that is
 * supposed to name it.
 *
 * A mesh names its element by the GLOBAL id a federation gives it, while the
 * data store and the spatial structure speak the model's own local ids. The
 * offset is undone here, once, so everything downstream — the structure lookup,
 * the name read, the attribute written — works in one id space.
 *
 * # Grouped by storey NAME, via the SPATIAL TREE
 *
 * The storey a room belongs to is read from the spatial structure, not from
 * how high its floor is drawn. Height would be the obvious measure and it is
 * the wrong one twice over: elevations do not survive a remodel (the same
 * storey sits at 7.47 m in one file and 8.23 m in the other), and once two
 * models are federated their geometry no longer shares a vertical datum at all
 * — a model without georeferencing, placed beside one with it, lands 381 m
 * below its own storeys. The structure is unaffected by either.
 *
 * Specifically the spatial TREE, not the containment map: a space is itself
 * part of the spatial structure, so it is AGGREGATED into its storey rather
 * than contained in it, and a map of contained elements does not list it. The
 * tree holds both kinds of room — parsed and created in this session.
 *
 * Names, not elevations, then pair the two models' storeys: "U1", "00", "01"
 * are what the architect keeps stable, because they are what the drawings are
 * titled with. Only the PLAN position comes from the geometry, and the plan
 * offset between the models is solved for, so it needs no shared datum either.
 */

import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';

export type Pt = [number, number];

export interface ReadRoom {
  id: number;
  name: string | null;
  longName: string | null;
  centre: Pt;
}

/** The part of a parsed `SpatialHierarchy` this needs. */
export interface SpatialTree {
  project?: { expressId: number; name?: string; children?: readonly SpatialTree['project'][] };
  /** Keyed by storey id — used to tell which nodes of the tree ARE storeys,
   *  without this module having to know the type enum. */
  byStorey?: ReadonlyMap<number, unknown>;
  /** Fallback for anything the tree does not carry. */
  elementToStorey?: ReadonlyMap<number, number>;
}

/**
 * Every element's storey, as `id → name`, taken from the spatial tree.
 *
 * A node counts as a storey when the hierarchy lists it in `byStorey`; every
 * node below it belongs to it. Where the tree says nothing, the containment
 * map is asked — between them they cover the spaces of a parsed file and the
 * ones baked in this session.
 */
export function storeysOfElements(h: SpatialTree | undefined): Map<number, string> {
  const out = new Map<number, string>();
  if (!h) return out;
  const names = new Map<number, string>();
  const walk = (node: NonNullable<SpatialTree['project']>, storey: string | null) => {
    const here = h.byStorey?.has(node.expressId) ? node.name || `#${node.expressId}` : storey;
    if (h.byStorey?.has(node.expressId) && node.name) names.set(node.expressId, node.name);
    if (here && !h.byStorey?.has(node.expressId)) out.set(node.expressId, here);
    for (const child of node.children ?? []) if (child) walk(child, here);
  };
  if (h.project) walk(h.project, null);
  for (const [el, st] of h.elementToStorey ?? []) {
    const name = names.get(st);
    if (name && !out.has(el)) out.set(el, name);
  }
  return out;
}

export interface ReadRoomsInput {
  meshes: readonly MeshData[];
  coord: CoordinateInfo | undefined;
  /** What a federation added to this model's ids to keep them unique. */
  idOffset?: number;
  /** The name of the storey a space belongs to — what the two models are
   *  paired on. `null` when the structure does not place it. */
  storeyOf: (expressId: number) => string | null;
  /** `Name` / `LongName` for a space, or `null` when it has none. */
  nameOf: (expressId: number) => string | null;
  longNameOf: (expressId: number) => string | null;
}

/**
 * Rooms keyed by storey name. A storey with no rooms is absent rather than
 * empty, so a caller pairing two models sees only storeys both actually have.
 */
export function roomsByStorey(input: ReadRoomsInput): Map<string, ReadRoom[]> {
  const shift = input.coord?.originShift ?? { x: 0, y: 0, z: 0 };
  const idOffset = input.idOffset ?? 0;

  // Accumulate each space's plan centroid.
  const acc = new Map<number, { sx: number; sy: number; n: number }>();
  for (const mesh of input.meshes) {
    if (mesh.ifcType !== 'IfcSpace') continue;
    const o = mesh.origin ?? [0, 0, 0];
    const p = mesh.positions;
    const id = mesh.expressId - idOffset;
    let e = acc.get(id);
    if (!e) {
      e = { sx: 0, sy: 0, n: 0 };
      acc.set(id, e);
    }
    for (let i = 0; i + 2 < p.length; i += 3) {
      // Render is Y-up; the model's own frame is X / -Z with the shift undone.
      e.sx += o[0] + p[i] + shift.x;
      e.sy += -(o[2] + p[i + 2] + shift.z);
      e.n += 1;
    }
  }

  const byStorey = new Map<string, ReadRoom[]>();
  for (const [id, e] of acc) {
    if (e.n === 0) continue;
    const name = input.storeyOf(id);
    if (!name) continue;
    const list = byStorey.get(name) ?? [];
    list.push({
      id,
      name: input.nameOf(id),
      longName: input.longNameOf(id),
      centre: [e.sx / e.n, e.sy / e.n],
    });
    byStorey.set(name, list);
  }
  return byStorey;
}
