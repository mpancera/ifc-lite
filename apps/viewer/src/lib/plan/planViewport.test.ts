/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The forward mapping, pinned against the inverse the plan already uses.
 *
 * A sign or an order-of-operations slip here does not look broken — it puts
 * the screenflow's cursor a plausible-looking few centimetres from the line it
 * is tracing, which is exactly the defect this was written to fix. So the
 * assertions are round trips through `planScreenToDrawing`, the function every
 * click in the plan already goes through, rather than hand-computed numbers
 * that could encode the same mistake twice.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planScreenToDrawing } from './planPick.js';
import { planPointToViewport, planViewport, setPlanViewport } from './planViewport.js';
import { ifcStoreyLocalToPlan, projectIfcPoint } from '../screenflow/worldPointer.js';

const RECT = { left: 240, top: 64, width: 900, height: 600 };

function mount(transform: { x: number; y: number; scale: number; rotation?: number }) {
  setPlanViewport({ transform, rect: RECT });
}

afterEach(() => setPlanViewport(null));

describe('planPointToViewport', () => {
  it('answers null while no plan is mounted', () => {
    assert.equal(planViewport(), null);
    assert.equal(planPointToViewport({ x: 3, y: 4 }), null);
  });

  it('inverts planScreenToDrawing exactly, unrotated', () => {
    const transform = { x: 120, y: -40, scale: 18.5 };
    mount(transform);
    const drawing = { x: 7.25, y: -3.5 };
    const viewport = planPointToViewport(drawing);
    assert.ok(viewport);
    // Back through the plan's own inverse, in the container-local coordinates
    // it expects — the same subtraction `selectAt` does with its bounding box.
    const back = planScreenToDrawing(viewport.x - RECT.left, viewport.y - RECT.top, transform);
    assert.ok(Math.abs(back.x - drawing.x) < 1e-9, `x drifted: ${back.x}`);
    assert.ok(Math.abs(back.y - drawing.y) < 1e-9, `y drifted: ${back.y}`);
  });

  it('inverts it under a rotated plan too', () => {
    // The rotation is the half a reader is most likely to apply in the wrong
    // direction, and the result stays on the paper either way.
    const transform = { x: 310, y: 88, scale: 12, rotation: Math.PI / 5 };
    mount(transform);
    for (const drawing of [{ x: 0, y: 0 }, { x: 4, y: 9 }, { x: -6.5, y: 2.25 }]) {
      const viewport = planPointToViewport(drawing);
      assert.ok(viewport);
      const back = planScreenToDrawing(viewport.x - RECT.left, viewport.y - RECT.top, transform);
      assert.ok(Math.abs(back.x - drawing.x) < 1e-9, `x drifted at ${JSON.stringify(drawing)}`);
      assert.ok(Math.abs(back.y - drawing.y) < 1e-9, `y drifted at ${JSON.stringify(drawing)}`);
    }
  });

  it('offsets by the container, so the answer is in viewport pixels', () => {
    // The overlay is fixed-positioned over the whole window; an answer in
    // container-local pixels would be off by the panel to the left of the plan.
    mount({ x: 0, y: 0, scale: 1 });
    assert.deepEqual(planPointToViewport({ x: 0, y: 0 }), { x: RECT.left, y: RECT.top });
  });
});

describe('ifcStoreyLocalToPlan', () => {
  it('negates Y, matching planPointToStoreyLocal', () => {
    // The one sign in the chain that produces completely plausible output when
    // wrong: everything lands mirrored about the building's X axis.
    assert.deepEqual(ifcStoreyLocalToPlan([3, 4, 2.5]), { x: 3, y: -4 });
  });

  it('drops the height — a plan is a cut seen from above', () => {
    assert.deepEqual(ifcStoreyLocalToPlan([1, 2, 0]), ifcStoreyLocalToPlan([1, 2, 9]));
  });
});

describe('projectIfcPoint chooses the view that is actually showing', () => {
  const state = {
    cameraCallbacks: { projectToScreen: () => ({ x: 999, y: 999 }) },
  } as unknown as Parameters<typeof projectIfcPoint>[0];

  it('answers from the plan while one is mounted', () => {
    mount({ x: 0, y: 0, scale: 10 });
    const at = projectIfcPoint(state, [3, 4, 0], 0);
    // Not the camera's 999/999: the plan is the thing on screen, and reading
    // the camera instead is what put the drawn cursor beside the line it was
    // tracing in every 2D beat.
    assert.deepEqual(at, { x: RECT.left + 30, y: RECT.top - 40 });
  });

  it('falls back to the camera once the plan is gone', () => {
    setPlanViewport(null);
    assert.deepEqual(projectIfcPoint(state, [3, 4, 0], 0), { x: 999, y: 999 });
  });
});
