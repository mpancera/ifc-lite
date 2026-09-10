/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Carrying room numbers across a re-derivation.
 *
 * The numbers are the part that cost somebody an afternoon, so the tests here
 * are about the ways a transfer can be WRONG rather than the way it is right:
 * an offset guessed from noise, a name landing on the room next door, a crowded
 * corner eating a name its neighbour needed. A transfer that silently puts the
 * right number on the wrong door is worse than one that refuses.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOffset, planRoomTransfer, type SourceRoom, type TargetRoom } from './match-rooms.js';

/** Two rows of rooms along a 76 m building — long enough that a few degrees
 *  of turn move the far end further than the rooms are apart. */
function terrace(n = 20): SourceRoom[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 200 + i,
    name: `T.${String(i + 1).padStart(2, '0')}`,
    longName: null,
    centre: [(i % 10) * 8, Math.floor(i / 10) * 6] as [number, number],
  }));
}

/** A grid of rooms 5 m apart, named by index. */
function grid(n: number, dx = 0, dy = 0): SourceRoom[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 100 + i,
    name: `R.${String(i + 1).padStart(2, '0')}`,
    longName: `Raum ${i + 1}`,
    centre: [dx + (i % 4) * 5, dy + Math.floor(i / 4) * 5] as [number, number],
  }));
}

/** The same rooms, turned about the set's own centre — what georeferencing
 *  one of two exports does to it. */
const asTurned = (rooms: SourceRoom[], deg: number, dx = 0, dy = 0): TargetRoom[] => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const mx = rooms.reduce((t, r) => t + r.centre[0], 0) / rooms.length;
  const my = rooms.reduce((t, r) => t + r.centre[1], 0) / rooms.length;
  return rooms.map((r, i) => {
    const ex = r.centre[0] - mx, ey = r.centre[1] - my;
    return { id: 900 + i, centre: [mx + ex * c - ey * s + dx, my + ex * s + ey * c + dy] as [number, number] };
  });
};

const asTargets = (rooms: SourceRoom[], dx: number, dy: number, jitter = 0): TargetRoom[] =>
  rooms.map((r, i) => ({
    id: 900 + i,
    centre: [
      r.centre[0] + dx + (jitter ? ((i % 3) - 1) * jitter : 0),
      r.centre[1] + dy + (jitter ? ((i % 2) - 0.5) * jitter : 0),
    ] as [number, number],
  }));

describe('findOffset', () => {
  it('recovers the translation the two models differ by', () => {
    const src = grid(12);
    const tgt = asTargets(src, -3.5, -7);
    const found = findOffset(src, tgt);
    assert.ok(found, 'twelve agreeing pairs are enough to decide');
    assert.ok(Math.abs(found.offset[0] + 3.5) < 1e-9, `dx ${found.offset[0]}`);
    assert.ok(Math.abs(found.offset[1] + 7) < 1e-9, `dy ${found.offset[1]}`);
    assert.equal(found.votes, 12, 'every pair should have voted for it');
  });

  it('survives rooms that moved in the remodel', () => {
    // Two of twelve rooms were rebuilt somewhere else. They vote for their own
    // wrong translations — once each — and are outvoted.
    const src = grid(12);
    const tgt = asTargets(src, -3.5, -7);
    tgt[2].centre = [40, 40];
    tgt[7].centre = [-30, 12];
    const found = findOffset(src, tgt);
    assert.ok(found);
    assert.ok(Math.hypot(found.offset[0] + 3.5, found.offset[1] + 7) < 0.3, `offset ${found.offset}`);
  });

  it('is decided by the rooms, not by the tallest bin', () => {
    // Rooms move a metre or two between two states of a building, which spreads
    // the correct translation over several bins and can leave a tall bin
    // holding a couple of coincidences. On the real case that raw peak was 5 m
    // wrong. Refining each candidate against all the rooms is what settles it.
    const src = grid(12);
    const tgt = asTargets(src, -3.5, -7, 0.9);
    const found = findOffset(src, tgt);
    assert.ok(found);
    assert.ok(Math.hypot(found.offset[0] + 3.5, found.offset[1] + 7) < 0.6, `offset ${found.offset}`);
    assert.ok(found.votes >= 10, `should rest on most of the rooms, rested on ${found.votes}`);
  });

  it('refuses rather than inventing an offset from a single pair', () => {
    const src = grid(1);
    const tgt = asTargets(src, 2, 2);
    assert.equal(findOffset(src, tgt), null, 'one pair agreeing with itself is not evidence');
  });
});

