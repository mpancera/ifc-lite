/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';
import { roomsByStorey, storeysOfElements, type SpatialTree } from './read-rooms.js';

/** A box room: plan x0..x1 by y0..y1 (model frame), floor at `floor`. */
function room(expressId: number, x0: number, x1: number, y0: number, y1: number, floor: number): MeshData {
  const pts: number[] = [];
  // Render frame: x = model x, y = height, z = -model y.
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][]) {
    pts.push(x, floor, -y);
    pts.push(x, floor + 2.5, -y);
  }
  return { expressId, ifcType: 'IfcSpace', positions: new Float32Array(pts) } as unknown as MeshData;
}

const STOREY_NAMES: Record<number, string> = { 1: 'U1', 2: '00', 3: '01' };

const read = (
  meshes: MeshData[],
  on: Record<number, number>,
  names: Record<number, string> = {},
  idOffset = 0,
) =>
  roomsByStorey({
    meshes,
    coord: undefined as unknown as CoordinateInfo,
    idOffset,
    storeyOf: (id) => STOREY_NAMES[on[id]] ?? null,
    nameOf: (id) => names[id] ?? null,
    longNameOf: () => null,
  });

/** A project → building → storeys → spaces tree, the shape a parser builds. */
const tree = (storeys: { id: number; name: string; spaces: number[] }[]): SpatialTree => ({
  project: {
    expressId: 1,
    name: 'P',
    children: [{
      expressId: 2,
      name: 'B',
      children: storeys.map((s) => ({
        expressId: s.id,
        name: s.name,
        children: s.spaces.map((id) => ({ expressId: id, name: `space ${id}`, children: [] })),
      })),
    }],
  },
  byStorey: new Map(storeys.map((s) => [s.id, s.spaces])),
});

describe('storeysOfElements', () => {
  it('reads a space off the storey it is aggregated into', () => {
    // A space is part of the spatial structure, so it is a CHILD of its storey
    // rather than one of its contained elements — a containment map lists it
    // nowhere, and reading only that map found no rooms at all in a real file.
    const out = storeysOfElements(tree([{ id: 2, name: '00', spaces: [10, 11] }]));
    assert.equal(out.get(10), '00');
    assert.equal(out.get(11), '00');
    assert.equal(out.has(2), false, 'the storey is not its own element');
  });

  it('reaches a space nested deeper than one level', () => {
    const t = tree([{ id: 2, name: '00', spaces: [10] }]);
    t.project!.children![0]!.children![0]!.children![0]!.children = [
      { expressId: 99, name: 'a niche', children: [] },
    ];
    assert.equal(storeysOfElements(t).get(99), '00');
  });

  it('falls back to containment for an element the tree does not carry', () => {
    const t = tree([{ id: 2, name: '00', spaces: [10] }]);
    t.elementToStorey = new Map([[77, 2]]);
    assert.equal(storeysOfElements(t).get(77), '00');
  });

  it('has nothing to say about a model with no hierarchy', () => {
    assert.equal(storeysOfElements(undefined).size, 0);
  });
});

describe('roomsByStorey', () => {
  it('puts a room on the storey the structure places it on, with its plan centre', () => {
    const out = read([room(10, 0, 4, 0, 3, 4.42)], { 10: 2 }, { 10: '0.01' });
    assert.deepEqual([...out.keys()], ['00']);
    const [r] = out.get('00')!;
    assert.equal(r.id, 10);
    assert.equal(r.name, '0.01');
    assert.ok(Math.abs(r.centre[0] - 2) < 1e-6, `x ${r.centre[0]}`);
    assert.ok(Math.abs(r.centre[1] - 1.5) < 1e-6, `y ${r.centre[1]}`);
  });

  it('ignores how high the room is drawn', () => {
    // The two models this compares are federated: one is georeferenced and one
    // is not, so the same storey's rooms are drawn 381 m apart. Containment is
    // the only thing that still agrees, and it must be the only thing consulted.
    const out = read([room(11, 0, 4, 0, 3, -376.88)], { 11: 2 });
    assert.deepEqual([...out.keys()], ['00'], 'a room 380 m down is still its storey’s room');
  });

  it('keeps storeys apart', () => {
    const out = read(
      [room(20, 0, 4, 0, 3, 0), room(21, 0, 4, 0, 3, 4.42), room(22, 0, 4, 0, 3, 8.23)],
      { 20: 1, 21: 2, 22: 3 },
    );
    assert.deepEqual([...out.keys()].sort(), ['00', '01', 'U1']);
    for (const key of ['U1', '00', '01']) assert.equal(out.get(key)!.length, 1);
  });

  it('reports no storey rather than an empty one', () => {
    const out = read([room(30, 0, 4, 0, 3, 0)], { 30: 1 });
    assert.equal(out.has('00'), false, 'a storey with no rooms has nothing to pair');
  });

  it('leaves out a room the structure does not place', () => {
    // Better absent than guessed: a room placed on the wrong storey would take
    // a number from a room it has never met.
    assert.equal(read([room(31, 0, 4, 0, 3, 0)], {}).size, 0);
  });

  it('undoes the id offset a federation gave the second model', () => {
    // The mesh calls the room 1_000_010; the file, the structure and every
    // attribute written back call it 10. Reading the mesh id as-is finds no
    // storey and no name — a whole model looks empty for no visible reason.
    const out = read([room(1_000_010, 0, 4, 0, 3, 0)], { 10: 2 }, { 10: '0.01' }, 1_000_000);
    assert.deepEqual([...out.keys()], ['00']);
    assert.equal(out.get('00')![0].id, 10, 'and reports the id the model itself uses');
    assert.equal(out.get('00')![0].name, '0.01');
  });

  it('ignores anything that is not a space', () => {
    const wall = { expressId: 40, ifcType: 'IfcWall', positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]) } as unknown as MeshData;
    assert.equal(read([wall], { 40: 1 }).size, 0);
  });
});
