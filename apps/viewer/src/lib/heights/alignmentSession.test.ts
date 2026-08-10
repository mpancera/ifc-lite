/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignmentPairs, alignmentPickCount, alignmentPrompt, alignmentStep,
} from './alignmentSession.js';
import type { DxfAlignmentSession } from '@/store/slices/drawing2DSlice';

const p = (n: number) => ({ x: n, y: n });

function session(fromCount: number, toCount: number): DxfAlignmentSession {
  return {
    underlayId: 'u1',
    from: Array.from({ length: fromCount }, (_, i) => p(i)),
    to: Array.from({ length: toCount }, (_, i) => p(i + 10)),
    lockScale: false,
  };
}

describe('alignmentStep', () => {
  it('starts on the plan', () => {
    assert.equal(alignmentStep(session(0, 0)), 'pick-from');
  });

  it('alternates plan, model, plan, model', () => {
    assert.deepEqual(
      [session(0, 0), session(1, 0), session(1, 1), session(2, 1)].map(alignmentStep),
      ['pick-from', 'pick-to', 'pick-from', 'pick-to'],
    );
  });

  it('is ready once both pairs are in', () => {
    assert.equal(alignmentStep(session(2, 2)), 'ready');
  });
});

describe('alignmentPrompt', () => {
  it('says WHICH drawing to click, not just "pick a point"', () => {
    // With a plan lying over a model section, "pick a point" is exactly the
    // instruction that cannot be followed.
    assert.match(alignmentPrompt(session(0, 0)), /Plan/);
    assert.match(alignmentPrompt(session(1, 0)), /Modell/);
  });

  it('counts the pairs, not the clicks', () => {
    // A person thinks in "this feature and where it goes", not in four clicks.
    assert.match(alignmentPrompt(session(0, 0)), /1 von 2/);
    assert.match(alignmentPrompt(session(1, 1)), /2 von 2/);
  });

  it('says what to do once nothing is left to click', () => {
    assert.doesNotMatch(alignmentPrompt(session(2, 2)), /anklicken/);
  });
});

describe('alignmentPickCount', () => {
  it('counts every pick made so far', () => {
    assert.equal(alignmentPickCount(session(2, 1)), 3);
  });
});

describe('alignmentPairs', () => {
  it('pairs each plan point with its model point in order', () => {
    const pairs = alignmentPairs(session(2, 2));

    assert.ok(pairs);
    assert.deepEqual(pairs[0], { from: p(0), to: p(10) });
    assert.deepEqual(pairs[1], { from: p(1), to: p(11) });
  });

  it('gives nothing while the session is unfinished', () => {
    // Solving from a half-finished session would produce a placement from one
    // pair and a guess — which is exactly the trial and error this replaces.
    for (const s of [session(0, 0), session(1, 0), session(1, 1), session(2, 1)]) {
      assert.equal(alignmentPairs(s), null);
    }
  });
});
