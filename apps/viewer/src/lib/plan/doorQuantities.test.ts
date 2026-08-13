/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { doorQuantities, ASSUMED_LINING_THICKNESS } from './doorQuantities.js';

const round = (n: number | null) => (n === null ? null : Math.round(n * 1e6) / 1e6);

/** A 1.00 × 2.10 opening with a 5 cm frame and a 4 cm leaf. */
const door = {
  nominalWidth: 1,
  nominalHeight: 2.1,
  liningThickness: 0.05,
  panelDepth: 0.04,
};

describe('doorQuantities', () => {
  it('carries the nominal size through as the rough opening', () => {
    const q = doorQuantities(door)!;
    assert.equal(q.nominalWidth, 1);
    assert.equal(q.nominalHeight, 2.1);
  });

  it('takes the frame off BOTH sides for the clear width', () => {
    // Lichte Breite = Nennbreite − 2 × Rahmenbreite.
    assert.equal(round(doorQuantities(door)!.clearWidth), 0.9);
  });

  it('takes the frame off ONCE for the clear height — there is no frame underfoot', () => {
    // Lichte Höhe = Nennhöhe − Rahmenbreite.
    assert.equal(round(doorQuantities(door)!.clearHeight), 2.05);
  });

  it('takes the leaf off as well for the passage width', () => {
    // Durchgangsbreite = Lichte Breite − Blattdicke. The leaf still stands in
    // the opening when the door is open.
    assert.equal(round(doorQuantities(door)!.passageWidth), 0.86);
  });

  it('takes the leaf off TWICE for a two-leaf door', () => {
    const q = doorQuantities({ ...door, leaves: 2 })!;
    assert.equal(q.leaves, 2);
    assert.equal(round(q.passageWidth), 0.82);
  });

  it('subtracts a threshold from the passage height, and nothing when there is none', () => {
    assert.equal(round(doorQuantities({ ...door, thresholdThickness: 0.02 })!.passageHeight), 2.03);
    assert.equal(round(doorQuantities(door)!.passageHeight), 2.05);
  });

  it('assumes a frame, and says so, when the model states none', () => {
    const q = doorQuantities({ nominalWidth: 1 })!;
    assert.equal(q.liningThickness, ASSUMED_LINING_THICKNESS);
    assert.equal(q.liningSource, 'assumed');
  });

  it('says the frame was read when it was', () => {
    assert.equal(doorQuantities(door)!.liningSource, 'model');
  });

  it('draws the frame as deep as the WALL, not as deep as the frame', () => {
    // LiningDepth runs past the plaster on a real model. Truthful in 3D, and
    // in plan it puts frame outside the wall.
    const q = doorQuantities({ ...door, liningDepth: 0.4, measuredDepth: 0.19 })!;
    assert.equal(q.liningDepth, 0.19);
  });

  it('falls back to the stated depth when nothing was measured', () => {
    assert.equal(doorQuantities({ ...door, liningDepth: 0.4 })!.liningDepth, 0.4);
  });

  it('refuses to let a stated frame eat the doorway', () => {
    // 0.6 m of frame in a 0.8 m opening leaves −0.4 m of passage, which is not
    // a door. Capped at a fifth, so something readable is still drawn.
    const q = doorQuantities({ nominalWidth: 0.8, liningThickness: 0.6 })!;
    assert.equal(round(q.liningThickness), 0.16);
    assert.ok(q.clearWidth > 0);
  });

  it('never reports a negative passage', () => {
    const q = doorQuantities({ nominalWidth: 0.8, panelDepth: 5 })!;
    assert.equal(q.passageWidth, 0);
  });

  it('measures the opening when the model states no nominal width', () => {
    const q = doorQuantities({ measuredWidth: 0.92 })!;
    assert.equal(q.nominalWidth, 0.92);
  });

  it('has nothing to derive without any width at all', () => {
    assert.equal(doorQuantities({}), null);
    assert.equal(doorQuantities({ nominalWidth: 0, measuredWidth: 0 }), null);
  });

  it('leaves the heights null rather than inventing them', () => {
    const q = doorQuantities({ nominalWidth: 1 })!;
    assert.equal(q.nominalHeight, null);
    assert.equal(q.clearHeight, null);
    assert.equal(q.passageHeight, null);
  });

  it('keeps the frame size the model states, distinct from the frame member', () => {
    // "Rahmenbreite" names both in the trade; they are different numbers.
    const q = doorQuantities({ ...door, frameWidth: 1.04, frameHeight: 2.12 })!;
    assert.equal(q.frameWidth, 1.04);
    assert.equal(q.frameHeight, 2.12);
    assert.equal(q.liningThickness, 0.05);
  });
});
