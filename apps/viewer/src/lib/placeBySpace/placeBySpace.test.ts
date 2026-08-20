/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CEILING_CLEARANCE_M, deviceCount, mountingHeight, planDevicesBySpace, spreadPoints,
} from './placeBySpace.js';
import { pointInSpace, type SpaceNode } from '../spaceGraph/spaceGraph.js';

/** A rectangular room from (0,0) to (w,d), as two triangles. */
function room(id: number, name: string, w: number, d: number, ox = 0, oy = 0): SpaceNode {
  return {
    id, name, usage: null,
    area: w * d,
    labelPoint: { x: ox + w / 2, y: oy + d / 2 },
    triangles: new Float32Array([
      ox, oy, ox + w, oy, ox + w, oy + d,
      ox, oy, ox + w, oy + d, ox, oy + d,
    ]),
    storeyId: 1,
  };
}

const params = { CoverageArea: 45, MaxPerRoom: 4, MinArea: 2 };

describe('deviceCount', () => {
  it('gives every room at least one, however small', () => {
    assert.equal(deviceCount(3, params), 1);
    assert.equal(deviceCount(45, params), 1);
  });

  it('adds one per started coverage area', () => {
    assert.equal(deviceCount(46, params), 2);
    assert.equal(deviceCount(90, params), 2);
    assert.equal(deviceCount(91, params), 3);
  });

  it('caps a hall rather than filling it', () => {
    // 900 m² would be 20 devices. Nobody wants to delete nineteen of them,
    // and the cap is the honest way to say "this room needs a planner".
    assert.equal(deviceCount(900, params), 4);
  });
});

describe('mountingHeight', () => {
  it('hangs a ceiling device just under the ceiling of THIS storey', () => {
    // Not a fixed 2.5 m: the same tool runs on a 3.66 m villa floor and on a
    // 2.4 m cellar, and a typed default is wrong on one of them.
    assert.equal(mountingHeight(null, 3.658, 'ceiling'), 3.658 - CEILING_CLEARANCE_M);
  });

  it('puts a wall device at hand height, whatever the storey', () => {
    assert.equal(mountingHeight(null, 3.658, 'wall'), 1.2);
  });

  it('leaves floor-standing kit on the floor', () => {
    assert.equal(mountingHeight(null, 3.658, 'floor'), 0);
    assert.equal(mountingHeight(null, 3.658, 'freestanding'), 0);
  });

  it('falls back to the floor when the model states no storey height', () => {
    // Where the click tool puts things — a visible, correctable answer rather
    // than a guessed one that looks right in plan.
    assert.equal(mountingHeight(null, null, 'ceiling'), 0);
  });

  it('lets a typed height win over all of it', () => {
    assert.equal(mountingHeight(2.4, 3.658, 'ceiling'), 2.4);
    assert.equal(mountingHeight(0, 3.658, 'wall'), 0);
  });
});

describe('spreadPoints', () => {
  it('puts a single device on the label point', () => {
    const r = room(1, 'Büro', 5, 4);
    assert.deepEqual(spreadPoints(r, 1), [{ x: 2.5, y: 2 }]);
  });

  it('keeps every point inside the room', () => {
    // An L would be the interesting case; a rectangle at least proves the
    // sampling never walks off the edge of the bounding box.
    const r = room(1, 'Saal', 20, 10);
    for (const point of spreadPoints(r, 4)) {
      assert.ok(pointInSpace(point, r), `${point.x}/${point.y} inside`);
    }
  });

  it('does not stack two devices on the same spot', () => {
    const r = room(1, 'Saal', 20, 10);
    const points = spreadPoints(r, 3);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        assert.ok(d > 1, `points ${i} and ${j} are ${d.toFixed(2)} m apart`);
      }
    }
  });

  it('falls back to the centre for a room too narrow to sample', () => {
    // A 20 cm slot between two walls, detected as a room. There is nowhere
    // else to put anything, and refusing would leave the caller with fewer
    // points than it asked for.
    const r = room(1, 'Schlitz', 0.2, 8);
    const points = spreadPoints(r, 2);
    assert.equal(points.length, 2);
    for (const point of points) assert.ok(pointInSpace(point, r));
  });
});

describe('planDevicesBySpace', () => {
  it('one device per small room, several in a big one', () => {
    const plan = planDevicesBySpace(
      [room(1, '1.01', 5, 4), room(2, '1.02', 12, 10, 100, 0)],
      params,
    );
    const perRoom = new Map<number, number>();
    for (const p of plan.placements) perRoom.set(p.spaceId, (perRoom.get(p.spaceId) ?? 0) + 1);
    assert.equal(perRoom.get(1), 1);
    assert.equal(perRoom.get(2), 3, '120 m² at 45 m² each');
    assert.equal(plan.roomsConsidered, 2);
  });

  it('numbers the devices within their room', () => {
    const plan = planDevicesBySpace([room(2, '1.02', 12, 10)], params);
    assert.deepEqual(plan.placements.map((p) => p.index), [1, 2, 3]);
    assert.deepEqual(plan.placements.map((p) => p.count), [3, 3, 3]);
  });

  it('skips a room that already has one, so a second run adds nothing', () => {
    // Re-running after drawing three more rooms is the ordinary way to work.
    // Doubling the installation instead is the way to lose trust in the tool.
    const rooms = [room(1, '1.01', 5, 4), room(2, '1.02', 5, 4, 20, 0)];
    const plan = planDevicesBySpace(rooms, params, { occupied: new Set([1]) });
    assert.deepEqual(plan.placements.map((p) => p.spaceId), [2]);
    assert.deepEqual(plan.skipped, [{ spaceId: 1, roomLabel: '1.01', reason: 'occupied' }]);
  });

  it('leaves the cupboards alone', () => {
    const plan = planDevicesBySpace([room(1, 'Schrank', 0.8, 0.8)], params);
    assert.equal(plan.placements.length, 0);
    assert.equal(plan.skipped[0].reason, 'too-small');
  });

  it('reports a room with no geometry rather than dropping it silently', () => {
    const ghost: SpaceNode = {
      id: 7, name: '1.09', usage: null, area: 30,
      labelPoint: { x: 0, y: 0 }, triangles: new Float32Array(), storeyId: 1,
    };
    const plan = planDevicesBySpace([ghost], params);
    assert.deepEqual(plan.skipped, [{ spaceId: 7, roomLabel: '1.09', reason: 'no-geometry' }]);
  });

  it('labels the rooms the way the caller names them', () => {
    // The room NUMBER lives in Name and only the caller can read it through
    // the mutation overlay — the graph node carries the readable name.
    const plan = planDevicesBySpace([room(1, 'Sitzungszimmer', 5, 4)], params, {
      labelOf: () => '1.07',
    });
    assert.equal(plan.placements[0].roomLabel, '1.07');
  });
});
