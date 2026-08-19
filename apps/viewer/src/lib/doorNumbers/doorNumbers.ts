/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Door numbers, derived from the way out.
 *
 * A door is numbered after a ROOM — `1.04.T1` — and the whole question is
 * which of the two rooms it takes its number from. The convention (Marc,
 * 2026-08-19, and it is the one the Siemens plans of this building use):
 *
 * - the defining room is the one you flee FROM,
 * - for a dead end it is the room you go INTO,
 * - along a corridor the escape path decides.
 *
 * Those read as three rules and are one: **the room further from safety
 * defines the door**. Fleeing means moving towards the way out, so the room
 * you leave is always the one with more doors left to pass; a dead end is
 * further from safety than the corridor serving it; and a corridor is nearer
 * than every room hanging off it, so its doors are numbered after the rooms
 * rather than after the corridor. One measure — steps to safety — answers all
 * three, and answers them the same way every time.
 *
 * # Where the fallback applies
 * Two rooms equally far from the way out (two halves of a through-route, a
 * door between two corridors) have no flight direction between them. There the
 * leaf decides: the door belongs to the room it swings INTO, which is the
 * rule Marc named as the fallback. Where the model states no swing either, the
 * door is reported rather than numbered — a number invented at that point
 * would be indistinguishable from one that was derived.
 *
 * # Counting
 * Several doors on one room count up T1, T2, T3 clockwise from north around
 * the room's centre. Clockwise because that is how somebody reads a plan, and
 * from a fixed direction because the numbering has to come out the same on
 * every run, whatever order the doors arrive in.
 */

import { isPlaceholderName } from '@/lib/roomTriage/roomChecks';

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface NumberingRoom {
  readonly id: number;
  /** The room's own number, e.g. `1.04`. Empty when it has none yet. */
  readonly number: string;
  readonly centre: Point2D;
  /**
   * True for a room that IS the way out — a stairwell, an exit lobby.
   *
   * Safety is not only outdoors: on an upper floor the protected stair is
   * where a route ends, and a door numbering that ignored it would send every
   * count on the floor towards a staircase it did not recognise.
   */
  readonly safe?: boolean;
}

export interface NumberingDoor {
  readonly id: number;
  readonly centre: Point2D;
  /** The rooms either side. `null` is outside — an exterior door. */
  readonly sides: readonly [number | null, number | null];
  /** The room the leaf swings into, where the geometry says so. */
  readonly opensInto?: number | null;
}

/** How the defining room was decided — shown, because it is not all the same. */
export type NumberBasis =
  /** The room is further from the way out: you flee through this door. */
  | 'escape'
  /** The door leads outside, so the one room it touches defines it. */
  | 'exterior'
  /** Both sides are equally far out; the leaf swings into this room. */
  | 'swing'
  /** Somebody said so. Nothing derived outranks that. */
  | 'manual';

export interface DoorNumber {
  readonly doorId: number;
  /** `<room>.T<n>`. */
  readonly number: string;
  /** The room the number came from. */
  readonly roomId: number;
  /** The room on the other side, `null` for an exterior door. */
  readonly otherRoomId: number | null;
  readonly basis: NumberBasis;
  /** Doors to pass from the defining room to safety, for explaining the pick. */
  readonly steps: number | null;
}

export type DoorProblemReason =
  /** The door sits in no room this storey knows — nothing to name it after. */
  | 'no-room'
  /**
   * Its defining room has no number yet — or still carries the one the
   * generator invented, which is the same thing wearing a name.
   */
  | 'room-has-no-number'
  /** Equally far out on both sides, and the model states no swing. */
  | 'no-direction';

export interface DoorProblem {
  readonly doorId: number;
  readonly reason: DoorProblemReason;
}

export interface DoorNumberPlan {
  readonly numbers: readonly DoorNumber[];
  readonly problems: readonly DoorProblem[];
  /** Steps to safety per room, exposed so a panel can explain a decision. */
  readonly steps: ReadonlyMap<number, number>;
}

/** The separator between the room number and the door counter. */
export const DOOR_SEPARATOR = '.';
/** What a door counter is prefixed with. */
export const DOOR_PREFIX = 'T';

/**
 * Doors to pass from each room before somebody is safe.
 *
 * A stairwell counts as 0 — you are there. A room with a door straight outside
 * counts as 1. Everything else is one more than its best neighbour. Rooms the
 * search never reaches (no door at all, or a wing that connects to nothing)
 * are absent rather than infinite: "cannot be reached from here" is a real
 * answer about a floor plan and should not be dressed up as a large number.
 */
