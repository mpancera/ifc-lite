/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectKey } from '@ifc-lite/project';
import { clearScoped, readScoped, scopedKey, writeScoped } from './scopedStorage.js';

const A = 'proj_aaaa1111' as ProjectKey;
const B = 'proj_bbbb2222' as ProjectKey;
const BASE = 'ifc-lite:zone-sets';

/** node:test has no DOM; a Map is all localStorage is used as here. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  return store;
}

let store: Map<string, string>;
beforeEach(() => { store = installStorage(); });

describe('scopedKey', () => {
  it('gives each project its own key', () => {
    assert.notEqual(scopedKey(BASE, A), scopedKey(BASE, B));
  });

  it('keeps the base recognisable, so the stored data can still be found by hand', () => {
    assert.ok(scopedKey(BASE, A).startsWith(BASE));
  });
});

describe('writeScoped / readScoped', () => {
  it('keeps two projects apart', () => {
    // The whole point: opening a second project must not show the first one's
    // zones as though they belonged there.
    writeScoped(BASE, A, 'zones-of-a');
    writeScoped(BASE, B, 'zones-of-b');

    assert.equal(readScoped(BASE, A), 'zones-of-a');
    assert.equal(readScoped(BASE, B), 'zones-of-b');
  });

  it('reads back nothing for a project that never wrote', () => {
    writeScoped(BASE, A, 'zones-of-a');

    assert.equal(readScoped(BASE, B), null);
  });

  it('writes nothing at all without a project', () => {
    // No "unassigned" bucket: a shared bucket is exactly how the leak happens.
    writeScoped(BASE, null, 'homeless');

    assert.equal(store.size, 0);
    assert.equal(readScoped(BASE, null), null);
  });

  it('forgets on clear, and only for that project', () => {
    writeScoped(BASE, A, 'a');
    writeScoped(BASE, B, 'b');

    clearScoped(BASE, A);

    assert.equal(readScoped(BASE, A), null);
    assert.equal(readScoped(BASE, B), 'b');
  });
});

describe('adopting what was stored before scoping existed', () => {
  it('takes over the unscoped value for the first project that asks', () => {
    // Everything written before scoping sits under the bare key. Dropping it
    // would silently lose zones somebody drew.
    store.set(BASE, 'drawn-last-week');

    assert.equal(readScoped(BASE, A), 'drawn-last-week');
    assert.equal(store.get(scopedKey(BASE, A)), 'drawn-last-week');
  });

  it('removes the unscoped value once adopted', () => {
    // Leaving it would hand the same content to the NEXT project too, which is
    // the leak this is meant to close.
    store.set(BASE, 'drawn-last-week');
    readScoped(BASE, A);

    assert.equal(store.has(BASE), false);
    assert.equal(readScoped(BASE, B), null);
  });

  it('does not let a legacy value overwrite what a project already has', () => {
    // Its own data is newer and more specific than anything left lying around.
    writeScoped(BASE, A, 'mine');
    store.set(BASE, 'stale');

    assert.equal(readScoped(BASE, A), 'mine');
  });

  it('leaves the legacy value alone when there is no project', () => {
    // Otherwise opening the viewer with nothing loaded would discard it.
    store.set(BASE, 'drawn-last-week');

    assert.equal(readScoped(BASE, null), null);
    assert.equal(store.get(BASE), 'drawn-last-week');
  });
});
