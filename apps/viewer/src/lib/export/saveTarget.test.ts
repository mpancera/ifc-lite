/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The folder an export goes to. The picker and IndexedDB are the browser's;
 * what is testable here is the reasoning around them — which key a folder is
 * remembered under, when the app may write, and that the write goes through.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveTargetKey, ensureWritable, writeIntoTarget, type DirectoryTarget,
} from './saveTarget';

/** A folder that records what was written into it. */
function fakeFolder(permission: PermissionState, onRequest?: PermissionState) {
  const written: Array<{ name: string; size: number }> = [];
  let current = permission;
  const target: DirectoryTarget = {
    name: 'Projektordner',
    queryPermission: async () => current,
    requestPermission: async () => { current = onRequest ?? current; return current; },
    getFileHandle: async (name) => ({
      createWritable: async () => ({
        write: async (data: BufferSource | Blob | string) => {
          written.push({ name, size: data instanceof Blob ? data.size : String(data).length });
        },
        close: async () => {},
      }),
    }),
  };
  return { target, written };
}

describe('saveTargetKey', () => {
  it('is the same for every export of one model', () => {
    // The whole point: a hash would change with every export, and the folder
    // would be forgotten on the round it exists for.
    const key = saveTargetKey('Langmatt_ARC_demo.ifc');
    assert.equal(saveTargetKey('Langmatt_ARC_demo_2026-08-19_1259.ifc'), key);
    assert.equal(saveTargetKey('Langmatt_ARC_demo_2026-08-19_1324.ifc'), key);
  });

  it('keeps two models apart', () => {
    assert.notEqual(saveTargetKey('Haus_A.ifc'), saveTargetKey('Haus_B.ifc'));
  });

  it('survives a name that is nothing but a stamp', () => {
    assert.ok(saveTargetKey('2026-08-19_1259.ifc').length > 0);
  });
});

describe('ensureWritable', () => {
  it('writes without asking when permission still stands', async () => {
    const { target } = fakeFolder('granted');
    assert.equal(await ensureWritable(target), true);
  });

  it('does not pop a dialog while only checking', async () => {
    // Called on mount to decide whether to OFFER the folder; a prompt there
    // would appear without anybody having clicked anything.
    const { target } = fakeFolder('prompt', 'granted');
    assert.equal(await ensureWritable(target), false);
  });

  it('asks when told to, and reports what the user answered', async () => {
    const granted = fakeFolder('prompt', 'granted');
    assert.equal(await ensureWritable(granted.target, { prompt: true }), true);

    const denied = fakeFolder('prompt', 'denied');
    assert.equal(await ensureWritable(denied.target, { prompt: true }), false);
  });
});

describe('writeIntoTarget', () => {
  it('writes the file under the name it was given', async () => {
    const { target, written } = fakeFolder('granted');
    await writeIntoTarget(target, 'Langmatt_ARC_demo_2026-08-19_1324.ifc', 'ISO-10303-21;');
    assert.deepEqual(written.map((w) => w.name), ['Langmatt_ARC_demo_2026-08-19_1324.ifc']);
  });

  it('copies a wasm-owned array before handing it over', async () => {
    // A `Uint8Array` from wasm can sit on a SharedArrayBuffer, which no Blob
    // accepts — the same copy `downloadFile` makes.
    const { target, written } = fakeFolder('granted');
    await writeIntoTarget(target, 'x.ifc', new Uint8Array([1, 2, 3, 4]));
    assert.equal(written[0].size, 4);
  });
});
