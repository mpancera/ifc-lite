/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { footprintsToSkip, type ExistingRoom } from './skipFootprints.js';

const square = (n: number): ExistingRoom => ({
  spaceExpressId: n,
  polygon: [[0, 0], [n, 0], [n, n], [0, n]],
});

describe('footprintsToSkip', () => {
  it('keeps every room that is still there', () => {
    const skip = footprintsToSkip([square(1), square(2)], () => false);
    assert.equal(skip.length, 2);
  });

  it('drops a room deleted this session, so the floor can be redone', () => {
    // The reported workflow: the detection got a floor wrong, every room on it
    // was deleted, and the detection was run again. The tombstoned rooms are
    // still in the parsed store — counting them would have emitted nothing.
    const skip = footprintsToSkip([square(1), square(2)], (id) => id === 1);
    assert.equal(skip.length, 1);
    assert.deepEqual(skip[0], square(2).polygon);
  });

  it('is empty once the whole floor is deleted', () => {
    const skip = footprintsToSkip([square(1), square(2)], () => true);
    assert.deepEqual(skip, []);
  });

  it('is empty on a floor that never had rooms', () => {
    assert.deepEqual(footprintsToSkip([], () => false), []);
  });
});
