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
import { snapToUnderlay, underlaySnapTargetsNear, type SnapLines } from './underlaySnap.js';

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

  it('catches where two wall lines CROSS, which has no vertex at all', () => {
    // The failure this was rewritten for. A CAD plan runs wall faces through
    // a junction, so the corner you see is a crossing and the nearest vertex
    // is metres away at the end of the line.
    const crossing = drawn(
      [{ x: -5, y: 2 }, { x: 5, y: 2 }],
      [{ x: 2, y: -5 }, { x: 2, y: 5 }],
    );

    assert.deepEqual(snapToUnderlay(crossing, { x: 2.05, y: 2.05 }, 0.5), { x: 2, y: 2 });
  });

  it('does not invent a crossing off the end of a line', () => {
    // Two lines whose EXTENSIONS would meet have nothing at that point on
    // either drawing, so offering it would be offering a place to mis-aim at.
    const apart = drawn(
      [{ x: -5, y: 2 }, { x: -1, y: 2 }],
      [{ x: 2, y: -5 }, { x: 2, y: -1 }],
    );

    assert.equal(snapToUnderlay(apart, { x: 2, y: 2 }, 0.5), null);
  });

  it('prefers a crossing to a lone end that is nearer', () => {
    const mixed = drawn(
      [{ x: -5, y: 0 }, { x: 5, y: 0 }],
      [{ x: 0, y: -5 }, { x: 0, y: 5 }],
      [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }],
    );

    assert.deepEqual(snapToUnderlay(mixed, { x: 0.08, y: 0.08 }, 0.5), { x: 0, y: 0 });
  });

  it('prefers a corner over a nearer hatch stroke', () => {
    // The failure this rule exists for. A hatch is drawn as hundreds of
    // separate strokes, so the NEAREST vertex inside a hatched room is always
    // a stroke end and never the corner being aimed at. Where two lines meet
    // is what a corner is.
    const corner = { x: 10, y: 10 };
    const wall = drawn(
      [{ x: 0, y: 10 }, corner],
      [corner, { x: 10, y: 0 }],
      // A hatch stroke whose end is closer to the cursor than the corner.
      [{ x: 9.7, y: 9.7 }, { x: 9.4, y: 9.4 }],
    );

    assert.deepEqual(snapToUnderlay(wall, { x: 9.75, y: 9.75 }, 0.5), corner);
  });

  it('still takes the nearest when nothing is shared', () => {
    // Ranking must not throw away the ordinary case: among lone ends the
    // closest one is the right answer.
    const strokes = drawn([{ x: 0, y: 0 }, { x: 0.1, y: 0 }], [{ x: 0.3, y: 0 }, { x: 0.4, y: 0 }]);

    assert.deepEqual(snapToUnderlay(strokes, { x: 0.31, y: 0 }, 0.5), { x: 0.3, y: 0 });
  });

  it('takes vertices only, never a point along an edge', () => {
    // Somebody aligning two drawings picks corners. An edge snap sliding along
    // a wall lands somewhere that cannot be found again on the other drawing —
    // which is exactly what has to match.
    const wall = drawn([{ x: 0, y: 0 }, { x: 10, y: 0 }]);

    assert.equal(snapToUnderlay(wall, { x: 5, y: 0 }, 0.5), null);
  });
});

describe('underlaySnapTargetsNear', () => {
  it('offers the crossings too, because that is what the snap takes', () => {
    // Dots that showed only vertices would point at the ends of wall lines
    // while the snap took the crossing between them.
    const cross = drawn(
      [{ x: -5, y: 0 }, { x: 5, y: 0 }],
      [{ x: 0, y: -5 }, { x: 0, y: 5 }],
    );

    assert.ok(underlaySnapTargetsNear(cross, { x: 0, y: 0 }, 1)
      .some((p) => Math.hypot(p.x, p.y) < 1e-9));
  });

  it('lists what a click could catch, nearest first', () => {
    const plan = drawn([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 3, y: 0 }, { x: 9, y: 0 }]);

    assert.deepEqual(underlaySnapTargetsNear(plan, { x: 1.2, y: 0 }, 5),
      [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }]);
  });

  it('shows one dot where several lines meet', () => {
    // Otherwise a corner draws darker than a stroke end for no reason the
    // reader can act on.
    const corner = { x: 5, y: 5 };
    const meeting = drawn([{ x: 0, y: 5 }, corner], [corner, { x: 5, y: 0 }]);

    assert.deepEqual(underlaySnapTargetsNear(meeting, corner, 1), [corner]);
  });

  it('keeps out of reach what a click could not catch', () => {
    const plan = drawn([{ x: 0, y: 0 }, { x: 100, y: 0 }]);

    assert.deepEqual(underlaySnapTargetsNear(plan, { x: 50, y: 0 }, 5), []);
  });

  it('caps the list, because a dense plan has thousands', () => {
    const many: { x: number; y: number }[][] = [];
    for (let i = 0; i < 200; i += 1) many.push([{ x: i * 0.01, y: 0 }, { x: i * 0.01, y: 1 }]);

    assert.equal(underlaySnapTargetsNear(drawn(...many), { x: 1, y: 0.5 }, 100, 40).length, 40);
  });

  it('answers nothing for an underlay that has gone', () => {
    assert.deepEqual(underlaySnapTargetsNear(null, { x: 0, y: 0 }, 5), []);
  });
});
