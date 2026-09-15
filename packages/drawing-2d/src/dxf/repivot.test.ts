/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Checked the only way that means anything: apply the answer and measure where
 * the drawing went. The claim is that one point does NOT move, so every test
 * takes the drawing point that sat under the pivot and asks where it is now.
 */

import { describe, expect, it } from 'vitest';
import { repivotDxfPlacement } from './repivot.js';
import { applyDxfPlacement } from './convert.js';
import { inverseDxfPlacement } from './align.js';
import type { DxfPlacement } from './types.js';
import type { Point2D } from '../types.js';

const IDENTITY: DxfPlacement = { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 };

/** Swiss coordinates: the case this exists for. */
const FAR: DxfPlacement = { offsetX: 2665486, offsetY: 1259317, rotationDeg: -9.25, scale: 1 };

function near(a: Point2D, b: Point2D, tol = 1e-5) {
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(tol);
}

/** Where the point currently drawn at `pivot` ends up under `next`. */
function pivotAfter(placement: DxfPlacement, next: Partial<DxfPlacement>, pivot: Point2D): Point2D {
  const anchor = inverseDxfPlacement(pivot, placement)!;
  return applyDxfPlacement(anchor, repivotDxfPlacement(placement, next, pivot));
}

describe('repivotDxfPlacement', () => {
  it('leaves the pivot exactly where it was, under a turn', () => {
    const pivot = { x: 30, y: -12 };

    near(pivotAfter(IDENTITY, { rotationDeg: 17 }, pivot), pivot);
  });

  it('leaves the pivot exactly where it was, under a scale change', () => {
    const pivot = { x: 7, y: 3 };

    near(pivotAfter(FAR, { scale: 1.02 }, pivot), pivot);
  });

  it('holds on a georeferenced plan, which is what this is for', () => {
    // The geometry is what sits at two and a half million, not the offset: a
    // DXF drawn in Swiss coordinates. One degree about the origin swings that
    // point tens of kilometres, which is the report — the number in the field
    // is right and the plan is gone.
    const placement: DxfPlacement = { offsetX: 12, offsetY: -5, rotationDeg: -9.25, scale: 1 };
    const geometry = { x: 2665500, y: 1259330 };

    const before = applyDxfPlacement(geometry, placement);
    const naive = applyDxfPlacement(geometry, { ...placement, rotationDeg: -8.25 });
    expect(Math.hypot(naive.x - before.x, naive.y - before.y)).toBeGreaterThan(1000);

    // About the point being looked at — which here is where that geometry is
    // drawn — the same correction moves it nowhere at all.
    near(pivotAfter(placement, { rotationDeg: -8.25 }, before), before, 1e-3);
  });

  it('turns everything else around the pivot', () => {
    // The pivot holding still is only half of it; the rest has to actually
    // turn, and by the angle asked for.
    const pivot = { x: 0, y: 0 };
    const turned = repivotDxfPlacement(IDENTITY, { rotationDeg: 90 }, pivot);
    const moved = applyDxfPlacement({ x: 10, y: 0 }, turned);

    expect(Math.hypot(moved.x, moved.y)).toBeCloseTo(10, 6);
    expect(Math.abs(moved.x)).toBeLessThan(1e-6);
  });

  it('changes nothing but the field that was edited', () => {
    const pivot = { x: 5, y: 5 };
    const result = repivotDxfPlacement(FAR, { rotationDeg: -8 }, pivot);

    expect(result.rotationDeg).toBe(-8);
    expect(result.scale).toBe(FAR.scale);
  });

  it('falls back to a plain merge with no pivot', () => {
    expect(repivotDxfPlacement(FAR, { rotationDeg: 0 }, null)).toEqual({ ...FAR, rotationDeg: 0 });
  });

  it('falls back rather than dying on a placement it cannot invert', () => {
    // A dead field is worse than a jump: the jump is undoable.
    const broken: DxfPlacement = { ...IDENTITY, scale: 0 };

    expect(repivotDxfPlacement(broken, { rotationDeg: 5 }, { x: 1, y: 1 }).rotationDeg).toBe(5);
  });
});