describe('planRoomTransfer', () => {
  it('puts every name on its own room', () => {
    const src = grid(12);
    const tgt = asTargets(src, -3.5, -7, 0.15); // rooms shifted a little by the remodel
    const plan = planRoomTransfer(src, tgt);
    assert.ok(plan);
    assert.equal(plan.matched.length, 12);
    assert.equal(plan.ambiguous.length, 0);
    assert.equal(plan.unmatchedTargets.length, 0);
    assert.equal(plan.unusedSources.length, 0);
    for (const m of plan.matched) {
      assert.equal(m.target - 900, m.source - 100, `${m.source} landed on ${m.target}`);
    }
  });

  it('leaves a room out rather than reaching across the building for a name', () => {
    const src = grid(12);
    const tgt = asTargets(src, -3.5, -7);
    tgt.push({ id: 999, centre: [60, 60] }); // a room the old model never had
    const plan = planRoomTransfer(src, tgt);
    assert.ok(plan);
    assert.deepEqual(plan.unmatchedTargets, [999], 'the new room gets no name, not a far-away one');
    assert.equal(plan.matched.length, 12);
  });

  it('reports a near-tie instead of picking one', () => {
    // Two sources almost on top of each other: whichever wins, the other was
    // nearly as good, and that is exactly when a wrong number goes unnoticed.
    const src: SourceRoom[] = [
      { id: 1, name: 'A.01', longName: null, centre: [0, 0] },
      { id: 2, name: 'A.02', longName: null, centre: [0.4, 0] },
      { id: 3, name: 'A.03', longName: null, centre: [20, 0] },
      { id: 4, name: 'A.04', longName: null, centre: [40, 0] },
    ];
    const tgt: TargetRoom[] = [
      { id: 11, centre: [0.18, 0] }, // 0.18 from A.01, 0.22 from A.02 — ratio 1.2
      { id: 13, centre: [20, 0] },
      { id: 14, centre: [40, 0] },
    ];
    const plan = planRoomTransfer(src, tgt, { offset: [0, 0] });
    assert.ok(plan);
    assert.equal(plan.ambiguous.length, 1, 'the crowded pair must be flagged');
    assert.equal(plan.ambiguous[0].target, 11);
    assert.ok(plan.matched.every((m) => m.target !== 11), 'and not also applied');
  });

  it('finds the turn a georeferenced export baked in', () => {
    // Nine degrees is invisible on screen and moves the far end of a plan
    // further than the rooms are apart, so without it every name lands on a
    // stranger. The axis measurement says 9.6°; the plan says which way.
    const src = terrace();
    const tgt = asTurned(src, 9.6, -3.5, -7);
    const flat = planRoomTransfer(src, tgt);
    const turned = planRoomTransfer(src, tgt, { rotations: [0, 9.6, -9.6] });
    assert.ok(turned);
    assert.equal(turned.rotationDeg, 9.6);
    const ownRoom = (p: NonNullable<typeof turned>) =>
      p.matched.filter((m) => m.target - 900 === m.source - 200).length;
    assert.equal(turned.matched.length, 20, 'every room, once the turn is undone');
    assert.equal(ownRoom(turned), 20, 'and each on its own room');
    // Without the turn the middle of the plan still matches, so the transfer
    // looks like it half worked — while four of the names it did place sit on
    // the wrong door. That is the failure worth preventing, not the misses.
    assert.ok(flat && flat.matched.length - ownRoom(flat) >= 3,
      'a translation alone should be putting names on strangers');
  });

  it('throws out a quarter turn that lays the plan across itself', () => {
    // An axis is only known modulo 90°, so 9.6° and 99.6° are the same
    // measurement. Only one of them is the building.
    const src = terrace();
    const tgt = asTurned(src, 9.6, 4, 4);
    const plan = planRoomTransfer(src, tgt, { rotations: [9.6, 99.6, -80.4] });
    assert.ok(plan);
    assert.equal(plan.rotationDeg, 9.6);
  });

  it('will not let one target take a name another target is closer to', () => {
    // Greedy nearest-first would give R.01 to the target nearest it and then
    // hand R.02 to the one that R.01 actually belonged to. Mutual-nearest
    // refuses the pair instead of shifting the whole sequence by one.
    const src: SourceRoom[] = [
      { id: 1, name: 'R.01', longName: null, centre: [0, 0] },
      { id: 2, name: 'R.02', longName: null, centre: [10, 0] },
    ];
    const tgt: TargetRoom[] = [{ id: 11, centre: [3, 0] }];
    const plan = planRoomTransfer(src, tgt, { offset: [0, 0] });
    assert.ok(plan);
    const all = [...plan.matched, ...plan.ambiguous];
    assert.ok(all.every((m) => m.source !== 2), 'R.02 must not travel to a room nearer R.01');
    assert.deepEqual(plan.unusedSources.includes(2), true, 'and is reported as unplaced');
  });
});
