/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  edgeMidpoints, insertVertex, moveVertex, nearestHandle, outlineProblem,
  polygonArea, removeVertex,
} from './roomShape.js';

/** A 4 × 6 m room, corners counter-clockwise from the origin. */
const room = [
  { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }, { x: 0, y: 6 },
];

describe('polygonArea', () => {
  it('measures a rectangle', () => {
    assert.equal(polygonArea(room), 24);
  });

  it('does not care which way round the corners run', () => {
    assert.equal(polygonArea([...room].reverse()), 24);
  });

  it('is zero for anything that is not a polygon', () => {
    assert.equal(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }]), 0);
  });
});

describe('nearestHandle', () => {
  it('finds the corner you are pointing at', () => {
    assert.deepEqual(nearestHandle(room, { x: 4.1, y: 0.1 }, 0.5), { kind: 'vertex', index: 1 });
  });

  it('finds the edge between two corners', () => {
    const handle = nearestHandle(room, { x: 2, y: 0.1 }, 0.5);
    assert.equal(handle?.kind, 'edge');
    assert.equal(handle?.index, 0);
  });

  it('prefers the corner where corner and edge midpoint nearly coincide', () => {
    // On a short edge the two handles sit almost on top of each other, and
    // inserting a corner where one already is makes a degenerate edge.
    const sliver = [{ x: 0, y: 0 }, { x: 0.02, y: 0 }, { x: 0, y: 4 }];
    assert.deepEqual(nearestHandle(sliver, { x: 0.01, y: 0 }, 0.5), { kind: 'vertex', index: 0 });
  });

  it('finds nothing when the cursor is nowhere near', () => {
    assert.equal(nearestHandle(room, { x: 40, y: 40 }, 0.5), null);
  });
});

describe('edgeMidpoints', () => {
  it('gives one per edge, including the closing one', () => {
    const mids = edgeMidpoints(room);
    assert.equal(mids.length, 4);
    assert.deepEqual(mids[3], { x: 0, y: 3 }, 'the edge that closes the loop');
  });
});

describe('moveVertex', () => {
  it('moves the corner and leaves the others alone', () => {
    const next = moveVertex(room, 2, { x: 9, y: 6 });
    assert.deepEqual(next[2], { x: 9, y: 6 });
    assert.deepEqual(next[0], room[0]);
    // Parallel sides 4 and 9, six metres apart: (4 + 9) / 2 × 6.
    assert.equal(polygonArea(next), 39, 'a 4×6 room stretched to a trapezoid');
  });

  it('leaves the outline alone for an index that is not there', () => {
    assert.deepEqual(moveVertex(room, 9, { x: 0, y: 0 }), room);
  });
});

describe('insertVertex', () => {
  it('puts the new corner between the two the edge joins', () => {
    const { points, index } = insertVertex(room, 0, { x: 2, y: 0 });
    assert.equal(index, 1);
    assert.deepEqual(points[1], { x: 2, y: 0 });
    assert.equal(points.length, 5);
    assert.equal(polygonArea(points), 24, 'a corner on the edge changes nothing yet');
  });

  it('takes a rectangle to an L in one drag', () => {
    // The move this whole tool exists for: a wall came out, the room grows
    // into what was behind it.
    const { points, index } = insertVertex(room, 1, { x: 4, y: 3 });
    const pulled = moveVertex(points, index, { x: 7, y: 3 });
    assert.equal(pulled.length, 5);
    assert.ok(polygonArea(pulled) > 24);
    assert.equal(outlineProblem(pulled), null);
  });
});

describe('removeVertex', () => {
  it('drops the corner', () => {
    const next = removeVertex(room, 1);
    assert.equal(next?.length, 3);
  });

  it('refuses to take a triangle below three corners', () => {
    // A no-op here reads as a broken key; `null` lets the caller say why.
    assert.equal(removeVertex([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 0), null);
  });
});

describe('outlineProblem', () => {
  it('passes a proper room', () => {
    assert.equal(outlineProblem(room), null);
  });

  it('catches a bow tie', () => {
    // Extruded, a self-crossing footprint gives a volume that is nonsense and
    // an area that is the difference of two lobes — a number that looks
    // plausible on a room schedule and is wrong.
    const bowtie = [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }];
    assert.match(outlineProblem(bowtie) ?? '', /überschneidet/);
  });

  it('catches corners on one line', () => {
    const flat = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    assert.match(outlineProblem(flat) ?? '', /Linie/);
  });

  it('catches too few corners', () => {
    assert.match(outlineProblem([{ x: 0, y: 0 }, { x: 1, y: 0 }]) ?? '', /drei Ecken/);
  });
});
