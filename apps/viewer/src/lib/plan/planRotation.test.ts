/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rotatePoint, rotationToNearestAxis, rotationToDirection, normalizeAngle,
  rotatedBounds, DEG_TO_RAD, RAD_TO_DEG,
  bearingToAngle, angleToBearing, normalizeBearing,
} from './planRotation.js';

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

describe('rotationToNearestAxis', () => {
  it('lays a nearly horizontal wall flat', () => {
    // A wall 12° off horizontal: the view turns back by 12°.
    const a = rotationToNearestAxis({ x: 0, y: 0 }, { x: Math.cos(12 * DEG_TO_RAD), y: Math.sin(12 * DEG_TO_RAD) });
    assert.ok(a !== null);
    assert.ok(near(a * RAD_TO_DEG, -12, 1e-6), `${a! * RAD_TO_DEG}`);
  });

  it('snaps a nearly VERTICAL wall to vertical, not to horizontal', () => {
    // The point of "nearest axis": tidy the gesture up, do not overrule it.
    // A wall at 78° is 12° off vertical, so the correction is +12°, not -78°.
    const a = rotationToNearestAxis({ x: 0, y: 0 }, { x: Math.cos(78 * DEG_TO_RAD), y: Math.sin(78 * DEG_TO_RAD) });
    assert.ok(a !== null);
    assert.ok(near(a * RAD_TO_DEG, 12, 1e-6), `${a! * RAD_TO_DEG}`);
  });

  it('actually lands the line on an axis when the angle is applied', () => {
    // The property that matters, checked end to end rather than by restating
    // the formula: rotate the line by the answer and it must be axis-aligned.
    for (const deg of [3, -17, 44, -44, 61, 130, -175]) {
      const from = { x: 1, y: 2 };
      const to = { x: 1 + Math.cos(deg * DEG_TO_RAD) * 5, y: 2 + Math.sin(deg * DEG_TO_RAD) * 5 };
      const angle = rotationToNearestAxis(from, to);
      assert.ok(angle !== null);
      const r1 = rotatePoint(from, angle);
      const r2 = rotatePoint(to, angle);
      const dx = Math.abs(r2.x - r1.x);
      const dy = Math.abs(r2.y - r1.y);
      assert.ok(dx < 1e-9 || dy < 1e-9, `${deg}° left dx=${dx} dy=${dy}`);
    }
  });

  it('never asks for more than a 45° turn', () => {
    for (const deg of [0, 10, 44, 46, 89, 91, 179, 271]) {
      const to = { x: Math.cos(deg * DEG_TO_RAD), y: Math.sin(deg * DEG_TO_RAD) };
      const angle = rotationToNearestAxis({ x: 0, y: 0 }, to);
      assert.ok(angle !== null);
      assert.ok(Math.abs(angle * RAD_TO_DEG) <= 45 + 1e-9, `${deg}° → ${angle! * RAD_TO_DEG}°`);
    }
  });

  it('refuses a degenerate line rather than inventing an angle', () => {
    assert.equal(rotationToNearestAxis({ x: 4, y: 4 }, { x: 4, y: 4 }), null);
  });
});

describe('rotationToDirection', () => {
  it('lays a line onto an arbitrary target direction', () => {
    // The fallback for aligning to a site boundary rather than to an axis.
    const from = { x: 0, y: 0 };
    const to = { x: Math.cos(20 * DEG_TO_RAD), y: Math.sin(20 * DEG_TO_RAD) };
    const target = 65 * DEG_TO_RAD;
    const angle = rotationToDirection(from, to, target);
    assert.ok(angle !== null);
    const r = rotatePoint(to, angle);
    assert.ok(near(Math.atan2(r.y, r.x), target, 1e-9));
  });

  it('refuses a degenerate line', () => {
    assert.equal(rotationToDirection({ x: 1, y: 1 }, { x: 1, y: 1 }, 0), null);
  });
});

