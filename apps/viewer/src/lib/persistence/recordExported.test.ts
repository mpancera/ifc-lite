/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The loop this closes: a session whose authored objects are geometry has no
 * GlobalId for the reconciler to ask about, so it can never be recognised in
 * the file it was exported to, and is offered again on every single open.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { recordExportedInto, type SnapshotStore } from './recordExported.js';
import type { OverlaySnapshot } from './types.js';

const store = new Map<string, OverlaySnapshot>();

/** The two calls the real one makes, in a Map. */
const fake: SnapshotStore = {
  load: async (hash) => store.get(hash) ?? null,
  save: async (snapshot) => { store.set(snapshot.sourceHash, snapshot); },
};

function snapshot(sourceHash: string): OverlaySnapshot {
  return {
    sourceHash,
    modelName: 'x.ifc',
    savedAt: 0,
    newEntities: [],
    mutations: [],
  } as unknown as OverlaySnapshot;
}

beforeEach(() => store.clear());

describe('recordExportedInto', () => {
  it('records the exported file on the session it came from', async () => {
    store.set('abc', snapshot('abc'));

    await recordExportedInto('abc', 'ISO-10303-21; …', fake);

    const saved = store.get('abc')!;
    assert.equal(saved.materialisedIn?.length, 1);
    assert.notEqual(saved.materialisedIn?.[0], 'abc');
  });

  it('keeps the file it was already recorded in', async () => {
    // Exporting twice from one session gives two files, and BOTH contain the
    // work — forgetting the first would bring the prompt back for it.
    store.set('abc', snapshot('abc'));

    await recordExportedInto('abc', 'first', fake);
    await recordExportedInto('abc', 'second', fake);

    assert.equal(store.get('abc')!.materialisedIn?.length, 2);
  });

  it('does not record the same file twice', async () => {
    store.set('abc', snapshot('abc'));

    await recordExportedInto('abc', 'same bytes', fake);
    await recordExportedInto('abc', 'same bytes', fake);

    assert.equal(store.get('abc')!.materialisedIn?.length, 1);
  });

  it('takes bytes and text as the same file', async () => {
    // The STEP exporter hands back a string and the IFCX one an array; a file
    // recorded under two different hashes would prompt for one of them.
    store.set('abc', snapshot('abc'));
    store.set('def', snapshot('def'));

    await recordExportedInto('abc', 'ISO-10303-21;', fake);
    await recordExportedInto('def', new TextEncoder().encode('ISO-10303-21;'), fake);

    assert.deepEqual(store.get('abc')!.materialisedIn, store.get('def')!.materialisedIn);
  });

  it('does nothing for a model that has no saved session', async () => {
    await recordExportedInto('nothing-saved', 'content', fake);

    assert.equal(store.size, 0);
  });

  it('does nothing without a source hash', async () => {
    store.set('abc', snapshot('abc'));

    await recordExportedInto(null, 'content', fake);

    assert.equal(store.get('abc')!.materialisedIn, undefined);
  });

  it('never throws — the file is already written by the time it runs', async () => {
    // Failing here would tell somebody their export failed when it did not.
    // The cost of a swallowed error is one more prompt.
    store.set('abc', snapshot('abc'));
    const broken = { get length() { throw new Error('nope'); } } as unknown as Uint8Array;

    await recordExportedInto('abc', broken, fake);
  });
});
