/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { boundsOf, centreOn } from './planFocus.js';
import { planScreenToDrawing } from './planPick.js';

describe('boundsOf', () => {
  it('is null for nothing, so a caller cannot centre on an empty set', () => {
    assert.equal(boundsOf([]), null);
  });

  it('finds the middle of what it was given', () => {
    const b = boundsOf([{ x: 0, y: 0 }, { x: 4, y: 10 }])!;
    assert.deepEqual(b.centre, { x: 2, y: 5 });
  });
});

describe('centreOn', () => {
  const view = { width: 800, height: 600 };

  it('puts the point in the middle of the view', () => {
    const t = centreOn({ x: 0, y: 0, scale: 20 }, { x: 3, y: -2 }, view.width, view.height);
    // Round trip through the pick mapping: the centre pixel must map back to
    // the point asked for, which is the only definition of "centred" that the
    // rest of the plan agrees with.
    const back = planScreenToDrawing(view.width / 2, view.height / 2, t);
    assert.ok(Math.abs(back.x - 3) < 1e-9);
    assert.ok(Math.abs(back.y + 2) < 1e-9);
  });

  it('leaves the zoom alone', () => {
    const t = centreOn({ x: 11, y: 22, scale: 7.5 }, { x: 1, y: 1 }, view.width, view.height);
    assert.equal(t.scale, 7.5);
  });

  it('centres a turned drawing too', () => {
    const rotation = Math.PI / 4;
    const t = centreOn({ x: 0, y: 0, scale: 12, rotation }, { x: 5, y: 9 }, view.width, view.height);
    const back = planScreenToDrawing(view.width / 2, view.height / 2, t);
    assert.ok(Math.abs(back.x - 5) < 1e-9, `x ${back.x}`);
    assert.ok(Math.abs(back.y - 9) < 1e-9, `y ${back.y}`);
  });
});