describe('bearings — the vocabulary, not the trigonometry', () => {
  /** Where a bearing points on screen, as a unit vector (y grows downward). */
  const screenDir = (bearingDeg: number) => {
    const a = bearingToAngle(bearingDeg * DEG_TO_RAD);
    return { x: Math.cos(a), y: Math.sin(a) };
  };

  it('reads 0° as UP and 90° as RIGHT, the way a plan is read', () => {
    // The whole bug: 90° meant "right" to the maths and "east" to the user,
    // and those are the same — but 0° meant "right" to the maths and "north"
    // to the user, which are a quarter turn apart.
    const up = screenDir(0);
    assert.ok(near(up.x, 0, 1e-12) && near(up.y, -1, 1e-12), JSON.stringify(up));

    const right = screenDir(90);
    assert.ok(near(right.x, 1, 1e-12) && near(right.y, 0, 1e-12), JSON.stringify(right));

    const down = screenDir(180);
    assert.ok(near(down.x, 0, 1e-12) && near(down.y, 1, 1e-12), JSON.stringify(down));

    const left = screenDir(270);
    assert.ok(near(left.x, -1, 1e-12) && near(left.y, 0, 1e-12), JSON.stringify(left));
  });

  it('round-trips a bearing through the angle it names', () => {
    for (const deg of [0, 37, 90, 180, 271, 359]) {
      const back = angleToBearing(bearingToAngle(deg * DEG_TO_RAD));
      assert.ok(near(back * RAD_TO_DEG, deg, 1e-9), `${deg}`);
    }
  });

  it('reads a bearing in [0, 360), never as a negative', () => {
    assert.ok(near(normalizeBearing(-90 * DEG_TO_RAD) * RAD_TO_DEG, 270, 1e-9));
    assert.ok(near(normalizeBearing(450 * DEG_TO_RAD) * RAD_TO_DEG, 90, 1e-9));
  });

  it('lays a line drawn up-and-right onto due east when asked for 90°', () => {
    // Marc's case, end to end. The line runs up-right on screen (screen y
    // decreasing), and 90° means east, so it must end up pointing right.
    const from = { x: 0, y: 0 };
    const to = { x: 4, y: -4 };            // up and to the right
    const delta = rotationToDirection(from, to, bearingToAngle(90 * DEG_TO_RAD));
    assert.ok(delta !== null);

    const turned = rotatePoint(to, delta);
    assert.ok(near(turned.y, 0, 1e-9), `y=${turned.y}`);   // horizontal…
    assert.ok(turned.x > 0, `x=${turned.x}`);              // …and pointing RIGHT
  });

  it('lays that same line onto due north when asked for 0°', () => {
    const delta = rotationToDirection({ x: 0, y: 0 }, { x: 4, y: -4 }, bearingToAngle(0));
    assert.ok(delta !== null);
    const turned = rotatePoint({ x: 4, y: -4 }, delta);
    assert.ok(near(turned.x, 0, 1e-9), `x=${turned.x}`);
    assert.ok(turned.y < 0, `y=${turned.y}`);              // up the screen
  });
});

describe('normalizeAngle', () => {
  it('keeps a readout from showing 350° for -10°', () => {
    assert.ok(near(normalizeAngle(350 * DEG_TO_RAD) * RAD_TO_DEG, -10, 1e-9));
    assert.ok(near(normalizeAngle(-350 * DEG_TO_RAD) * RAD_TO_DEG, 10, 1e-9));
    assert.ok(near(normalizeAngle(0), 0));
  });
});

describe('rotatedBounds', () => {
  it('measures the TURNED extent, not the original one', () => {
    // A 45°-turned square is wider than its own side; fitting to the unrotated
    // bounds would frame the plan with its corners cut off.
    const square = { min: { x: -1, y: -1 }, max: { x: 1, y: 1 } };
    const turned = rotatedBounds(square, 45 * DEG_TO_RAD);
    const width = turned.max.x - turned.min.x;
    assert.ok(near(width, 2 * Math.SQRT2, 1e-9), `${width}`);
  });

  it('is a no-op at zero, down to object identity', () => {
    const b = { min: { x: 0, y: 0 }, max: { x: 3, y: 4 } };
    assert.equal(rotatedBounds(b, 0), b);
  });

  it('is unchanged by a quarter turn of a square', () => {
    const square = { min: { x: -2, y: -2 }, max: { x: 2, y: 2 } };
    const turned = rotatedBounds(square, Math.PI / 2);
    assert.ok(near(turned.max.x - turned.min.x, 4, 1e-9));
    assert.ok(near(turned.max.y - turned.min.y, 4, 1e-9));
  });
});

describe('rotatePoint', () => {
  it('is a no-op at zero', () => {
    assert.deepEqual(rotatePoint({ x: 3, y: -4 }, 0), { x: 3, y: -4 });
  });

  it('round-trips through its own inverse — this is what un-rotates a click', () => {
    // Picking, placing and committing an annotation all rely on this: the
    // screen→drawing mapping applies the negative angle, and the result has to
    // be the true world point or a placement lands somewhere else.
    const p = { x: 7.1, y: -3.9 };
    for (const deg of [0, 13, -47, 90, 180]) {
      const back = rotatePoint(rotatePoint(p, deg * DEG_TO_RAD), -deg * DEG_TO_RAD);
      assert.ok(near(back.x, p.x, 1e-9) && near(back.y, p.y, 1e-9), `${deg}°`);
    }
  });
});
