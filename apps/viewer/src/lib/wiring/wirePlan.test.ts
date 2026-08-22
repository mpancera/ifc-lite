/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextRunName, planWiring, wireMark } from './wirePlan.js';

/** Controller 900, then three detectors. */
const RUN = [900, 10, 11, 12];

describe('planWiring', () => {
  it('numbers the devices by their position on the cable', () => {
    // The counter IS the position. A device's mark cannot be read off
    // anything but the run it sits on.
    const plan = planWiring({ sequence: RUN, circuitName: 'MK01' });
    assert.deepEqual(plan.stops.map((s) => s.mark), ['MK01.01', 'MK01.02', 'MK01.03']);
    assert.deepEqual(plan.stops.map((s) => s.expressId), [10, 11, 12]);
  });

  it('takes the first entry as the controller and does not number it', () => {
    const plan = planWiring({ sequence: RUN, circuitName: 'MK01' });
    assert.equal(plan.controllerId, 900);
    assert.equal(plan.stops.some((s) => s.expressId === 900), false);
  });

  it('lays one hop per length of cable, controller first', () => {
    const plan = planWiring({ sequence: RUN, circuitName: 'MK01' });
    assert.deepEqual(plan.hops, [
      { fromExpressId: 900, toExpressId: 10 },
      { fromExpressId: 10, toExpressId: 11 },
      { fromExpressId: 11, toExpressId: 12 },
    ]);
    assert.equal(plan.ring, false);
  });

  it('reads a closing click on the controller as a ring', () => {
    // Nobody declares ring-or-stub up front; the sequence says it.
    const plan = planWiring({ sequence: [...RUN, 900], circuitName: 'MK01' });
    assert.equal(plan.ring, true);
    assert.deepEqual(plan.stops.map((s) => s.expressId), [10, 11, 12]);
    // The return leg is a real length of cable and is written as one.
    assert.deepEqual(plan.hops[plan.hops.length - 1], { fromExpressId: 12, toExpressId: 900 });
  });

  it('does not number the controller again on a ring', () => {
    const plan = planWiring({ sequence: [...RUN, 900], circuitName: 'MK01' });
    assert.equal(plan.stops.length, 3);
  });

  it('reports a device clicked twice instead of wiring it twice', () => {
    // A detector on two lines is a real fault at the panel. Only the person
    // who clicked can say which one was meant.
    const plan = planWiring({ sequence: [900, 10, 11, 10], circuitName: 'MK01' });
    assert.deepEqual(plan.conflicts, [10]);
    assert.deepEqual(plan.stops.map((s) => s.expressId), [10, 11]);
  });

  it('reports a device that is already on another run', () => {
    const plan = planWiring({
      sequence: RUN,
      circuitName: 'MK02',
      alreadyWired: new Set([11]),
    });
    assert.deepEqual(plan.conflicts, [11]);
    // And the numbering closes the gap rather than leaving a hole: the run
    // that gets written has two devices, first and second.
    assert.deepEqual(plan.stops.map((s) => s.mark), ['MK02.01', 'MK02.02']);
  });

  it('refuses a sequence that cannot be a run', () => {
    assert.throws(() => planWiring({ sequence: [900], circuitName: 'MK01' }), /needs a controller/);
  });

  it('treats a two-entry sequence as a stub, not a ring', () => {
    // `[900, 900]` would be a ring of nothing; `[900, 10]` is one device.
    const plan = planWiring({ sequence: [900, 10], circuitName: 'MK01' });
    assert.equal(plan.ring, false);
    assert.deepEqual(plan.stops.map((s) => s.expressId), [10]);
  });
});

describe('wireMark', () => {
  it('pads to two digits so marks sort the way they read', () => {
    assert.equal(wireMark('MK01', 3), 'MK01.03');
    assert.equal(wireMark('MK01', 12), 'MK01.12');
  });
});

describe('nextRunName', () => {
  it('continues past the highest run in use', () => {
    assert.equal(nextRunName(['MK01', 'MK02']), 'MK03');
  });

  it('ignores names that are not runs', () => {
    // The zones are called MZ01… and share the shape. A run must never take
    // its number from one.
    assert.equal(nextRunName(['MZ07', 'Meldelinie L1', 'MK01']), 'MK02');
  });

  it('starts at one when nothing is wired', () => {
    assert.equal(nextRunName([]), 'MK01');
  });
});
