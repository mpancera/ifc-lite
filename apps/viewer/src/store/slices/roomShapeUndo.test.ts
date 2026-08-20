/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The mesh swap a reshape depends on, and the reason it is a swap.
 *
 * `replaceMeshesForEntity` is the piece that made a reshaped room stop being
 * drawn twice. The two symptoms it fixes are both in here as tests, because
 * both looked like something else: an old outline still cut into the plan, and
 * a room labelled twice with two slightly different areas.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '@ifc-lite/geometry';
import { useViewerStore } from '../index.js';

function mesh(expressId: number, overrides: Partial<MeshData> = {}): MeshData {
  return {
    expressId,
    ifcType: 'IfcSpace',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    color: [0, 1, 0, 1],
    ...overrides,
  } as MeshData;
}

describe('replaceMeshesForEntity', () => {
  beforeEach(() => {
    useViewerStore.setState({
      geometryResult: {
        meshes: [mesh(10, { occurrenceKey: 'occ-10' }), mesh(11)],
        totalTriangles: 2,
        totalVertices: 6,
        coordinateInfo: useViewerStore.getState().geometryResult?.coordinateInfo
          ?? ({} as never),
      } as never,
      models: new Map(),
      activeModelId: null,
    });
  });

  it('puts one mesh where the old one was, not one beside it', () => {
    // Drawn twice is what the plan showed: the old outline cut into the
    // drawing under the new fill.
    const removed = useViewerStore.getState().replaceMeshesForEntity([10], mesh(999));
    const meshes = useViewerStore.getState().geometryResult!.meshes;
    assert.equal(meshes.length, 2, 'still one mesh per entity');
    assert.equal(removed.length, 1, 'and it hands back what it took, for undo');
  });

  it('gives the replacement the identity of what it replaced', () => {
    // The room labels group by occurrenceKey. A replacement carrying its own
    // key becomes a SECOND group, and the room gets two labels with two
    // different areas — which is exactly what happened.
    useViewerStore.getState().replaceMeshesForEntity([10], mesh(999));
    const swapped = useViewerStore.getState().geometryResult!.meshes[0];
    assert.equal(swapped.expressId, 10);
    assert.equal(swapped.occurrenceKey, 'occ-10');
  });

  it('matches on either id, because the two paths stamp different ones', () => {
    // A mesh read from the file carries the model-local express id; one built
    // by the authoring path carries the federated global id.
    const removed = useViewerStore.getState().replaceMeshesForEntity([5000, 11], mesh(999));
    assert.equal(removed.length, 1);
    assert.equal(removed[0].expressId, 11);
  });

  it('keeps the mesh in its original position in the list', () => {
    useViewerStore.getState().replaceMeshesForEntity([10], mesh(999));
    assert.equal(useViewerStore.getState().geometryResult!.meshes[0].expressId, 10);
    assert.equal(useViewerStore.getState().geometryResult!.meshes[1].expressId, 11);
  });

  it('appends when there was nothing to replace', () => {
    const removed = useViewerStore.getState().replaceMeshesForEntity([777], mesh(777));
    assert.deepEqual(removed, []);
    const meshes = useViewerStore.getState().geometryResult!.meshes;
    assert.equal(meshes.length, 3);
    assert.equal(meshes[2].expressId, 777, 'and keeps its own identity');
  });

  it('keeps the triangle and vertex totals honest', () => {
    const big = mesh(999, {
      positions: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    });
    useViewerStore.getState().replaceMeshesForEntity([10], big);
    const result = useViewerStore.getState().geometryResult!;
    assert.equal(result.totalTriangles, 3, '2 of the replacement + 1 left alone');
    assert.equal(result.totalVertices, 9);
  });
});
