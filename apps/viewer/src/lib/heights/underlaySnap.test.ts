/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Snapping takes the lines AS DRAWN.
 *
 * It used to take the stored underlay and apply its placement, which is only
 * part of the way to drawing space — the render frame's origin shift and a
 * flipped section's mirror were missing. On a georeferenced model that put
 * every snap target kilometres from the line it belonged to, and nothing
 * caught. Handing in the drawn lines removes the whole class of mistake:
 * there is no second derivation left to disagree with the first.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { snapToUnderlay, type SnapLines } from './underlaySnap.js';

/** One underlay's lines, as the render hook hands them over. */
function drawn(...lines: { x: number; y: number }[][]): SnapLines {
  return { lines: lines.map((points) => ({ points })) };
}

describe('snapToUnderlay', () => {
  const plan = drawn([{ x: 0, y: 0 }, { x: 10, y: 0 }]);

  it('catches a vertex within the tolerance', () => {
    assert.deepEqual(snapToUnderlay(plan, { x: 10.05, y: 0.05 }, 0.5), { x: 10, y: 0 });
  });

  it('lets a click well away from anything stand', () => {
    // Returning the nearest vertex regardless would drag a deliberate pick
    // metres across the plan.
    assert.equal(snapToUnderlay(plan, { x: 5, y: 5 }, 0.5), null);
  });

  it('takes the nearest of several', () => {
    const many = drawn([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);

    assert.deepEqual(snapToUnderlay(many, { x: 1.1, y: 0 }, 0.5), { x: 1, y: 0 });
  });

  it('cannot catch a hidden layer, because a hidden layer is not drawn', () => {
    // The old version had to check `layerVisibility` itself. Taking the drawn
    // lines makes that impossible to get wrong: what is switched off never
    // arrives.
    assert.equal(snapToUnderlay(drawn(), { x: 0, y: 0 }, 0.5), null);
  });

  it('snaps where the plan SITS, because that is what it was handed', () => {
    // A plan moved 100 m east is drawn 100 m east, and the vertex a person
    // aims at is the one they can see.
    const moved = drawn([{ x: 100, y: 50 }]);

    assert.equal(snapToUnderlay(moved, { x: 0, y: 0 }, 0.5), null);
    assert.deepEqual(snapToUnderlay(moved, { x: 100, y: 50 }, 0.5), { x: 100, y: 50 });
  });

  it('answers null for an underlay that has gone', () => {
    // The session outlives its underlay if one is deleted mid-alignment.
    assert.equal(snapToUnderlay(null, { x: 0, y: 0 }, 0.5), null);
    assert.equal(snapToUnderlay(undefined, { x: 0, y: 0 }, 0.5), null);
  });

  it('takes vertices only, never a point along an edge', () => {
    // Somebody aligning two drawings picks corners. An edge snap sliding along
    // a wall lands somewhere that cannot be found again on the other drawing —
    // which is exactly what has to match.
    const wall = drawn([{ x: 0, y: 0 }, { x: 10, y: 0 }]);

    assert.equal(snapToUnderlay(wall, { x: 5, y: 0 }, 0.5), null);
  });
});
