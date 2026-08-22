/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWiringSlice, type WiringSlice } from './wiringSlice.js';

/** The slice on its own — no store, no React. */
function slice(): { get: () => WiringSlice } {
  let state = {} as WiringSlice;
  const set = (partial: Partial<WiringSlice> | ((s: WiringSlice) => Partial<WiringSlice>)) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...next };
  };
  state = createWiringSlice(set as never, () => state, {} as never);
  return { get: () => state };
}

describe('wiring draft', () => {
  it('keeps the clicks in order, because the order IS the cable', () => {
    const s = slice();
    s.get().pushWiringPick(900);
    s.get().pushWiringPick(11);
    s.get().pushWiringPick(10);
    assert.deepEqual(s.get().wiringSequence, [900, 11, 10]);
  });

  it('closes the run when the start is clicked again', () => {
    const s = slice();
    for (const id of [900, 10, 11]) s.get().pushWiringPick(id);
    s.get().pushWiringPick(900);
    assert.equal(s.get().wiringRing, true);
    // The controller is not a stop twice over.
    assert.deepEqual(s.get().wiringSequence, [900, 10, 11]);
  });

  it('does not close a run that has only its start', () => {
    const s = slice();
    s.get().pushWiringPick(900);
    s.get().pushWiringPick(900);
    assert.equal(s.get().wiringRing, false);
  });

  it('ignores a device already on this run', () => {
    // A detector cannot sit twice on one cable. Appending it would renumber
    // everything after it for a mis-click.
    const s = slice();
    for (const id of [900, 10, 11]) s.get().pushWiringPick(id);
    s.get().pushWiringPick(10);
    assert.deepEqual(s.get().wiringSequence, [900, 10, 11]);
  });

  it('re-opens the ring when the run grows again', () => {
    const s = slice();
    for (const id of [900, 10, 900]) s.get().pushWiringPick(id);
    assert.equal(s.get().wiringRing, true);
    s.get().pushWiringPick(11);
    assert.equal(s.get().wiringRing, false);
    assert.deepEqual(s.get().wiringSequence, [900, 10, 11]);
  });

  it('undoes the ring before it undoes a device', () => {
    // The last thing done was closing the loop, so that is the first thing
    // undone — otherwise one Backspace would silently drop a detector.
    const s = slice();
    for (const id of [900, 10, 11, 900]) s.get().pushWiringPick(id);
    s.get().popWiringPick();
    assert.equal(s.get().wiringRing, false);
    assert.deepEqual(s.get().wiringSequence, [900, 10, 11]);
    s.get().popWiringPick();
    assert.deepEqual(s.get().wiringSequence, [900, 10]);
  });

  it('survives an undo on an empty draft', () => {
    const s = slice();
    s.get().popWiringPick();
    assert.deepEqual(s.get().wiringSequence, []);
  });

  it('drops everything when the run is abandoned', () => {
    const s = slice();
    for (const id of [900, 10, 900]) s.get().pushWiringPick(id);
    s.get().setWiringHover(12);
    s.get().clearWiring();
    assert.deepEqual(s.get().wiringSequence, []);
    assert.equal(s.get().wiringRing, false);
    assert.equal(s.get().wiringHover, null);
  });
});
