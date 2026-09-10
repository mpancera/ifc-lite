/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The numbers in the georeferenced case are taken from the file that exposed
 * the defect: a site placement carrying a national-grid origin and a 9.08°
 * rotation, under which every baked room landed about 31 m from the building.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { storeyPlanFrame, toStoreyLocal, fromStoreyLocal, isIdentity, type ReadAttrs } from './room-frame.js';

/** A store as `readAttributes` sees it: express id → attribute array. */
const store = (entities: Record<number, readonly unknown[]>): ReadAttrs =>
  (id) => entities[id] ?? null;

/** Storey #43 on building #30 on site #59, the shape a Revit export writes. */
function georeferenced(refDirection: readonly number[] | null = [0.98746437072186877, -0.15784206205844961, 0]) {
  return store({
    43: ['guid', 18, '00', null, null, '#42', null, '00', '.ELEMENT.', 4.4196],
    42: ['#30', '#41'],
    41: ['#40', null, null],
    40: [[0, 0, 4.4196]],
    30: ['#59', '#29'],
    29: ['#3', null, null],
    3: [[0, 0, 0]],
    59: [null, '#58'],
    58: refDirection ? ['#56', '#9', '#57'] : ['#56', '#9', null],
    56: [[2665486, 1259317.3499999996, 381.3]],
    9: [[0, 0, 1]],
    57: [refDirection ?? [1, 0, 0]],
  });
}

const RTC = { x: 2665510.356767633, y: 1259339.3384696273 };

describe('storeyPlanFrame', () => {
  it('folds the whole chain, not just the storey', () => {
    const frame = storeyPlanFrame(georeferenced(), 43);
    assert.ok(frame);
    // The storey and building add nothing in plan; the site adds everything.
    assert.ok(Math.abs(frame.tx - 2665486) < 1e-6, `tx ${frame.tx}`);
    assert.ok(Math.abs(frame.ty - 1259317.35) < 1e-6, `ty ${frame.ty}`);
    assert.ok(Math.abs(Math.atan2(frame.sin, frame.cos) * 180 / Math.PI + 9.0817) < 1e-3,
      `turn ${Math.atan2(frame.sin, frame.cos) * 180 / Math.PI}°`);
  });

  it('is the identity for a model that is not georeferenced', () => {
    const flat = store({
      43: ['guid', 18, '00', null, null, '#42', null, '00', '.ELEMENT.', 0],
      42: [null, '#41'], 41: ['#40', null, null], 40: [[0, 0, 0]],
    });
    const frame = storeyPlanFrame(flat, 43);
    assert.ok(frame);
    assert.deepEqual([frame.cos, frame.sin, frame.tx, frame.ty], [1, 0, 0, 0]);
    assert.equal(isIdentity(frame, { x: 0, y: 0 }), true,
      'with no RTC either, the room frame IS the storey frame — nothing to fold');
  });

  it('refuses a placement that tips out of plan', () => {
    const tilted = georeferenced();
    const leaning = store({ 9: [[0, 0.7071, 0.7071]] });
    const read: ReadAttrs = (id) => (id === 9 ? leaning(9) : tilted(id));
    assert.equal(storeyPlanFrame(read, 43), null, 'no honest 2D inverse for a tilted storey');
  });

  it('refuses rather than guessing at a chain it cannot read', () => {
    assert.equal(storeyPlanFrame(store({}), 43), null);
    assert.equal(storeyPlanFrame(store({ 43: ['guid', 18, '00', null, null, null] }), 43), null,
      'a storey with no placement');
  });

  it('does not spin forever on a placement chain that loops', () => {
    const looped = store({
      43: ['guid', 18, '00', null, null, '#42'],
      42: ['#42', '#41'], 41: ['#40', null, null], 40: [[0, 0, 0]],
    });
    const frame = storeyPlanFrame(looped, 43);
    assert.ok(frame, 'it stops and answers rather than hanging');
  });
});

describe('toStoreyLocal', () => {
  it('undoes exactly what the file will do to the outline', () => {
    const frame = storeyPlanFrame(georeferenced(), 43)!;
    const local: [number, number] = [27.794224282032729, 9.6729318287925405];
    // Forward: what the file does when it reads the outline back.
    const world: [number, number] = [
      frame.cos * local[0] - frame.sin * local[1] + frame.tx,
      frame.sin * local[0] + frame.cos * local[1] + frame.ty,
    ];
    const room: [number, number] = [world[0] - RTC.x, world[1] - RTC.y];
    const back = toStoreyLocal(frame, RTC, room);
    assert.ok(Math.hypot(back[0] - local[0], back[1] - local[1]) < 1e-9,
      `round trip landed at ${back}, wanted ${local}`);
  });

  it('is what stands between a room and 31 metres of error', () => {
    // The room as Space Sketch drew it, in the room frame. Writing it into the
    // storey-local slot unchanged is the defect: the file then applies the
    // chain a second time.
    const frame = storeyPlanFrame(georeferenced(), 43)!;
    const room: [number, number] = [-15.182597700757995, 1.2042158194896864];
    const corrected = toStoreyLocal(frame, RTC, room);
    const wrongWorld = [
      frame.cos * room[0] - frame.sin * room[1] + frame.tx,
      frame.sin * room[0] + frame.cos * room[1] + frame.ty,
    ];
    const strayed = Math.hypot(wrongWorld[0] - (room[0] + RTC.x), wrongWorld[1] - (room[1] + RTC.y));
    assert.ok(strayed > 30 && strayed < 32, `the uncorrected point strays ${strayed.toFixed(1)} m`);
    // And the corrected one comes back to where the tool drew it.
    const world = [
      frame.cos * corrected[0] - frame.sin * corrected[1] + frame.tx,
      frame.sin * corrected[0] + frame.cos * corrected[1] + frame.ty,
    ];
    assert.ok(Math.hypot(world[0] - (room[0] + RTC.x), world[1] - (room[1] + RTC.y)) < 1e-9);
  });

  it('goes both ways, because the tool reads its own rooms back', () => {
    // Reading back is how a room already there is noticed instead of having a
    // second one laid on top of it — and the file hands it back storey-locally.
    const frame = storeyPlanFrame(georeferenced(), 43)!;
    const room: [number, number] = [-15.182597700757995, 1.2042158194896864];
    const there = toStoreyLocal(frame, RTC, room);
    const back = fromStoreyLocal(frame, RTC, there);
    assert.ok(Math.hypot(back[0] - room[0], back[1] - room[1]) < 1e-9,
      `round trip landed at ${back}, wanted ${room}`);
  });

  it('leaves a model without georeferencing exactly where it was', () => {
    const frame = { cos: 1, sin: 0, tx: 0, ty: 0 };
    const p: [number, number] = [3.5, -7.25];
    assert.deepEqual(toStoreyLocal(frame, { x: 0, y: 0 }, p), p);
  });
});
