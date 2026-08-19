/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spaceGraphMeshes, GRAPH_HEIGHT } from './graphMeshes.js';
import type { SpaceGraphView } from './graphView.js';

const view: SpaceGraphView = {
  nodes: [
    { spaceId: 1, at: { x: 0, y: 0 }, label: '1.01', kind: 'room', steps: 1, degree: 2 },
    { spaceId: 2, at: { x: 10, y: 0 }, label: '1.02', kind: 'safe', steps: 0, degree: 1 },
  ],
  edges: [
    { doorId: 10, from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, exterior: false, spaceIds: [1, 2] },
  ],
};

function bounds(positions: Float32Array) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

describe('spaceGraphMeshes', () => {
  it('builds one mesh per node and one per edge', () => {
    const meshes = spaceGraphMeshes(view, { elevation: 0 });
    assert.equal(meshes.length, 3);
    assert.deepEqual(meshes.map((m) => m.expressId).sort((a, b) => a - b), [1, 2, 10]);
  });

  it('hangs the diagram above the floor it describes', () => {
    // Drawn at floor level it would be inside the slab, which is the one place
    // it cannot be read from.
    const meshes = spaceGraphMeshes(view, { elevation: 7.47 });
    for (const mesh of meshes) {
      const b = bounds(mesh.positions);
      assert.ok(b.minY > 7.47, 'above the storey floor');
      assert.ok(b.maxY < 7.47 + GRAPH_HEIGHT + 1, 'and not far above it');
    }
  });

  it('puts drawing x on the renderer X and drawing y on the renderer Z', () => {
    // The mapping `planPick` pins. Getting it wrong turns the diagram on its
    // side and no test of the maths alone would notice.
    const node = spaceGraphMeshes(view, { elevation: 0 }).find((m) => m.expressId === 2)!;
    const b = bounds(node.positions);
    assert.ok(Math.abs((b.minX + b.maxX) / 2 - 10) < 1e-6, 'x');
    assert.ok(Math.abs((b.minZ + b.maxZ) / 2 - 0) < 1e-6, 'z');
  });

  it('spans the edge bar from one room to the other', () => {
    const bar = spaceGraphMeshes(view, { elevation: 0 }).find((m) => m.expressId === 10)!;
    const b = bounds(bar.positions);
    assert.ok(Math.abs(b.minX - 0) < 0.01, `starts at the first room (${b.minX})`);
    assert.ok(Math.abs(b.maxX - 10) < 0.01, `ends at the second (${b.maxX})`);
  });

  it('colours the way out apart from the rooms', () => {
    const meshes = spaceGraphMeshes(view, { elevation: 0 });
    const room = meshes.find((m) => m.expressId === 1)!;
    const safe = meshes.find((m) => m.expressId === 2)!;
    assert.notDeepEqual(room.color, safe.color);
  });

  it('skips a doorway between two rooms that sit on the same spot', () => {
    // Two rooms detected twice over the same floor: the bar would have no
    // direction and comes out as a degenerate sliver.
    const degenerate: SpaceGraphView = {
      nodes: [],
      edges: [{ doorId: 1, from: { x: 3, y: 3 }, to: { x: 3, y: 3 }, exterior: false, spaceIds: [1, 2] }],
    };
    assert.deepEqual(spaceGraphMeshes(degenerate, { elevation: 0 }), []);
  });
});
