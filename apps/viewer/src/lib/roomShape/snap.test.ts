/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  closestOnSegment, cornerCandidates, lineIntersection, snapPoint, snapSegmentsFrom,
} from './snap.js';

const wall = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };

describe('closestOnSegment', () => {
  it('drops a perpendicular onto the line', () => {
    assert.deepEqual(closestOnSegment({ x: 4, y: 3 }, wall.a, wall.b), { x: 4, y: 0 });
  });

  it('clamps past the end instead of running off the wall', () => {
    assert.deepEqual(closestOnSegment({ x: 40, y: 3 }, wall.a, wall.b), { x: 10, y: 0 });
  });

  it('survives a zero-length segment', () => {
    const p = closestOnSegment({ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 5, y: 5 });
    assert.deepEqual(p, { x: 5, y: 5 });
  });
});

describe('snapPoint', () => {
  const input = {
    segments: [wall],
    points: [{ x: 10, y: 0 }],
    tolerance: 0.5,
  };

  it('pulls the corner onto the wall it was dragged near', () => {
    const snapped = snapPoint({ x: 4, y: 0.2 }, input);
    assert.deepEqual(snapped, { at: { x: 4, y: 0 }, kind: 'edge' });
  });

  it('prefers a corner over the line it sits on', () => {
    // Two walls meet THERE, and somebody aiming near that point means it —
    // landing on the line 30 mm short would leave a gap nobody can see.
    const snapped = snapPoint({ x: 9.8, y: 0.1 }, input);
    assert.deepEqual(snapped, { at: { x: 10, y: 0 }, kind: 'vertex' });
  });

  it('leaves a drag alone when nothing is in reach', () => {
    // `null`, not the input echoed back: the caller draws a snapped corner
    // differently, and this is the state that says there is nothing to draw.
    assert.equal(snapPoint({ x: 4, y: 5 }, input), null);
  });

  it('snaps nowhere when the tolerance is nonsense', () => {
    assert.equal(snapPoint({ x: 4, y: 0 }, { ...input, tolerance: 0 }), null);
  });
});

describe('wall corners', () => {
  // Two wall faces meeting in an L. Neither ends where the other does: the
  // horizontal one runs past, the vertical one stops short — which is what a
  // section cut of two real walls looks like.
  const horizontal = { a: { x: -2, y: 0 }, b: { x: 6, y: 0 } };
  const vertical = { a: { x: 4, y: 0.15 }, b: { x: 4, y: 8 } };

  it('finds the crossing of two faces that never touch', () => {
    const hit = lineIntersection(horizontal.a, horizontal.b, vertical.a, vertical.b);
    // Compared with a tolerance, not exactly: the crossing comes out of a
    // division and lands a float's width off, which is the right answer.
    assert.ok(hit && Math.abs(hit.x - 4) < 1e-9 && Math.abs(hit.y) < 1e-9, JSON.stringify(hit));
  });

  it('invents no corner between two parallel faces', () => {
    // The two halves of one straight wall have no corner between them.
    assert.equal(
      lineIntersection({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 6, y: 0 }, { x: 9, y: 0 }),
      null,
    );
  });

  it('offers the corner where the walls meet', () => {
    const corners = cornerCandidates({ x: 4.05, y: 0.05 }, [horizontal, vertical], 0.3);
    assert.ok(
      corners.some((p) => Math.abs(p.x - 4) < 1e-9 && Math.abs(p.y) < 1e-9),
      `the L corner, got ${JSON.stringify(corners)}`,
    );
  });

  it('does not offer a crossing far off the end of either face', () => {
    // Two faces on opposite sides of a room cross somewhere out in the garden.
    const far = { a: { x: 40, y: -5 }, b: { x: 40, y: 5 } };
    const corners = cornerCandidates({ x: 0.05, y: 0.05 }, [horizontal, far], 0.3);
    assert.ok(!corners.some((p) => Math.abs(p.x - 40) < 1e-6), 'no phantom corner');
  });

  it('snaps a dragged corner onto the wall corner, not onto the wall line', () => {
    // The bug this exists for: the guides showed both walls found, and the
    // corner they make was the one point the drag could not reach.
    const snapped = snapPoint({ x: 4.06, y: 0.06 }, {
      segments: [horizontal, vertical],
      points: [],
      tolerance: 0.3,
    });
    assert.equal(snapped?.kind, 'vertex');
    assert.ok(Math.abs((snapped?.at.x ?? 0) - 4) < 1e-9);
    assert.ok(Math.abs(snapped?.at.y ?? 1) < 1e-9);
  });
});

describe('snapSegmentsFrom', () => {
  const lines = [
    { line: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }, category: 'cut' },
    { line: { start: { x: 0, y: 5 }, end: { x: 1, y: 5 } }, category: 'projected' },
  ];

  it('keeps only what the section actually cuts', () => {
    // A room corner pulled onto the edge of a roof overhang is worse than no
    // snap at all.
    const segments = snapSegmentsFrom(lines, new Set(['cut']));
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0].a, { x: 0, y: 0 });
  });

  it('keeps a line that states no category', () => {
    const segments = snapSegmentsFrom(
      [{ line: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } } }],
      new Set(['cut']),
    );
    assert.equal(segments.length, 1);
  });
});
