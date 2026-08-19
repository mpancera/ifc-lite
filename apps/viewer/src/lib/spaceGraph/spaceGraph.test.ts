/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A small storey, built by hand so every expected distance can be worked out
 * on paper:
 *
 *      0        10       12                22
 *   0  ┌─────────┬────────┬─────────────────┐
 *      │  Büro   │        │   Treppenhaus   │
 *      │  (A)    │ Korr.  │      (C)        │
 *   8  └─────────┴────────┴─────────────────┘
 *
 * Room A spans x 0..10, the corridor x 10..12, the stairwell x 12..22; all of
 * them y 0..8. Door AB sits at x=10, door BC at x=12, both at y=4. An exterior
 * door sits on the corridor's south wall at (11, 8).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpaceGraph, doorThreshold, pointInSpace, spaceAt, isStairwell,
  exteriorEdges, edgeTarget, edgeThreshold, DOOR_CLEARANCE_M,
  type SpaceNode, type DoorNode,
} from './spaceGraph.js';

/** Two triangles covering an axis-aligned rectangle. */
function rect(x0: number, y0: number, x1: number, y1: number): Float32Array {
  return new Float32Array([
    x0, y0, x1, y0, x1, y1,
    x0, y0, x1, y1, x0, y1,
  ]);
}

function space(
  id: number, name: string, x0: number, y0: number, x1: number, y1: number,
  extra: Partial<SpaceNode> = {},
): SpaceNode {
  return {
    id, name, usage: null,
    area: (x1 - x0) * (y1 - y0),
    labelPoint: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
    triangles: rect(x0, y0, x1, y1),
    storeyId: 1,
    ...extra,
  };
}

/** A door in a north-south wall: width along y, walking along x. */
function door(id: number, name: string, x: number, y: number, extra: Partial<DoorNode> = {}): DoorNode {
  return {
    id, name,
    centre: { x, y },
    along: { x: 0, y: 1 },
    across: { x: 1, y: 0 },
    width: 0.9,
    storeyId: 1,
    ...extra,
  };
}

const BUERO = space(1, 'Büro 1', 0, 0, 10, 8);
const KORRIDOR = space(2, 'Korridor', 10, 0, 12, 8);
const TREPPE = space(3, 'Treppenhaus', 12, 0, 22, 8, { usage: 'STAIR' });

const DOOR_AB = door(10, 'T1', 10, 4);
const DOOR_BC = door(11, 'T2', 12, 4);
/** South wall of the corridor: walking along +y leads outside. */
const DOOR_OUT = door(12, 'Ausgang', 11, 8, { along: { x: 1, y: 0 }, across: { x: 0, y: 1 } });

describe('doorThreshold', () => {
  it('puts the two points 1.2 m apart, centred on the leaf', () => {
    // Marc's rule: 1.2 m orthogonal through the door, so 0.6 m each side.
    const [a, b] = doorThreshold(DOOR_AB);
    assert.equal(Math.hypot(b.x - a.x, b.y - a.y).toFixed(6), DOOR_CLEARANCE_M.toFixed(6));
    assert.equal((a.x + b.x) / 2, DOOR_AB.centre.x);
  });

  it('steps along the walking direction, not along the width', () => {
    // Stepping along the width would put both points inside the wall.
    const [a, b] = doorThreshold(DOOR_AB);
    assert.equal(a.y, 4);
    assert.equal(b.y, 4);
    assert.ok(a.x < 10 && b.x > 10);
  });
});

describe('pointInSpace / spaceAt', () => {
  it('finds a point inside', () => {
    assert.ok(pointInSpace({ x: 5, y: 4 }, BUERO));
    assert.ok(!pointInSpace({ x: 15, y: 4 }, BUERO));
  });

  it('answers null for a point in no room', () => {
    assert.equal(spaceAt({ x: 50, y: 50 }, [BUERO, KORRIDOR, TREPPE]), null);
  });

  it('prefers the SMALLER room where two overlap', () => {
    // Exporters emit a storey-sized circulation space over the corridor. The
    // corridor is the useful answer, and area is a rule needing no tuning.
    const whole = space(9, 'Geschoss', 0, 0, 22, 8);
    assert.equal(spaceAt({ x: 11, y: 4 }, [whole, KORRIDOR])?.id, KORRIDOR.id);
  });
});

