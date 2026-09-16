/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The chain from a real file is the fixture, because the assumption this
 * replaces held for every synthetic model and failed on the first surveyed
 * one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStoreyFrame, storeyLocalToWorld, worldToStoreyLocal,
  isIdentityFrame, IDENTITY_STOREY_FRAME, type RawAttrs,
} from './storeyFrame.js';

/**
 * The Langmatt architecture model's storey chain, transcribed.
 *
 * storey #34 (identity) -> building #30 (identity) -> site #59, which carries
 * both the Swiss coordinates and `RefDirection = (0.98746437, -0.15784206, 0)`
 * — a turn of about nine degrees. That turn is the bug: a room written into
 * this frame as if it were the identity comes out nine degrees off.
 */
function langmatt(): RawAttrs {
  const ents: Record<number, unknown[]> = {
    // IfcBuildingStorey: [5] ObjectPlacement
    35: ['guid', '#18', 'U1', null, 'Level', '#34', null, 'U1', '.ELEMENT.', 0],
    34: ['#30', '#33'],
    33: ['#3', null, null],
    30: ['#59', '#29'],
    29: ['#3', null, null],
    59: [null, '#58'],
    58: ['#56', '#9', '#57'],
    56: [[2665486, 1259317.3499999996, 381.30000000000001]],
    3: [[0, 0, 0]],
    9: [[0, 0, 1]],
    57: [[0.98746437072186877, -0.15784206205844961, 0]],
  };
  return (id) => ents[id] ?? null;
}

const NINE_DEGREES = Math.atan2(-0.15784206205844961, 0.98746437072186877);

describe('resolveStoreyFrame', () => {
  it('finds the turn a surveyed model buries two links up the chain', () => {
    const frame = resolveStoreyFrame(langmatt(), 35);

    assert.ok(frame);
    assert.ok(Math.abs(frame.rotationRad - NINE_DEGREES) < 1e-12,
      `got ${frame.rotationRad}, expected ${NINE_DEGREES}`);
    assert.ok(Math.abs(frame.origin[0] - 2665486) < 1e-6);
    assert.ok(Math.abs(frame.origin[1] - 1259317.35) < 1e-6);
  });

  it('is about nine degrees — the angle the DXF needed too', () => {
    // Sanity in units a person can check: the same angle turned up when
    // fitting the survey plan onto this model.
    const frame = resolveStoreyFrame(langmatt(), 35)!;

    assert.ok(Math.abs((frame.rotationRad * 180) / Math.PI + 9.08) < 0.01);
  });

  it('round-trips a point through the frame and back', () => {
    const frame = resolveStoreyFrame(langmatt(), 35)!;
    const local: [number, number, number] = [12.5, -7.25, 0];

    const back = worldToStoreyLocal(frame, storeyLocalToWorld(frame, local));

    assert.ok(Math.hypot(back[0] - local[0], back[1] - local[1]) < 1e-6,
      `round trip landed at ${JSON.stringify(back)}`);
  });

  it('keeps a rectangle rectangular and the right size', () => {
    // A room is written as a profile. If the frame skewed or scaled it, every
    // area in the file would be wrong too.
    const frame = resolveStoreyFrame(langmatt(), 35)!;
    const a = storeyLocalToWorld(frame, [0, 0, 0]);
    const b = storeyLocalToWorld(frame, [6, 0, 0]);
    const c = storeyLocalToWorld(frame, [6, 4, 0]);

    assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 6) < 1e-9);
    assert.ok(Math.abs(Math.hypot(c[0] - b[0], c[1] - b[1]) - 4) < 1e-9);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    assert.ok(Math.abs(dot) < 1e-9, 'edges stopped being perpendicular');
  });

  it('adds the storey elevation into the frame', () => {
    const ents = langmatt();
    const withElevation: RawAttrs = (id) => (id === 33
      ? ['#36', null, null]
      : id === 36 ? [[0, 0, 3.6576]] : ents(id));

    assert.ok(Math.abs(resolveStoreyFrame(withElevation, 35)!.origin[2] - (381.3 + 3.6576)) < 1e-9);
  });

  it('gives the identity for a chain that is all identities', () => {
    const flat: RawAttrs = (id) => ({
      1: ['guid', null, 'S', null, null, '#2', null] as unknown[],
      2: [null, '#3'],
      3: ['#4', null, null],
      4: [[0, 0, 0]],
    } as Record<number, unknown[]>)[id] ?? null;

    const frame = resolveStoreyFrame(flat, 1);

    assert.ok(frame);
    assert.ok(isIdentityFrame(frame));
  });

  it('refuses a tilted axis rather than flattening it', () => {
    // A frame tilted off vertical, silently treated as upright, produces
    // output that is plausible and wrong — the failure this module exists to
    // end. `null` sends the caller to the identity WITH a warning.
    const ents = langmatt();
    const tilted: RawAttrs = (id) => (id === 9 ? [[0, 0.7071, 0.7071]] : ents(id));

    assert.equal(resolveStoreyFrame(tilted, 35), null);
  });

  it('refuses a RefDirection that leaves the XY plane', () => {
    const ents = langmatt();
    const tilted: RawAttrs = (id) => (id === 57 ? [[0.7071, 0, 0.7071]] : ents(id));

    assert.equal(resolveStoreyFrame(tilted, 35), null);
  });

  it('gives up on a chain that never ends instead of hanging', () => {
    const loop: RawAttrs = (id) => ({
      1: ['guid', null, 'S', null, null, '#2', null] as unknown[],
      2: ['#2', '#3'],
      3: ['#4', null, null],
      4: [[0, 0, 0]],
    } as Record<number, unknown[]>)[id] ?? null;

    assert.equal(resolveStoreyFrame(loop, 1), null);
  });

  it('answers null for an entity that is not there', () => {
    assert.equal(resolveStoreyFrame(() => null, 99), null);
  });
});

