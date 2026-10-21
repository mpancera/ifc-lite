/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '@ifc-lite/geometry';
import { instanceExampleMeshes } from './instanceExampleMeshes.js';
import type { ExampleMeshes } from './exampleMeshes.js';

function mesh(over: Partial<MeshData> = {}): MeshData {
  return {
    expressId: 72,
    positions: new Float32Array([0, 0, 0, 1, 2, 3]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 0]),
    color: [1, 0, 0, 1],
    ...over,
  } as MeshData;
}

function cupboard(entries: [number, MeshData[]][]): ExampleMeshes {
  return { byProduct: new Map(entries), triangles: 1 };
}

describe('putting a meshed example where it was placed', () => {
  it('moves the frame by the placement point, in the renderer’s frame', () => {
    // IFC is Z-up, the renderer Y-up with IFC +Y running into -Z. A sign error
    // here looks like a modelling mistake, so it is pinned.
    const placed = instanceExampleMeshes(
      cupboard([[72, [mesh()]]]),
      [{ sourceExpressId: 72, globalId: 1013 }],
      [10, 20, 0],
      3,
    );
    assert.equal(placed.length, 1);
    // x + 10, y + (0 + 3), z + (-20)
    assert.deepEqual(placed[0].origin, [10, 3, -20]);
  });

  it('adds to the frame the element already had', () => {
    // THE defect this file exists to avoid. `origin` is where a multi-part
    // object keeps each body's offset from the others; replacing it instead of
    // adding to it pulled the bottle, the cap and the handle onto one point,
    // each correctly sized and all in the same place.
    const placed = instanceExampleMeshes(
      cupboard([[72, [mesh({ origin: [0, 0.3, 0] })]]]),
      [{ sourceExpressId: 72, globalId: 1013 }],
      [10, 20, 0],
      3,
    );
    assert.deepEqual(placed[0].origin, [10, 3.3, -20]);
  });

  it('leaves the vertices alone entirely', () => {
    // The renderer reconstructs a vertex as origin + position, so a placement
    // never touches a buffer — which is also why twenty detectors are cheap.
    const stored = mesh();
    const [placed] = instanceExampleMeshes(
      cupboard([[72, [stored]]]),
      [{ sourceExpressId: 72, globalId: 1013 }],
      [5, 5, 5],
      1,
    );
    assert.equal(placed.positions, stored.positions);
    assert.equal(placed.normals, stored.normals);
    assert.equal(placed.indices, stored.indices);
  });

  it('moves the absolute bounding box with the element', () => {
    const [placed] = instanceExampleMeshes(
      cupboard([[72, [mesh({ geometryAabb: { min: [0, 0, 0], max: [1, 1, 1] } })]]]),
      [{ sourceExpressId: 72, globalId: 1013 }],
      [10, 20, 0],
      3,
    );
    assert.deepEqual(placed.geometryAabb, { min: [10, 3, -20], max: [11, 4, -19] });
  });

  it('relabels every mesh with the entity that was created here', () => {
    // Carried over, the example's own express id would make a click in the
    // scene resolve to an entity of a different file.
    const placed = instanceExampleMeshes(
      cupboard([[72, [mesh(), mesh()]]]),
      [{ sourceExpressId: 72, globalId: 1013 }],
      [0, 0, 0],
      0,
    );
    assert.deepEqual(placed.map((m) => m.expressId), [1013, 1013]);
  });

  it('gives each product its own meshes', () => {
    const placed = instanceExampleMeshes(
      cupboard([
        [72, [mesh({ color: [1, 0, 0, 1] })]],
        [77, [mesh({ color: [0, 1, 0, 1] })]],
      ]),
      [
        { sourceExpressId: 72, globalId: 1013 },
        { sourceExpressId: 77, globalId: 1014 },
      ],
      [0, 0, 0],
      0,
    );
    assert.deepEqual(placed.map((m) => m.expressId), [1013, 1014]);
    assert.deepEqual(placed.map((m) => m.color), [[1, 0, 0, 1], [0, 1, 0, 1]]);
  });

  it('skips a product the cupboard has nothing for', () => {
    // A plan symbol with no body is ordinary, not an error.
    const placed = instanceExampleMeshes(
      cupboard([[72, [mesh()]]]),
      [
        { sourceExpressId: 72, globalId: 1013 },
        { sourceExpressId: 374, globalId: 1015 },
      ],
      [0, 0, 0],
      0,
    );
    assert.equal(placed.length, 1);
  });

  it('leaves the stored mesh untouched, so the next placement starts clean', () => {
    const stored = mesh({ origin: [1, 1, 1] });
    instanceExampleMeshes(
      cupboard([[72, [stored]]]),
      [{ sourceExpressId: 72, globalId: 1013 }],
      [5, 5, 5],
      1,
    );
    assert.deepEqual(stored.origin, [1, 1, 1]);
  });

  it('drops the identity fields that point into the example file', () => {
    const [placed] = instanceExampleMeshes(
      cupboard([[72, [mesh({
        entityIds: new Uint32Array([72, 72]), materialId: 9, occurrenceKey: 'beispiel',
      })]]]),
      [{ sourceExpressId: 72, globalId: 1013 }],
      [0, 0, 0],
      0,
    );
    assert.equal(placed.entityIds, undefined);
    assert.equal(placed.materialId, undefined);
    assert.equal(placed.geometryItemId, undefined);
    assert.equal(placed.occurrenceKey, undefined);
  });
});
