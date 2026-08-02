/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTERNAL_ENDPOINTS,
  externalRequestsAllowed,
  setExternalRequestsAllowed,
} from './externalRequests.js';

/** Minimal localStorage stand-in; `throwing` simulates a hardened browser. */
function installStorage(options: { throwing?: boolean } = {}) {
  const data = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => {
        if (options.throwing) throw new Error('storage blocked');
        return data.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (options.throwing) throw new Error('storage blocked');
        data.set(k, v);
      },
    },
  };
  return data;
}

beforeEach(() => { delete (globalThis as { window?: unknown }).window; });

test('denies by default', () => {
  installStorage();
  // The safe direction: a wrong "off" costs a map nobody asked for, a wrong
  // "on" leaks a building's location.
  assert.equal(externalRequestsAllowed(), false);
});

test('denies when there is no window at all', () => {
  assert.equal(externalRequestsAllowed(), false);
});

test('allows only after an explicit opt-in', () => {
  installStorage();
  setExternalRequestsAllowed(true);
  assert.equal(externalRequestsAllowed(), true);
});

test('opting back out denies again', () => {
  installStorage();
  setExternalRequestsAllowed(true);
  setExternalRequestsAllowed(false);
  assert.equal(externalRequestsAllowed(), false);
});

test('denies when storage cannot be read', () => {
  // Consent that cannot be recorded must not be assumed.
  installStorage({ throwing: true });
  assert.equal(externalRequestsAllowed(), false);
});

test('setting does not throw when storage is blocked', () => {
  installStorage({ throwing: true });
  assert.doesNotThrow(() => setExternalRequestsAllowed(true));
  assert.equal(externalRequestsAllowed(), false);
});

test('every disclosed endpoint names a host and a purpose', () => {
  // The list is what the user is shown before opting in, so an entry without
  // a reason would make the disclosure useless.
  assert.ok(EXTERNAL_ENDPOINTS.length > 0);
  for (const entry of EXTERNAL_ENDPOINTS) {
    assert.ok(entry.host.includes('.'), `bad host: ${entry.host}`);
    assert.ok(entry.purpose.length > 0, `no purpose for ${entry.host}`);
  }
});