describe('the identity frame', () => {
  it('leaves a point exactly where it was', () => {
    const p: [number, number, number] = [3, -4, 5];

    assert.deepEqual(storeyLocalToWorld(IDENTITY_STOREY_FRAME, p), p);
    assert.deepEqual(worldToStoreyLocal(IDENTITY_STOREY_FRAME, p), p);
  });
});

describe('the pair the reshape handles use', () => {
  // Read one way, commit the other. This pair is what decides whether opening
  // the shape editor and closing it again leaves a room where it was — the
  // question that cost a day, and the answer that has to stay pinned.
  const FRAME = { origin: [2665486, 1259317.35, 381.3] as const, rotationRad: NINE_DEGREES };
  const SHIFT = { x: 2665490.9, y: 1259320.2 };

  function toDrawing(p: readonly [number, number]) {
    const world = storeyLocalToWorld(FRAME, [p[0], p[1], 0]);
    return { x: world[0] - SHIFT.x, y: -(world[1] - SHIFT.y) };
  }
  function toLocal(p: { x: number; y: number }): [number, number] {
    const local = worldToStoreyLocal(FRAME, [p.x + SHIFT.x, -p.y + SHIFT.y, 0]);
    return [local[0], local[1]];
  }

  it('returns a room outline unchanged when nothing was dragged', () => {
    const outline: Array<readonly [number, number]> = [
      [14.89, 10.06], [19.32, 10.06], [19.32, 17.68], [14.89, 17.68],
    ];

    for (const p of outline) {
      const back = toLocal(toDrawing(p));
      assert.ok(Math.hypot(back[0] - p[0], back[1] - p[1]) < 1e-6,
        `${JSON.stringify(p)} came back as ${JSON.stringify(back)}`);
    }
  });

  it('does not creep over repeated open-and-close', () => {
    // The failure mode that matters is not a jump, it is a drift nobody
    // notices until the room is metres from its walls.
    let p: [number, number] = [14.89, 10.06];
    for (let i = 0; i < 50; i += 1) p = toLocal(toDrawing(p));

    assert.ok(Math.hypot(p[0] - 14.89, p[1] - 10.06) < 1e-6,
      `after 50 round trips: ${JSON.stringify(p)}`);
  });
});
