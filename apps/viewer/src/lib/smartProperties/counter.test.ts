/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateCounter, formatCounter, scopeKeyOf } from './counter.js';
import type { CounterPeer } from './counter.js';
import type { CounterSource } from './types.js';

const SOURCE: CounterSource = { kind: 'counter', width: 3, scopedBy: ['IfcSpace', 'IfcEntityType'] };

const peer = (expressId: number, scopeKey: string, assigned: number | null): CounterPeer =>
  ({ expressId, scopeKey, assigned });

const KITCHEN_SMOKE = scopeKeyOf(['0.14', 'smoke-detector']);
const KITCHEN_HEAT = scopeKeyOf(['0.14', 'heat-detector']);
const OFFICE_SMOKE = scopeKeyOf(['0.15', 'smoke-detector']);

test('the first element in a scope gets 001', () => {
  const result = allocateCounter({ source: SOURCE, expressId: 1, scopeKey: KITCHEN_SMOKE, peers: [] });

  assert.equal(result.text, '001');
  assert.equal(result.allocated, true);
});

test('a number already assigned is reused, never recomputed', () => {
  // The whole point: re-evaluation must not renumber. An element carrying 007
  // keeps 007 even when it is the only one left.
  const peers = [peer(1, KITCHEN_SMOKE, 7)];
  const result = allocateCounter({ source: SOURCE, expressId: 1, scopeKey: KITCHEN_SMOKE, peers });

  assert.equal(result.text, '007');
  assert.equal(result.allocated, false);
});

test('a new element continues after the highest in its scope', () => {
  const peers = [peer(1, KITCHEN_SMOKE, 1), peer(2, KITCHEN_SMOKE, 2)];
  const result = allocateCounter({ source: SOURCE, expressId: 3, scopeKey: KITCHEN_SMOKE, peers });

  assert.equal(result.text, '003');
});

test('a gap left by a deletion is NOT reused', () => {
  // Filling the gap would hand a new device the identifier older documents
  // still associate with the removed one.
  const peers = [peer(1, KITCHEN_SMOKE, 1), peer(3, KITCHEN_SMOKE, 3)];
  const result = allocateCounter({ source: SOURCE, expressId: 9, scopeKey: KITCHEN_SMOKE, peers });

  assert.equal(result.text, '004');
});

test('each scope counts independently', () => {
  const peers = [
    peer(1, KITCHEN_SMOKE, 1), peer(2, KITCHEN_SMOKE, 2),
    peer(3, OFFICE_SMOKE, 1),
    peer(4, KITCHEN_HEAT, 1),
  ];

  assert.equal(allocateCounter({ source: SOURCE, expressId: 9, scopeKey: OFFICE_SMOKE, peers }).text, '002');
  assert.equal(allocateCounter({ source: SOURCE, expressId: 9, scopeKey: KITCHEN_HEAT, peers }).text, '002');
  assert.equal(allocateCounter({ source: SOURCE, expressId: 9, scopeKey: KITCHEN_SMOKE, peers }).text, '003');
});

test('peers without a number yet do not advance the counter', () => {
  // An element mid-placement, or one whose rule has not run, must not consume
  // a number it never stored.
  const peers = [peer(1, KITCHEN_SMOKE, 1), peer(2, KITCHEN_SMOKE, null)];
  const result = allocateCounter({ source: SOURCE, expressId: 3, scopeKey: KITCHEN_SMOKE, peers });

  assert.equal(result.text, '002');
});

test('width pads, and never truncates a number that outgrew it', () => {
  assert.equal(formatCounter(7, 3), '007');
  assert.equal(formatCounter(1234, 3), '1234');
  assert.equal(formatCounter(7, 0), '7');
});

test('scope keys cannot collide across different splits', () => {
  // 'A' + 'BC' must not equal 'AB' + 'C'.
  assert.notEqual(scopeKeyOf(['A', 'BC']), scopeKeyOf(['AB', 'C']));
});
