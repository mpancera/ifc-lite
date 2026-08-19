/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The same hand-built storey as `spaceGraph.test.ts`:
 *
 *      0        10       12                22
 *   0  ┌─────────┬────────┬─────────────────┐
 *      │  Büro   │        │   Treppenhaus   │
 *      │  (A)    │ Korr.  │      (C)        │
 *   8  └─────────┴────────┴─────────────────┘
 *
 * Doors at (10, 4) and (12, 4), both crossed along +x; an exterior door on the
 * corridor's south wall at (11, 8).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceGraph, type SpaceNode, type DoorNode } from './spaceGraph.js';
import { findEscapeRoute, FAILURE_MESSAGES } from './escapeRouting.js';
import { escapeRouteLength } from '@/lib/plan/escapeRoutes';

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

function rect(x0: number, y0: number, x1: number, y1: number): Float32Array {
  return new Float32Array([x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1]);
}

function space(
  id: number, name: string, x0: number, y0: number, x1: number, y1: number,
  extra: Partial<SpaceNode> = {},
): SpaceNode {
  return {
    id, name, usage: null, area: (x1 - x0) * (y1 - y0),
    labelPoint: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
    triangles: rect(x0, y0, x1, y1), storeyId: 1, ...extra,
  };
}

function door(id: number, x: number, y: number, extra: Partial<DoorNode> = {}): DoorNode {
  return {
    id, name: `T${id}`, centre: { x, y },
    along: { x: 0, y: 1 }, across: { x: 1, y: 0 },
    width: 0.9, storeyId: 1, ...extra,
  };
}

const BUERO = space(1, 'Büro 1', 0, 0, 10, 8);
const KORRIDOR = space(2, 'Korridor', 10, 0, 12, 8);
const TREPPE = space(3, 'Treppenhaus', 12, 0, 22, 8, { usage: 'STAIR' });

const DOOR_AB = door(10, 10, 4);
const DOOR_BC = door(11, 12, 4);
const DOOR_OUT = door(12, 11, 8, { along: { x: 1, y: 0 }, across: { x: 0, y: 1 }, width: 1.4 });

const GRAPH = buildSpaceGraph([BUERO, KORRIDOR, TREPPE], [DOOR_AB, DOOR_BC, DOOR_OUT]);

/** The far corner of the office — where a fire concept measures from. */
const CORNER = { x: 0, y: 4 };

describe('findEscapeRoute to a stairwell', () => {
  const outcome = findEscapeRoute(GRAPH, CORNER, { kind: 'stairwell' });

  it('finds the way', () => {
    assert.ok(outcome.ok, outcome.ok ? '' : outcome.reason);
  });

  it('measures the WALKED distance, door by door', () => {
    assert.ok(outcome.ok);
    // (0,4) to 9.4 = 9.4; through door AB to 10.6 = 1.2; to 11.4 = 0.8;
    // through door BC to 12.6 = 1.2. Total 12.6 m.
    assert.ok(near(outcome.route.length, 12.6), `${outcome.route.length}`);
  });

  it('agrees with the drawing module about its own length', () => {
    // Two implementations of "add up the segments" that must never diverge:
    // the router reports the number, `escapeRoutes` draws it.
    assert.ok(outcome.ok);
    assert.ok(near(escapeRouteLength(outcome.route.points), outcome.route.length));
  });

  it('passes through both rooms and both doors, in order', () => {
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.route.spaceIds, [BUERO.id, KORRIDOR.id, TREPPE.id]);
    assert.deepEqual(outcome.route.doorIds, [DOOR_AB.id, DOOR_BC.id]);
  });

  it('crosses each doorway with the full 1.2 m, orthogonally', () => {
    assert.ok(outcome.ok);
    const points = outcome.route.points;
    // Points 1 and 2 straddle the first door: 9.4 and 10.6, same y.
    assert.ok(near(points[1].x, 9.4), `${points[1].x}`);
    assert.ok(near(points[2].x, 10.6), `${points[2].x}`);
    assert.equal(points[1].y, points[2].y);
  });

  it('stops at the stairwell door rather than walking into the middle', () => {
    // Reaching the stair IS reaching safety; walking on would add metres
    // nobody has to walk.
    assert.ok(outcome.ok);
    const last = outcome.route.points[outcome.route.points.length - 1];
    assert.ok(near(last.x, 12.6), `${last.x}`);
  });

  it('reports the narrowest door it went through', () => {
    assert.ok(outcome.ok);
    assert.equal(outcome.route.narrowestDoor, 0.9);
  });
});

