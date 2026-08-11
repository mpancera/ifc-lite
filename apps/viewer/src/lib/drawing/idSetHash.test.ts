/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashIdSet } from './idSetHash.js';

describe('hashIdSet — what decides whether a drawing is rebuilt', () => {
  it('distinguishes two DIFFERENT sets of the same size', () => {
    // The regression this exists for. Soloing storey A then storey B swaps the
    // whole membership, and two storeys of a building are often the same size.
    // Keying on size alone left the plan cut at the new height but still
    // showing the previous storey's elements.
    const storeyA = new Set([101, 102, 103, 104]);
    const storeyB = new Set([201, 202, 203, 204]);
    assert.equal(storeyA.size, storeyB.size);
    assert.notEqual(hashIdSet(storeyA), hashIdSet(storeyB));
  });

  it('is stable when the same ids arrive in a different order', () => {
    // Otherwise a set rebuilt by a different code path would look like a
    // change and regenerate the cut for nothing.
    assert.equal(hashIdSet(new Set([3, 1, 2])), hashIdSet(new Set([1, 2, 3])));
  });

  it('is stable across rebuilds of an equal set', () => {
    assert.equal(hashIdSet(new Set([7, 8, 9])), hashIdSet(new Set([7, 8, 9])));
  });

  it('separates "no isolation" from "isolate nothing"', () => {
    // They mean opposite things to the generator: everything, versus an empty
    // drawing. Collapsing them would make one of the two unreachable.
    assert.notEqual(hashIdSet(null), hashIdSet(new Set()));
    assert.equal(hashIdSet(null), hashIdSet(undefined));
  });

  it('moves when one id is added, removed, or swapped', () => {
    const base = new Set([10, 20, 30]);
    assert.notEqual(hashIdSet(base), hashIdSet(new Set([10, 20, 30, 40])));
    assert.notEqual(hashIdSet(base), hashIdSet(new Set([10, 20])));
    assert.notEqual(hashIdSet(base), hashIdSet(new Set([10, 20, 31])));
  });

  it('survives the near-miss a plain XOR would not catch', () => {
    // 3 === 1 ^ 2, so an XOR-only fingerprint would call these equal.
    assert.notEqual(hashIdSet(new Set([1, 2])), hashIdSet(new Set([3])));
  });

  it('survives the near-miss a plain sum would not catch', () => {
    // Equal sums and equal sizes; the XOR half separates them.
    assert.notEqual(hashIdSet(new Set([1, 6])), hashIdSet(new Set([3, 4])));
  });
});
