/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What these pin is coverage, not arithmetic: no room without a detector, no
 * detector outside its room, and none of them in a corner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  layOutDetectors, layOutCallPoint, polygonCentroid, CALL_POINT_HEIGHT_M,
  DEFAULT_DETECTOR_LAYOUT, type PlanPoint,
} from './detectorLayout.js';

function rect(x0: number, y0: number, x1: number, y1: number): PlanPoint[] {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** Ray cast, restated here so the tests do not lean on the code they check. */
function contains(polygon: readonly PlanPoint[], p: PlanPoint): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

describe('layOutDetectors', () => {
  it('covers a hall at the spacing it was given', () => {
    // 20 × 12 m at 4 m: five columns and three rows fit the extent.
    const points = layOutDetectors(rect(0, 0, 20, 12));

    assert.equal(points.length, 5 * 3);
  });

  it('keeps every detector inside its room', () => {
    // An L-shaped room: the grid covers the bounding box, and the notch is not
    // part of the room.
    const ell = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 6 },
      { x: 8, y: 6 }, { x: 8, y: 16 }, { x: 0, y: 16 },
    ];

    for (const p of layOutDetectors(ell)) {
      assert.ok(contains(ell, p), `${JSON.stringify(p)} is outside the room`);
    }
  });

  it('keeps them off the walls', () => {
    // A detector in the corner reads the corner, not the room.
    const room = rect(0, 0, 16, 16);
    const clearance = DEFAULT_DETECTOR_LAYOUT.wallClearance;

    for (const p of layOutDetectors(room)) {
      assert.ok(p.x > clearance - 1e-9 && p.x < 16 - clearance + 1e-9
        && p.y > clearance - 1e-9 && p.y < 16 - clearance + 1e-9,
      `${JSON.stringify(p)} is within ${clearance} m of a wall`);
    }
  });

  it('centres the grid instead of anchoring it at a corner', () => {
    // Anchored at a corner, a 10 m room at 4 m pitch leaves a 2 m strip
    // unprotected at the far side. Centred, the leftover is shared.
    const points = layOutDetectors(rect(0, 0, 10, 4));
    const xs = points.map((p) => p.x).sort((a, b) => a - b);

    assert.ok(Math.abs((xs[0] - 0) - (10 - xs[xs.length - 1])) < 1e-9,
      `margins differ: ${xs[0]} vs ${10 - xs[xs.length - 1]}`);
  });

  it('puts one detector in a room smaller than the grid', () => {
    const small = rect(0, 0, 2.5, 2.5);
    const points = layOutDetectors(small);

    assert.equal(points.length, 1);
    assert.ok(contains(small, points[0]));
  });

  it('never leaves a room without one', () => {
    // A room with no detector is a hole in the coverage, and a hole that comes
    // out of a spacing rule is the kind nobody notices.
    const corridor = rect(0, 0, 30, 0.9); // narrower than twice the clearance

    assert.equal(layOutDetectors(corridor).length, 1);
  });

  it('places the fallback INSIDE a room whose centroid is not', () => {
    // A U-shaped room: the centre of area sits in the opening.
    const u = [
      { x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 2 }, { x: 9, y: 2 },
      { x: 9, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 12 }, { x: 0, y: 12 },
      { x: 0, y: 10 }, { x: 3, y: 10 }, { x: 3, y: 2 }, { x: 0, y: 2 },
    ];
    const tight = { spacing: 40, wallClearance: 0.5 };

    const points = layOutDetectors(u, tight);

    assert.equal(points.length, 1);
    assert.ok(contains(u, points[0]), `fallback landed at ${JSON.stringify(points[0])}`);
  });

  it('answers nothing for a ring that is not a room', () => {
    assert.deepEqual(layOutDetectors([]), []);
    assert.deepEqual(layOutDetectors([{ x: 0, y: 0 }, { x: 1, y: 1 }]), []);
  });

  it('refuses a spacing that is not a spacing', () => {
    assert.deepEqual(layOutDetectors(rect(0, 0, 10, 10), { spacing: 0, wallClearance: 0.5 }), []);
  });
});

describe('polygonCentroid', () => {
  it('finds the centre of area, not the average vertex', () => {
    // The difference shows on an unevenly-sampled outline: five vertices along
    // one edge would drag an average.
    const skewed = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 },
      { x: 6, y: 4 }, { x: 0, y: 4 },
    ];
    const c = polygonCentroid(skewed);

    assert.ok(Math.abs(c.x - 3) < 1e-9, `x was ${c.x}`);
    assert.ok(Math.abs(c.y - 2) < 1e-9, `y was ${c.y}`);
  });

  it('gives a usable answer for a degenerate ring instead of NaN', () => {
    const line = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }];
    const c = polygonCentroid(line);

    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
  });
});

describe('layOutCallPoint', () => {
  it('sits on the longest wall, at 1.2 m', () => {
    const corridor = rect(0, 0, 30, 2);
    const placement = layOutCallPoint(corridor);

    assert.ok(placement);
    assert.equal(placement.height, CALL_POINT_HEIGHT_M);
    assert.ok(Math.abs(placement.at.x - 15) < 1e-9, `x was ${placement.at.x}`);
    assert.ok(Math.abs(Math.abs(placement.along.x) - 1) < 1e-9, 'not along the long wall');
  });

  it('sets itself INTO the room, whichever way the outline winds', () => {
    // A room outline promises nothing about its winding, and a call point
    // inside the wall is a call point nobody can press.
    for (const corridor of [rect(0, 0, 30, 2), [...rect(0, 0, 30, 2)].reverse()]) {
      const placement = layOutCallPoint(corridor)!;
      assert.ok(contains(corridor, placement.at),
        `landed outside: ${JSON.stringify(placement.at)}`);
    }
  });

  it('answers nothing for a ring that is not a room', () => {
    assert.equal(layOutCallPoint([{ x: 0, y: 0 }, { x: 1, y: 0 }]), null);
    assert.equal(layOutCallPoint([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }]), null);
  });
});
