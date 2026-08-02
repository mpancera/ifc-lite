/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '@ifc-lite/geometry';
import { SNAPSHOT_VERSION, type OverlaySnapshot } from './types.js';
import {
  clearSnapshots,
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
} from './idbOverlayStorage.js';

function mesh(expressId: number): MeshData {
  return {
    expressId,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    color: [0.9, 0.15, 0.15, 1],
  } as MeshData;
}

function snapshot(sourceHash: string, savedAt = 1000): OverlaySnapshot {
  return {
    version: SNAPSHOT_VERSION,
    sourceHash,
    modelName: `${sourceHash}.ifc`,
    savedAt,
    newEntities: [{ expressId: 20213, type: 'IfcSensor', attributes: ['guid', null, 'Rauchmelder'] }],
    mutations: [],
    deleted: [],
    editedBaseEntities: [],
    placements: [{
      expressId: 20213, ifcType: 'IfcSensor', name: 'Rauchmelder',
      storeyGlobalId: 'gid-storey', containerGlobalId: 'gid-room',
    }],
    meshes: [{ expressId: 20213, mesh: mesh(20213) }],
  };
}

test('save then load returns the snapshot for that source', async () => {
  await clearSnapshots();
  await saveSnapshot(snapshot('hash-a'));

  const found = await loadSnapshot('hash-a');
  assert.equal(found?.sourceHash, 'hash-a');
  assert.equal(found?.placements[0].containerGlobalId, 'gid-room');
});

test('typed arrays survive the round-trip', async () => {
  // The whole "persist meshes" decision rests on structured clone handling
  // these without a serialisation layer.
  await clearSnapshots();
  await saveSnapshot(snapshot('hash-mesh'));

  const found = await loadSnapshot('hash-mesh');
  const restored = found!.meshes[0].mesh;
  assert.ok(restored.positions instanceof Float32Array);
  assert.ok(restored.indices instanceof Uint32Array);
  assert.deepEqual(Array.from(restored.indices), [0, 1, 2]);
});

test('an unknown source resolves to null, not an error', async () => {
  await clearSnapshots();
  assert.equal(await loadSnapshot('never-saved'), null);
});

test('saving the same source twice replaces rather than duplicates', async () => {
  await clearSnapshots();
  await saveSnapshot(snapshot('hash-a', 1000));
  await saveSnapshot(snapshot('hash-a', 2000));

  const all = await listSnapshots();
  assert.equal(all.length, 1);
  assert.equal(all[0].savedAt, 2000);
});

test('two different source files are kept apart', async () => {
  await clearSnapshots();
  await saveSnapshot(snapshot('hash-a'));
  await saveSnapshot(snapshot('hash-b'));

  assert.equal((await loadSnapshot('hash-a'))?.sourceHash, 'hash-a');
  assert.equal((await loadSnapshot('hash-b'))?.sourceHash, 'hash-b');
  assert.equal((await listSnapshots()).length, 2);
});

test('list returns newest first', async () => {
  await clearSnapshots();
  await saveSnapshot(snapshot('older', 1000));
  await saveSnapshot(snapshot('newer', 5000));

  assert.deepEqual((await listSnapshots()).map((s) => s.sourceHash), ['newer', 'older']);
});

test('delete removes only the named snapshot', async () => {
  await clearSnapshots();
  await saveSnapshot(snapshot('hash-a'));
  await saveSnapshot(snapshot('hash-b'));

  await deleteSnapshot('hash-a');
  assert.equal(await loadSnapshot('hash-a'), null);
  assert.equal((await loadSnapshot('hash-b'))?.sourceHash, 'hash-b');
});
