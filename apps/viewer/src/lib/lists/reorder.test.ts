/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moveItem, swapItem } from './reorder.js';

const list = ['a', 'b', 'c', 'd', 'e'];

describe('moveItem', () => {
  it('moves a row up and shifts the rest down', () => {
    // The case a swap gets wrong: 'b'..'d' must slide, not trade places with 'e'.
    assert.deepEqual(moveItem(list, 4, 1), ['a', 'e', 'b', 'c', 'd']);
  });

  it('moves a row down and shifts the rest up', () => {
    assert.deepEqual(moveItem(list, 0, 3), ['b', 'c', 'd', 'a', 'e']);
  });

  it('moves to the very top and the very bottom', () => {
    assert.deepEqual(moveItem(list, 2, 0), ['c', 'a', 'b', 'd', 'e']);
    assert.deepEqual(moveItem(list, 2, 4), ['a', 'b', 'd', 'e', 'c']);
  });

  it('agrees with a swap for neighbours', () => {
    // Which is why the arrows may keep swapping.
    assert.deepEqual(moveItem(list, 2, 3), swapItem(list, 2, 1));
    assert.deepEqual(moveItem(list, 2, 1), swapItem(list, 2, -1));
  });

  it('clamps a drop past the end instead of refusing it', () => {
    assert.deepEqual(moveItem(list, 0, 99), ['b', 'c', 'd', 'e', 'a']);
    assert.deepEqual(moveItem(list, 4, -99), ['e', 'a', 'b', 'c', 'd']);
  });

  it('returns the same array when nothing moves', () => {
    // Identity is the signal a React setter uses to skip the re-render.
    assert.equal(moveItem(list, 2, 2), list);
    assert.equal(moveItem(list, 9, 0), list);
    assert.equal(moveItem(list, -1, 0), list);
  });

  it('leaves the input untouched', () => {
    const original = [...list];
    moveItem(list, 0, 4);
    assert.deepEqual(list, original);
  });

  it('handles a one-item list', () => {
    assert.deepEqual(moveItem(['a'], 0, 0), ['a']);
  });
});

describe('swapItem', () => {
  it('exchanges with the row above and below', () => {
    assert.deepEqual(swapItem(list, 2, -1), ['a', 'c', 'b', 'd', 'e']);
    assert.deepEqual(swapItem(list, 2, 1), ['a', 'b', 'd', 'c', 'e']);
  });

  it('returns the same array at either end', () => {
    assert.equal(swapItem(list, 0, -1), list);
    assert.equal(swapItem(list, 4, 1), list);
  });

  it('leaves the input untouched', () => {
    const original = [...list];
    swapItem(list, 1, 1);
    assert.deepEqual(list, original);
  });
});
