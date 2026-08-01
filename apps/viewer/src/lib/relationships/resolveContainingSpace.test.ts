/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContainingSpace } from './resolveContainingSpace.js';
import type { ExistingSpaceEntry } from '@ifc-lite/create';

const rooms: ExistingSpaceEntry[] = [
  { spaceExpressId: 101, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
  { spaceExpressId: 102, polygon: [[10, 0], [14, 0], [14, 4], [10, 4]] },
];

test('resolves the space whose polygon contains the point', () => {
  assert.equal(resolveContainingSpace([2, 2], rooms), 101);
  assert.equal(resolveContainingSpace([12, 2], rooms), 102);
});

test('returns null when the point falls outside every space (e.g. a corridor)', () => {
  assert.equal(resolveContainingSpace([7, 2], rooms), null);
});

test('returns null for an empty space list', () => {
  assert.equal(resolveContainingSpace([1, 1], []), null);
});
