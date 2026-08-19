/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planDrawsElement } from './planVisibility.js';

describe('planDrawsElement', () => {
  it('draws everything when the model says nothing to the contrary', () => {
    const draws = planDrawsElement({});
    assert.equal(draws(1), true);
    assert.equal(draws(9999), true);
  });

  it('drops a deleted element — the reported case', () => {
    // Deleting the wrongly detected rooms of a floor left their stamps behind.
    const deleted = new Set([30, 31]);
    const draws = planDrawsElement({ isDeleted: (id) => deleted.has(id) });
    assert.equal(draws(30), false);
    assert.equal(draws(31), false);
    assert.equal(draws(32), true, 'the rooms that were kept still get a label');
  });

  it('drops a hidden element, and asks in the id space the hidden set uses', () => {
    // Local 30 is global 1030 in this model; asking with the local id would
    // miss the entry and label a room the drawing does not show.
    const draws = planDrawsElement({
      hiddenGlobalIds: new Set([1030]),
      toGlobalId: (id) => id + 1000,
    });
    assert.equal(draws(30), false);
    assert.equal(draws(31), true);
  });

  it('draws only what is isolated, while isolation is on', () => {
    const draws = planDrawsElement({ isolatedGlobalIds: new Set([30]) });
    assert.equal(draws(30), true);
    assert.equal(draws(31), false);
  });

  it('treats an empty isolation set as "isolate nothing", not as "no isolation"', () => {
    // The opposite reading would quietly relabel the whole floor.
    const draws = planDrawsElement({ isolatedGlobalIds: new Set() });
    assert.equal(draws(30), false);
  });

  it('keeps null isolation apart from an empty one', () => {
    const draws = planDrawsElement({ isolatedGlobalIds: null });
    assert.equal(draws(30), true);
  });

  it('drops a deleted element even when it is the isolated one', () => {
    // Deleting the room you had isolated is an ordinary way to get here.
    const draws = planDrawsElement({
      isDeleted: (id) => id === 30,
      isolatedGlobalIds: new Set([30]),
    });
    assert.equal(draws(30), false);
  });
});
