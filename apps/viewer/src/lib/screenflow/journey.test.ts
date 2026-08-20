/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { journeyOutline } from './journey';
import { SCREENFLOW_REGISTRY } from './registry';

describe('journeyOutline', () => {
  it('is the five steps of the journey, in order', () => {
    const steps = journeyOutline();
    assert.deepEqual(steps.map((s) => s.number), [1, 2, 3, 4, 5]);
  });

  it('leaves the sample clip out — it is not a step', () => {
    // Number 0 proved the machinery. Listing it would claim a sixth step and
    // offer a start button for something the journey does not contain.
    const ids = journeyOutline().map((s) => s.clipId);
    const sample = SCREENFLOW_REGISTRY.find((c) => c.number === 0);
    assert.ok(sample, 'the fixture assumes a number-0 sample exists');
    assert.equal(ids.includes(sample.id), false);
  });

  it('offers a clip to start exactly where one exists', () => {
    for (const step of journeyOutline()) {
      if (step.state === 'planned') {
        assert.equal(step.clipId, null, `step ${step.number}: planned but names a clip`);
        assert.ok(step.needsDe, `step ${step.number}: planned without saying what it needs`);
      } else {
        assert.ok(step.clipId, `step ${step.number}: ready but nothing to start`);
        assert.equal(step.needsDe, null);
      }
    }
  });

  it('gives every step something to read', () => {
    for (const step of journeyOutline()) {
      assert.ok(step.titleDe.length > 0, `step ${step.number}: no title`);
      assert.ok(step.subtitleDe.length > 0, `step ${step.number}: no subtitle`);
    }
  });

  it('grows with the registry rather than being kept by hand', () => {
    // The guard against a second, hand-maintained copy of the plan: every
    // built strand has to show up as its own number.
    for (const clip of SCREENFLOW_REGISTRY) {
      if (clip.number < 1) continue;
      const step = journeyOutline().find((s) => s.number === clip.number);
      assert.equal(step?.clipId, clip.id, `strand ${clip.number} is not in the journey`);
    }
  });
});
