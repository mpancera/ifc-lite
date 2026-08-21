/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The plan gizmo, driven by pointer events rather than by calling its maths.
 *
 * `moveGizmo.test.ts` already pins the arithmetic. What this adds is the wiring
 * between a pointer and that arithmetic: that the arrow you grabbed decides the
 * axis, that the steps handed to the model are INCREMENTS rather than the
 * running total (which would move the object twice as far as the cursor), and
 * that a refused write is re-offered instead of dropped.
 */

import '@/test/setup-dom.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { PlanMoveGizmo } from './PlanMoveGizmo.js';

/** 20 screen pixels to the metre, north up. */
const TRANSFORM = { x: 200, y: 200, scale: 20, rotation: 0 };

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

function mount(onMove: (step: Point2D) => boolean): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PlanMoveGizmo anchor={{ x: 0, y: 0 }} transform={TRANSFORM} onMove={onMove} />,
    );
  });
  mounted.push({ root, container });
  return container;
}

/** A pointer gesture on one handle, in screen pixels from wherever it starts. */
function drag(container: HTMLElement, handle: 'x' | 'y' | 'free', steps: Array<[number, number]>) {
  const group = container.querySelector(`[data-plan-gizmo-handle="${handle}"]`);
  assert.ok(group, `no ${handle} handle`);
  const target = group.querySelector(handle === 'free' ? 'rect' : 'line');
  assert.ok(target);
  const fire = (type: string, x: number, y: number) => {
    act(() => {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y,
      }));
    });
  };
  fire('pointerdown', 0, 0);
  for (const [x, y] of steps) fire('pointermove', x, y);
  fire('pointerup', ...(steps[steps.length - 1] ?? [0, 0]));
}

describe('PlanMoveGizmo', () => {
  beforeEach(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => { root.unmount(); });
      container.remove();
    }
  });

  after(() => {
    for (const { root, container } of mounted.splice(0)) {
      act(() => { root.unmount(); });
      container.remove();
    }
  });

  it('offers all three handles', () => {
    const container = mount(() => true);
    for (const handle of ['x', 'y', 'free']) {
      assert.ok(container.querySelector(`[data-plan-gizmo-handle="${handle}"]`), handle);
    }
  });

  it('turns pixels into metres at the plan’s scale', () => {
    const steps: Point2D[] = [];
    drag(mount((s) => { steps.push(s); return true; }), 'x', [[40, 0]]);
    assert.equal(steps.length, 1);
    assert.ok(Math.abs(steps[0].x - 2) < 1e-9, `expected 2 m, got ${steps[0].x}`);
  });

  it('holds the axis when the cursor wanders off it', () => {
    // The gesture the browser check used: 40 px along, 30 px across. The
    // across-part has to vanish, or an arrow is just a slower free drag.
    const steps: Point2D[] = [];
    drag(mount((s) => { steps.push(s); return true; }), 'x', [[40, 30]]);
    assert.equal(steps.at(-1)?.y, 0);
  });

  it('hands over increments, not the running total', () => {
    // The bug this catches moves the object twice as far as the cursor: each
    // frame re-sends everything since the drag began.
    const steps: Point2D[] = [];
    drag(mount((s) => { steps.push(s); return true; }), 'x', [[20, 0], [40, 0]]);
    assert.equal(steps.length, 2);
    assert.ok(Math.abs(steps[0].x - 1) < 1e-9);
    assert.ok(Math.abs(steps[1].x - 1) < 1e-9, 'second frame should ask for the NEW metre only');
  });

  it('re-offers a refused move rather than losing it', () => {
    // A read-only role refuses every write. When the role is changed mid-drag
    // the object must still end up under the cursor, not one frame behind.
    const steps: Point2D[] = [];
    let accept = false;
    drag(mount((s) => { steps.push(s); return accept ? true : (accept = true, false); }),
      'x', [[20, 0], [40, 0]]);
    // First frame refused (1 m), second frame therefore asks for the whole 2 m.
    assert.ok(Math.abs(steps[0].x - 1) < 1e-9);
    assert.ok(Math.abs(steps[1].x - 2) < 1e-9, `expected the full 2 m again, got ${steps[1].x}`);
  });

  it('moves north when the green arrow is pulled up the screen', () => {
    // Screen up is drawing −y is IFC +Y. Getting this backwards is invisible
    // in code review and obvious the first time somebody drags a door.
    const steps: Point2D[] = [];
    drag(mount((s) => { steps.push(s); return true; }), 'y', [[0, -60]]);
    assert.ok(steps.at(-1)!.y < 0, 'drawing y must decrease when dragging up');
  });
});