describe('buildSpaceGraph', () => {
  const graph = buildSpaceGraph([BUERO, KORRIDOR, TREPPE], [DOOR_AB, DOOR_BC, DOOR_OUT]);

  it('joins the rooms each door actually separates', () => {
    const ab = graph.edges.find((edge) => edge.doorId === DOOR_AB.id);
    assert.ok(ab);
    assert.deepEqual([ab.from, ab.to].sort(), [BUERO.id, KORRIDOR.id].sort());
  });

  it('marks a door with nothing on one side as leading outside', () => {
    const out = graph.edges.find((edge) => edge.doorId === DOOR_OUT.id);
    assert.ok(out);
    assert.ok(out.from === null || out.to === null);
    assert.deepEqual(exteriorEdges(graph).map((edge) => edge.doorId), [DOOR_OUT.id]);
  });

  it('drops a door that opens from a room into itself', () => {
    // A cupboard door modelled inside its room: an edge there is a detour the
    // router could take.
    const inner = door(20, 'Schrank', 5, 4);
    const built = buildSpaceGraph([BUERO], [inner]);
    assert.deepEqual(built.edges, []);
  });

  it('drops a door connected to nothing at all', () => {
    const nowhere = door(21, 'Nirgends', 100, 100);
    const built = buildSpaceGraph([BUERO, KORRIDOR], [nowhere]);
    assert.deepEqual(built.edges, []);
  });

  it('does not connect a door to the room on the storey above', () => {
    // In plan the room above sits at the very same coordinates.
    const upstairs = space(30, 'Büro OG', 0, 0, 10, 8, { storeyId: 2 });
    const built = buildSpaceGraph([BUERO, upstairs, KORRIDOR], [DOOR_AB]);
    const edge = built.edges[0];
    assert.ok(edge);
    assert.ok(![edge.from, edge.to].includes(upstairs.id));
  });

  it('lists both rooms of an edge in its adjacency', () => {
    assert.equal(graph.adjacency.get(BUERO.id)?.length, 1);
    // The corridor touches all three doors.
    assert.equal(graph.adjacency.get(KORRIDOR.id)?.length, 3);
  });
});

describe('edgeTarget / edgeThreshold', () => {
  const graph = buildSpaceGraph([BUERO, KORRIDOR, TREPPE], [DOOR_AB]);
  const edge = graph.edges[0];

  it('reports the room on the other side', () => {
    assert.equal(edgeTarget(edge, BUERO.id), KORRIDOR.id);
    assert.equal(edgeTarget(edge, KORRIDOR.id), BUERO.id);
  });

  it('orders the crossing points by the direction of travel', () => {
    // Walking from the office, the near point is the one on the office side.
    const [enterFromOffice] = edgeThreshold(edge, BUERO.id);
    const [enterFromCorridor] = edgeThreshold(edge, KORRIDOR.id);
    assert.ok(enterFromOffice.x < 10, `${enterFromOffice.x}`);
    assert.ok(enterFromCorridor.x > 10, `${enterFromCorridor.x}`);
  });
});

describe('isStairwell', () => {
  it('recognises a stairwell by its usage', () => {
    assert.ok(isStairwell(TREPPE));
  });

  it('recognises one by name, because most exports leave usage unset', () => {
    assert.ok(isStairwell(space(4, 'Fluchttreppenhaus Nord', 0, 0, 1, 1)));
    assert.ok(isStairwell(space(5, 'Treppenhaus', 0, 0, 1, 1)));
  });

  it('does not mistake an ordinary office for one', () => {
    assert.ok(!isStairwell(BUERO));
    assert.ok(!isStairwell(KORRIDOR));
  });
});
