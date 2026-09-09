/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTERNAL_SOURCES,
  externalRequestsAllowed,
  setExternalRequestAllowed,
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

test('denies every source by default', () => {
  installStorage();
  // The safe direction: a wrong "off" costs a map nobody asked for, a wrong
  // "on" leaks a building's location.
  for (const source of EXTERNAL_SOURCES) {
    assert.equal(externalRequestsAllowed(source.id), false, source.id);
  }
});

test('denies when there is no window at all', () => {
  assert.equal(externalRequestsAllowed('basemap'), false);
});

test('allows only after an explicit opt-in', () => {
  installStorage();
  setExternalRequestAllowed('basemap', true);
  assert.equal(externalRequestsAllowed('basemap'), true);
});

test('one source says nothing about the others', () => {
  // The whole point of the split: allowing an EPSG lookup must not disclose a
  // position to the elevation endpoint.
  installStorage();
  setExternalRequestAllowed('epsg', true);
  assert.equal(externalRequestsAllowed('epsg'), true);
  assert.equal(externalRequestsAllowed('elevation'), false);
  assert.equal(externalRequestsAllowed('basemap'), false);
});

test('opting back out denies again', () => {
  installStorage();
  setExternalRequestAllowed('bsdd', true);
  setExternalRequestAllowed('bsdd', false);
  assert.equal(externalRequestsAllowed('bsdd'), false);
});

test('the master switch reaches every source, both ways', () => {
  installStorage();
  setExternalRequestsAllowed(true);
  for (const source of EXTERNAL_SOURCES) {
    assert.equal(externalRequestsAllowed(source.id), true, source.id);
  }
  setExternalRequestsAllowed(false);
  for (const source of EXTERNAL_SOURCES) {
    assert.equal(externalRequestsAllowed(source.id), false, source.id);
  }
});

test('a stored answer from the old single switch carries over', () => {
  // Somebody who had allowed everything keeps everything, rather than finding
  // the app silently offline after an update.
  const data = installStorage();
  data.set('ifclite.privacy.allow-external-requests', 'true');
  for (const source of EXTERNAL_SOURCES) {
    assert.equal(externalRequestsAllowed(source.id), true, source.id);
  }
});

test('a per-source answer overrules the old single switch', () => {
  const data = installStorage();
  data.set('ifclite.privacy.allow-external-requests', 'true');
  setExternalRequestAllowed('elevation', false);
  assert.equal(externalRequestsAllowed('elevation'), false);
  assert.equal(externalRequestsAllowed('basemap'), true);
});

test('blocking everything also silences the old single switch', () => {
  // Left alone, a stored `true` there would keep answering for any source
  // whose own entry is missing, and "block everything" has to mean everything.
  const data = installStorage();
  data.set('ifclite.privacy.allow-external-requests', 'true');
  setExternalRequestsAllowed(false);
  assert.equal(data.get('ifclite.privacy.allow-external-requests'), 'false');
  for (const source of EXTERNAL_SOURCES) {
    assert.equal(externalRequestsAllowed(source.id), false, source.id);
  }
});

test('denies when storage cannot be read', () => {
  // Consent that cannot be recorded must not be assumed.
  installStorage({ throwing: true });
  assert.equal(externalRequestsAllowed('basemap'), false);
});

test('setting does not throw when storage is blocked', () => {
  installStorage({ throwing: true });
  assert.doesNotThrow(() => setExternalRequestAllowed('basemap', true));
  assert.doesNotThrow(() => setExternalRequestsAllowed(true));
  assert.equal(externalRequestsAllowed('basemap'), false);
});

test('every source names a label, a purpose and a host', () => {
  // The list is what the user is shown before opting in, so an entry without
  // a reason would make the disclosure useless.
  assert.ok(EXTERNAL_SOURCES.length > 0);
  const ids = new Set<string>();
  for (const source of EXTERNAL_SOURCES) {
    assert.ok(source.label.length > 0, `no label for ${source.id}`);
    assert.ok(source.purpose.length > 0, `no purpose for ${source.id}`);
    assert.ok(source.hosts.length > 0, `no host for ${source.id}`);
    for (const host of source.hosts) assert.ok(host.includes('.'), `bad host: ${host}`);
    assert.ok(!ids.has(source.id), `duplicate source id: ${source.id}`);
    ids.add(source.id);
  }
});