export function stepsToSafety(
  rooms: readonly NumberingRoom[],
  doors: readonly NumberingDoor[],
): Map<number, number> {
  const steps = new Map<number, number>();
  const queue: number[] = [];

  for (const room of rooms) {
    if (room.safe) { steps.set(room.id, 0); queue.push(room.id); }
  }
  for (const door of doors) {
    const [a, b] = door.sides;
    const inside = a === null ? b : b === null ? a : null;
    if (inside === null) continue;               // interior door, or nowhere
    if ((steps.get(inside) ?? Infinity) > 1) {
      steps.set(inside, 1);
      queue.push(inside);
    }
  }

  const neighbours = new Map<number, number[]>();
  for (const door of doors) {
    const [a, b] = door.sides;
    if (a === null || b === null) continue;
    (neighbours.get(a) ?? neighbours.set(a, []).get(a)!).push(b);
    (neighbours.get(b) ?? neighbours.set(b, []).get(b)!).push(a);
  }

  // Breadth-first: every edge costs one door, so the first time a room is
  // reached is by the fewest doors.
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    const here = steps.get(id) ?? 0;
    for (const next of neighbours.get(id) ?? []) {
      if (steps.has(next)) continue;
      steps.set(next, here + 1);
      queue.push(next);
    }
  }
  return steps;
}

/** Clockwise angle from north, in [0, 2π) — the order a plan is read in. */
function clockwiseFromNorth(from: Point2D, to: Point2D): number {
  const angle = Math.atan2(to.x - from.x, to.y - from.y);
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

/** Which of the two rooms the door takes its number from. */
function decide(
  door: NumberingDoor,
  steps: ReadonlyMap<number, number>,
  chosen: ReadonlyMap<number, number> | undefined,
): { roomId: number; other: number | null; basis: NumberBasis } | DoorProblemReason {
  const [a, b] = door.sides;
  // A choice made by hand comes first and is not second-guessed — including
  // where the derivation would have found an answer, since somebody looking at
  // the plan knows something the graph does not.
  const picked = chosen?.get(door.id);
  if (picked !== undefined && (picked === a || picked === b)) {
    return { roomId: picked, other: picked === a ? b : a, basis: 'manual' };
  }
  if (a === null && b === null) return 'no-room';
  if (a === null || b === null) {
    const only = (a ?? b) as number;
    return { roomId: only, other: null, basis: 'exterior' };
  }

  const sa = steps.get(a);
  const sb = steps.get(b);
  // An unreachable room still has a flight direction relative to a reachable
  // one: you leave the part of the plan the way out cannot be found from.
  const va = sa ?? Infinity;
  const vb = sb ?? Infinity;
  if (va !== vb) {
    const roomId = va > vb ? a : b;
    return { roomId, other: roomId === a ? b : a, basis: 'escape' };
  }

  if (door.opensInto === a || door.opensInto === b) {
    const roomId = door.opensInto as number;
    return { roomId, other: roomId === a ? b : a, basis: 'swing' };
  }
  return 'no-direction';
}

export function planDoorNumbers(
  rooms: readonly NumberingRoom[],
  doors: readonly NumberingDoor[],
  /** Doors whose room somebody picked by hand — see `NumberBasis.manual`. */
  chosen?: ReadonlyMap<number, number>,
): DoorNumberPlan {
  const steps = stepsToSafety(rooms, doors);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const problems: DoorProblem[] = [];

  // Doors grouped by the room that names them, so the counter is per room.
  const grouped = new Map<number, Array<{ door: NumberingDoor; other: number | null; basis: NumberBasis }>>();
  for (const door of doors) {
    const decision = decide(door, steps, chosen);
    if (typeof decision === 'string') {
      problems.push({ doorId: door.id, reason: decision });
      continue;
    }
    const room = byId.get(decision.roomId);
    // A placeholder is not a number to build on: `Space.T1` on six doors of
    // six different rooms is worse than no number, because it looks done.
    // Same definition of "not named yet" that Clean Rooms works from.
    if (!room || room.number.trim() === '' || isPlaceholderName(room.number)) {
      problems.push({ doorId: door.id, reason: room ? 'room-has-no-number' : 'no-room' });
      continue;
    }
    const list = grouped.get(decision.roomId) ?? [];
    list.push({ door, other: decision.other, basis: decision.basis });
    grouped.set(decision.roomId, list);
  }

  const numbers: DoorNumber[] = [];
  for (const [roomId, list] of grouped) {
    const room = byId.get(roomId)!;
    list.sort((p, q) => {
      const d = clockwiseFromNorth(room.centre, p.door.centre)
        - clockwiseFromNorth(room.centre, q.door.centre);
      // Two doors on the same bearing (a double door) would otherwise swap
      // between runs; the express id is arbitrary but it is stable.
      return d !== 0 ? d : p.door.id - q.door.id;
    });
    list.forEach((entry, i) => {
      numbers.push({
        doorId: entry.door.id,
        number: `${room.number.trim()}${DOOR_SEPARATOR}${DOOR_PREFIX}${i + 1}`,
        roomId,
        otherRoomId: entry.other,
        basis: entry.basis,
        steps: steps.get(roomId) ?? null,
      });
    });
  }

  numbers.sort((p, q) => p.number.localeCompare(q.number, 'de', { numeric: true }));
  return { numbers, problems, steps };
}

export default planDoorNumbers;
