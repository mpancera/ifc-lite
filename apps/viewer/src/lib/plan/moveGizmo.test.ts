/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  axisScreenDirection, constrainToAxis, isWorthWriting, pendingStep, planDrawingToScreen,
} from './moveGizmo.js';
import { planScreenToDrawing } from './planPick.js';

const NORTH_UP = { x: 100, y: 100, scale: 50, rotation: 0 };
const TURNED = { x: 100, y: 100, scale: 50, rotation: Math.PI / 2 };

describe('constrainToAxis', () => {
  it('keeps a drag on the arrow it was started from', () => {
    assert.deepEqual(constrainToAxis({ x: 3, y: 7 }, 'x'), { x: 3, y: 0 });
    assert.deepEqual(constrainToAxis({ x: 3, y: 7 }, 'y'), { x: 0, y: 7 });
  });

  it('lets the centre handle go anywhere', () => {
    assert.deepEqual(constrainToAxis({ x: 3, y: 7 }, 'free'), { x: 3, y: 7 });
  });

  it('forgives a cursor that wanders off the axis and comes back', () => {
    // Constraining the TOTAL rather than each frame is what makes this true;
    // per-frame clamping would bank the wander.
    const wandered = constrainToAxis({ x: 5, y: 2 }, 'x');
    const straight = constrainToAxis({ x: 5, y: 0 }, 'x');
    assert.deepEqual(wandered, straight);
  });
});

describe('axisScreenDirection', () => {
  it('points X right and Y UP on an unrotated plan', () => {
    // Y up because drawing y runs south; north is what a plan reader expects
    // the green arrow to point at.
    assert.deepEqual(axisScreenDirection('x', NORTH_UP), { x: 1, y: 0 });
    const y = axisScreenDirection('y', NORTH_UP);
    assert.equal(Math.round(y.x), 0);
    assert.equal(y.y, -1);
  });

  it('turns with the plan', () => {
    // The case a hand test never covers: the arrows have to follow the view
    // rotation, or dragging "along X" moves the object sideways.
    const x = axisScreenDirection('x', TURNED);
    assert.equal(Math.round(x.x), 0);
    assert.equal(Math.round(x.y), 1);
  });

  it('stays a unit vector at any angle', () => {
    for (const rotation of [0, 0.3, Math.PI / 2, 2.1, Math.PI]) {
      const d = axisScreenDirection('x', { ...NORTH_UP, rotation });
      assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9, `rotation ${rotation}`);
    }
  });
});

describe('planDrawingToScreen', () => {
  it('is the exact inverse of the picking transform', () => {
    // The handles are drawn with one and the cursor is read with the other. If
    // they disagree the gizmo drifts away from the object as you drag it.
    for (const transform of [NORTH_UP, TURNED, { x: -40, y: 12, scale: 8.5, rotation: 1.1 }]) {
      for (const p of [{ x: 0, y: 0 }, { x: 3.25, y: -7.5 }, { x: -12, y: 4 }]) {
        const back = planScreenToDrawing(
          planDrawingToScreen(p, transform).x,
          planDrawingToScreen(p, transform).y,
          transform,
        );
        assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
      }
    }
  });
});

describe('pendingStep', () => {
  it('asks only for what the model has not been told yet', () => {
    assert.deepEqual(pendingStep({ x: 5, y: 2 }, { x: 3, y: 2 }), { x: 2, y: 0 });
  });

  it('re-offers the whole move after a refused write', () => {
    // The caller leaves `applied` alone when a mutation is rejected, so the
    // next frame carries the full outstanding delta rather than losing it.
    const total = { x: 4, y: 0 };
    const applied = { x: 0, y: 0 };
    assert.deepEqual(pendingStep(total, applied), total);
  });

  it('knows when a step is too small to be worth a mutation', () => {
    assert.equal(isWorthWriting({ x: 1e-9, y: 1e-9 }), false);
    assert.equal(isWorthWriting({ x: 0.001, y: 0 }), true);
  });
});
