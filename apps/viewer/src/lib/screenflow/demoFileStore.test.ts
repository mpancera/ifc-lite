/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The uploaded-file store, against a real IndexedDB implementation.
 *
 * The interesting assertions are not "a put comes back out" but the two rules
 * the store exists to keep: the stored file wears the SLOT's name rather than
 * the one it arrived with, and `missingDemoFiles` counts a filled slot as
 * present without asking the network.
 *
 * Lives in its own file because `fake-indexeddb/auto` installs itself on
 * `globalThis`; `tsx --test` runs each file in its own process.
 */

// fake-indexeddb installs a Node-compatible IDB implementation on
// `globalThis.indexedDB` (+ the IDB* constructors) via the `/auto` entry.
import 'fake-indexeddb/auto';

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FILES } from './demoFiles.js';
import {
  readStoredDemoFile,
  removeStoredDemoFile,
  storeDemoFile,
  storedDemoFileIds,
} from './demoFileStore.js';
import { missingDemoFiles } from './dataset.js';

afterEach(async () => {
  for (const id of await storedDemoFileIds()) await removeStoredDemoFile(id);
});

describe('demoFileStore', () => {
  it('gives back what was put in', async () => {
    await storeDemoFile('plan', new Blob(['0\nSECTION\n'], { type: 'image/vnd.dxf' }));
    const back = await readStoredDemoFile('plan');
    assert.ok(back, 'nothing came back out');
    assert.equal(await back.text(), '0\nSECTION\n');
  });

  it('answers null for a slot nobody filled', async () => {
    assert.equal(await readStoredDemoFile('architecture'), null);
  });

  it('renames the file to the slot, so no project name reaches the video', async () => {
    // The whole point of the generic slot names: the viewer's model list is on
    // screen while the clip records, and a file picked off a work laptop is
    // named after the building it came from.
    await storeDemoFile('architecture', new File(['x'], 'Neubau Werk 3 - IFC4.ifc'));
    const back = await readStoredDemoFile('architecture');
    assert.equal(back?.name, DEMO_FILES.architecture.name);
    assert.doesNotMatch(back?.name ?? '', /Werk/);
  });

  it('replaces rather than accumulating, so a wrong upload can be corrected', async () => {
    await storeDemoFile('plan', new Blob(['erste']));
    await storeDemoFile('plan', new Blob(['zweite']));
    assert.deepEqual(await storedDemoFileIds(), ['plan']);
    assert.equal(await (await readStoredDemoFile('plan'))?.text(), 'zweite');
  });

  it('forgets a slot on request', async () => {
    await storeDemoFile('plan', new Blob(['x']));
    await removeStoredDemoFile('plan');
    assert.equal(await readStoredDemoFile('plan'), null);
    assert.deepEqual(await storedDemoFileIds(), []);
  });

  it('lists only slots that still exist in the code', async () => {
    // The database outlives the code. A key from a slot that has since been
    // renamed away must not be handed back as a live id.
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('ifc-lite-screenflow-demo', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('demo-files', 'readwrite');
      tx.objectStore('demo-files').put({ id: 'einSlotDenEsNichtMehrGibt', name: 'x', blob: new Blob(['x']), storedAt: 0 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    assert.deepEqual(await storedDemoFileIds(), []);
  });
});

describe('missingDemoFiles with an upload present', () => {
  it('counts an uploaded slot as present without asking the network', async () => {
    // No fetch stub on purpose: if the upload were not consulted first, this
    // would fall through to a real request and the slot would read as missing.
    await storeDemoFile('plan', new Blob(['0\nSECTION\n']));
    assert.deepEqual(await missingDemoFiles(['plan']), []);
  });

  it('still reports a slot nobody filled', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    try {
      assert.deepEqual(await missingDemoFiles(['architecture']), ['architecture']);
    } finally {
      globalThis.fetch = real;
    }
  });
});