describe('findEscapeRoute to the exterior', () => {
  it('leaves through the outside door', () => {
    const outcome = findEscapeRoute(GRAPH, CORNER, { kind: 'exterior' });
    assert.ok(outcome.ok, outcome.ok ? '' : outcome.reason);
    assert.deepEqual(outcome.route.doorIds, [DOOR_AB.id]);
    // Ends past the exterior leaf, at y = 8.6.
    const last = outcome.route.points[outcome.route.points.length - 1];
    assert.ok(near(last.y, 8.6), `${last.y}`);
  });
});

describe('findEscapeRoute to a clicked point', () => {
  it('routes between two rooms', () => {
    const outcome = findEscapeRoute(GRAPH, CORNER, {
      kind: 'point', point: { x: 20, y: 4 },
    });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.route.spaceIds, [BUERO.id, KORRIDOR.id, TREPPE.id]);
    // 12.6 to the stairwell threshold, then 7.4 across to x = 20.
    assert.ok(near(outcome.route.length, 20), `${outcome.route.length}`);
  });

  it('handles start and end in the SAME room', () => {
    const outcome = findEscapeRoute(GRAPH, { x: 1, y: 1 }, {
      kind: 'point', point: { x: 9, y: 7 },
    });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.route.doorIds, []);
    assert.ok(near(outcome.route.length, Math.hypot(8, 6)));
  });
});

describe('when there is no route', () => {
  it('refuses a start that is in no room', () => {
    // Guessing the nearest room would measure from somewhere nobody pointed at.
    const outcome = findEscapeRoute(GRAPH, { x: 100, y: 100 }, { kind: 'stairwell' });
    assert.ok(!outcome.ok);
    assert.equal(outcome.reason, 'start-outside-any-room');
  });

  it('says so when the end is in no room', () => {
    const outcome = findEscapeRoute(GRAPH, CORNER, {
      kind: 'point', point: { x: 100, y: 100 },
    });
    assert.ok(!outcome.ok);
    assert.equal(outcome.reason, 'end-outside-any-room');
  });

  it('says so when no stairwell exists', () => {
    const plain = buildSpaceGraph([BUERO, KORRIDOR], [DOOR_AB]);
    const outcome = findEscapeRoute(plain, CORNER, { kind: 'stairwell' });
    assert.ok(!outcome.ok);
    assert.equal(outcome.reason, 'no-target-found');
  });

  it('says so when a door is missing between two rooms', () => {
    // The most useful failure in practice: the model, not the router, is
    // incomplete, and the message points at that.
    const split = buildSpaceGraph([BUERO, TREPPE], []);
    const outcome = findEscapeRoute(split, CORNER, {
      kind: 'point', point: { x: 20, y: 4 },
    });
    assert.ok(!outcome.ok);
    assert.equal(outcome.reason, 'no-path');
    assert.match(FAILURE_MESSAGES[outcome.reason], /Tür/);
  });

  it('has a German message for every failure', () => {
    for (const reason of [
      'start-outside-any-room', 'end-outside-any-room', 'no-target-found', 'no-path',
    ] as const) {
      assert.ok(FAILURE_MESSAGES[reason].length > 0);
    }
  });
});

describe('the route the cheapest way round', () => {
  it('prefers the shorter of two ways, by metres and not by room count', () => {
    // A long detour through ONE room must lose to a short way through two.
    //
    //   Halle (H): x 0..40, y 10..18 — one room, but a long walk.
    //   The direct way is Büro → Korridor → Treppe as before.
    const halle = space(4, 'Halle', 0, 10, 40, 18);
    const intoHalle = door(13, 5, 10, { along: { x: 1, y: 0 }, across: { x: 0, y: 1 } });
    const hallToStair = door(14, 20, 10, { along: { x: 1, y: 0 }, across: { x: 0, y: -1 } });

    const withDetour = buildSpaceGraph(
      [BUERO, KORRIDOR, TREPPE, halle],
      [DOOR_AB, DOOR_BC, intoHalle, hallToStair],
    );
    const outcome = findEscapeRoute(withDetour, CORNER, { kind: 'stairwell' });

    assert.ok(outcome.ok);
    // Still the two-door way: 12.6 m beats anything through the hall.
    assert.deepEqual(outcome.route.doorIds, [DOOR_AB.id, DOOR_BC.id]);
    assert.ok(near(outcome.route.length, 12.6), `${outcome.route.length}`);
  });
});
