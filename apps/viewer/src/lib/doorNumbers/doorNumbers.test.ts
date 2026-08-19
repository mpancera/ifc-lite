/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDoorNumbers, stepsToSafety,
  type NumberingDoor, type NumberingRoom,
} from './doorNumbers.js';

const room = (id: number, number: string, x: number, y: number, safe = false): NumberingRoom =>
  ({ id, number, centre: { x, y }, safe });

const door = (
  id: number, x: number, y: number,
  a: number | null, b: number | null, opensInto?: number | null,
): NumberingDoor => ({ id, centre: { x, y }, sides: [a, b], opensInto });

/**
 * A plan that has one of each: a corridor with the way out, two rooms off it,
 * and a store room behind one of them.
 *
 *   outside ─ [1 corridor] ─ [2 office] ─ [4 store]
 *                  └──────── [3 wc]
 */
function floor() {
  const rooms = [
    room(1, '1.01', 0, 0),
    room(2, '1.02', 10, 0),
    room(3, '1.03', 0, -10),
    room(4, '1.04', 20, 0),
  ];
  const doors = [
    door(10, -5, 0, 1, null),   // corridor to outside
    door(11, 5, 0, 1, 2),       // corridor to office
    door(12, 0, -5, 1, 3),      // corridor to wc
    door(13, 15, 0, 2, 4),      // office to store
  ];
  return { rooms, doors };
}

describe('stepsToSafety', () => {
  it('counts the doors left to pass, outwards from the way out', () => {
    const { rooms, doors } = floor();
    const steps = stepsToSafety(rooms, doors);
    assert.equal(steps.get(1), 1, 'the corridor has the exit door');
    assert.equal(steps.get(2), 2);
    assert.equal(steps.get(3), 2);
    assert.equal(steps.get(4), 3, 'the store room is deepest');
  });

  it('treats a stairwell as safety itself', () => {
    const rooms = [room(1, '1.01', 0, 0, true), room(2, '1.02', 10, 0)];
    const steps = stepsToSafety(rooms, [door(10, 5, 0, 1, 2)]);
    assert.equal(steps.get(1), 0);
    assert.equal(steps.get(2), 1);
  });

  it('leaves a room nothing connects to out, rather than calling it far away', () => {
    const rooms = [room(1, '1.01', 0, 0), room(9, '1.09', 99, 99)];
    const steps = stepsToSafety(rooms, [door(10, -5, 0, 1, null)]);
    assert.equal(steps.has(9), false);
  });
});

describe('planDoorNumbers', () => {
  it('numbers a door after the room you flee FROM', () => {
    const { rooms, doors } = floor();
    const { numbers } = planDoorNumbers(rooms, doors);
    const byDoor = new Map(numbers.map((n) => [n.doorId, n]));

    // Office (2 steps) to corridor (1 step): you leave the office.
    assert.equal(byDoor.get(11)?.roomId, 2);
    assert.equal(byDoor.get(11)?.number, '1.02.T1');
    assert.equal(byDoor.get(11)?.basis, 'escape');
  });

  it('numbers a dead end after the room you go INTO', () => {
    // Same rule, seen from the other end: the store room is further out than
    // the office, so the door between them belongs to the store room.
    const { rooms, doors } = floor();
    const byDoor = new Map(planDoorNumbers(rooms, doors).numbers.map((n) => [n.doorId, n]));
    assert.equal(byDoor.get(13)?.roomId, 4);
    assert.equal(byDoor.get(13)?.number, '1.04.T1');
  });

  it('does not number a corridor after itself while rooms hang off it', () => {
    // The corridor is nearer the way out than everything it serves, so its
    // only door is the one leading outside.
    const { rooms, doors } = floor();
    const mine = planDoorNumbers(rooms, doors).numbers.filter((n) => n.roomId === 1);
    assert.deepEqual(mine.map((n) => n.doorId), [10]);
    assert.equal(mine[0].number, '1.01.T1');
    assert.equal(mine[0].basis, 'exterior');
  });

  it('counts several doors of one room clockwise from north', () => {
    const rooms = [room(1, '2.01', 0, 0, true), room(2, '2.02', 0, 0)];
    const doors = [
      door(10, 0, 5, 2, 1),    // north
      door(11, 5, 0, 2, 1),    // east
      door(12, 0, -5, 2, 1),   // south
      door(13, -5, 0, 2, 1),   // west
    ];
    // Room 2 is further from safety, so all four are its doors.
    const { numbers } = planDoorNumbers(rooms, doors);
    const order = [...numbers].sort((a, b) => a.number.localeCompare(b.number)).map((n) => n.doorId);
    assert.deepEqual(order, [10, 11, 12, 13], 'N, E, S, W');
    assert.deepEqual(numbers.map((n) => n.number),
      ['2.02.T1', '2.02.T2', '2.02.T3', '2.02.T4']);
  });

  it('falls back to the room the leaf swings into when both sides are equal', () => {
    // Two corridors of the same depth: no flight direction between them.
    const rooms = [room(1, '3.01', 0, 0), room(2, '3.02', 10, 0), room(3, '3.03', 5, 10, true)];
    const doors = [
      door(10, 2, 5, 1, 3),
      door(11, 8, 5, 2, 3),
      door(12, 5, 0, 1, 2, 2),   // between the two, swings into room 2
    ];
    const byDoor = new Map(planDoorNumbers(rooms, doors).numbers.map((n) => [n.doorId, n]));
    assert.equal(byDoor.get(12)?.roomId, 2);
    assert.equal(byDoor.get(12)?.basis, 'swing');
  });

  it('reports a door it cannot decide instead of inventing a number', () => {
    const rooms = [room(1, '3.01', 0, 0), room(2, '3.02', 10, 0), room(3, '3.03', 5, 10, true)];
    const doors = [
      door(10, 2, 5, 1, 3),
      door(11, 8, 5, 2, 3),
      door(12, 5, 0, 1, 2),      // equal, and no swing stated
    ];
    const { numbers, problems } = planDoorNumbers(rooms, doors);
    assert.equal(numbers.some((n) => n.doorId === 12), false);
    assert.deepEqual(problems, [{ doorId: 12, reason: 'no-direction' }]);
  });

  it('lets a chosen room outrank the derivation, both ways', () => {
    // The one thing the graph cannot know: which side of a through-door the
    // number belongs on when the plan says one thing and the building another.
    const { rooms, doors } = floor();
    const chosen = new Map([[11, 1]]);   // door 11 named after the corridor
    const byDoor = new Map(
      planDoorNumbers(rooms, doors, chosen).numbers.map((n) => [n.doorId, n]),
    );
    assert.equal(byDoor.get(11)?.roomId, 1);
    assert.equal(byDoor.get(11)?.basis, 'manual');
    assert.equal(byDoor.get(11)?.otherRoomId, 2, 'the other side is still known');
    // And it renumbers the room it was taken off: the office keeps only the
    // door it still has.
    assert.equal(byDoor.get(13)?.number, '1.04.T1');
  });

  it('ignores a choice that names a room the door does not touch', () => {
    // A stale choice — the door was redrawn, or the rooms were replaced —
    // must not name a door after a room on the other side of the building.
    const { rooms, doors } = floor();
    const byDoor = new Map(
      planDoorNumbers(rooms, doors, new Map([[11, 999]])).numbers.map((n) => [n.doorId, n]),
    );
    assert.equal(byDoor.get(11)?.roomId, 2, 'falls back to the derived answer');
    assert.equal(byDoor.get(11)?.basis, 'escape');
  });

  it('settles a door the rule could not, once somebody picks a side', () => {
    const rooms = [room(1, '3.01', 0, 0), room(2, '3.02', 10, 0), room(3, '3.03', 5, 10, true)];
    const doors = [
      door(10, 2, 5, 1, 3),
      door(11, 8, 5, 2, 3),
      door(12, 5, 0, 1, 2),      // equal, no swing — reported without a choice
    ];
    assert.deepEqual(planDoorNumbers(rooms, doors).problems, [{ doorId: 12, reason: 'no-direction' }]);

    const settled = planDoorNumbers(rooms, doors, new Map([[12, 1]]));
    assert.deepEqual(settled.problems, []);
    const picked = settled.numbers.find((n) => n.doorId === 12);
    // Room 3.01 already owns the door to the stairwell, so the chosen one
    // takes the next counter rather than stealing T1 — the count is per room,
    // not per decision.
    assert.equal(picked?.number, '3.01.T2');
    assert.equal(picked?.basis, 'manual');
  });

  it('reports a door whose room has no number yet', () => {
    const rooms = [room(1, '', 0, 0)];
    const { numbers, problems } = planDoorNumbers(rooms, [door(10, -5, 0, 1, null)]);
    assert.deepEqual(numbers, []);
    assert.deepEqual(problems, [{ doorId: 10, reason: 'room-has-no-number' }]);
  });

  it('will not build a number on a name the generator invented', () => {
    // Found on the real floor: rooms still called "Space" or "12.Space" made
    // six doors of six different rooms all come out as "Space.T1" — a number
    // that looks finished and names nothing. Same definition of "not named
    // yet" that Clean Rooms lists as an open finding.
    for (const placeholder of ['Space', '12.Space', 'Space 12', 'Raum 3', '1.99']) {
      const rooms = [room(1, placeholder, 0, 0)];
      const { numbers, problems } = planDoorNumbers(rooms, [door(10, -5, 0, 1, null)]);
      assert.deepEqual(numbers, [], placeholder);
      assert.deepEqual(problems, [{ doorId: 10, reason: 'room-has-no-number' }], placeholder);
    }
  });

  it('reports a door that sits in no room at all', () => {
    const { problems } = planDoorNumbers([], [door(10, 0, 0, null, null)]);
    assert.deepEqual(problems, [{ doorId: 10, reason: 'no-room' }]);
  });

  it('gives the same answer whatever order the doors arrive in', () => {
    const { rooms, doors } = floor();
    const forwards = planDoorNumbers(rooms, doors).numbers;
    const backwards = planDoorNumbers([...rooms].reverse(), [...doors].reverse()).numbers;
    assert.deepEqual(
      forwards.map((n) => [n.doorId, n.number]),
      backwards.map((n) => [n.doorId, n.number]),
    );
  });

  it('records both rooms, so the door can be related to each of them', () => {
    const { rooms, doors } = floor();
    const byDoor = new Map(planDoorNumbers(rooms, doors).numbers.map((n) => [n.doorId, n]));
    assert.equal(byDoor.get(11)?.roomId, 2);
    assert.equal(byDoor.get(11)?.otherRoomId, 1);
    assert.equal(byDoor.get(10)?.otherRoomId, null, 'an exterior door has one side');
  });
});
