/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { TriangleSoup } from './extract-outline.js';
import { extractPlanFootprint, ringArea, simplifyRing } from './footprint.js';
import type { Point2 } from './fit-outline.js';

/**
 * Build a soup from plan rectangles at a given height.
 *
 * Positions are viewer space (Y-up): plan x is viewer x, plan y is NEGATED
 * viewer z. Writing the helper in plan coordinates keeps the tests readable
 * and puts the axis flip in exactly one place.
 */
function slabs(
  rects: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number; h?: number }>,
): TriangleSoup {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const r of rects) {
    const h = r.h ?? 0;
    const corners: Point2[] = [
      { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
    ];
    const base = positions.length / 3;
    for (const c of corners) positions.push(c.x, h, -c.y);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Axis-aligned extent of a ring, for comparing a footprint to what was built. */
function extent(ring: readonly Point2[]) {
  return {
    x0: Math.min(...ring.map((p) => p.x)), x1: Math.max(...ring.map((p) => p.x)),
    y0: Math.min(...ring.map((p) => p.y)), y1: Math.max(...ring.map((p) => p.y)),
  };
}

describe('extractPlanFootprint', () => {
  it('gives a closed solid a footprint, which the surface extractor cannot', () => {
    // The whole reason this exists: `extractPlanOutline` returns 'no-boundary'
    // for a solid, and a building is a solid.
    const result = extractPlanFootprint(slabs([{ x0: 0, y0: 0, x1: 10, y1: 6 }]));

    assert.equal(result.ok, true);
  });

  it('recovers the extent of a simple rectangle', () => {
    const result = extractPlanFootprint(slabs([{ x0: 0, y0: 0, x1: 10, y1: 6 }]));
    assert.ok(result.ok);

    const e = extent(result.ring);
    for (const [got, want] of [[e.x0, 0], [e.y0, 0], [e.x1, 10], [e.y1, 6]] as const) {
      assert.ok(Math.abs(got - want) <= result.cellSize, `${got} ≈ ${want}`);
    }
  });

  it('gets the area of a rectangle right to within the cell size', () => {
    const result = extractPlanFootprint(slabs([{ x0: 0, y0: 0, x1: 10, y1: 6 }]));
    assert.ok(result.ok);

    // 60 m², with a boundary uncertainty of about one cell all the way round.
    const slack = 2 * result.cellSize * (10 + 6);
    assert.ok(Math.abs(result.area - 60) < slack, `area ${result.area}`);
  });

  it('keeps an L-shape concave, where a convex hull would not', () => {
    // The case that decides the method. The hull of an L spans the notch and
    // would hand the fit a shape the building does not have.
    const l = slabs([
      { x0: 0, y0: 0, x1: 10, y1: 4 },
      { x0: 0, y0: 4, x1: 4, y1: 10 },
    ]);

    const result = extractPlanFootprint(l);
    assert.ok(result.ok);

    // True L area is 40 + 24 = 64; the hull over the same extent would be far
    // more. Anything near the bounding box means the notch was filled in.
    assert.ok(result.area < 75, `expected the notch to stay open, got ${result.area} m²`);
    assert.ok(result.area > 55, `expected roughly 64 m², got ${result.area} m²`);
  });

  it('unions overlapping parts into one outline', () => {
    // A building arrives as many meshes — walls, slabs, roof — that overlap in
    // plan. The footprint is their union, not one of them.
    const result = extractPlanFootprint(slabs([
      { x0: 0, y0: 0, x1: 6, y1: 6 },
      { x0: 4, y0: 0, x1: 10, y1: 6 },
    ]));
    assert.ok(result.ok);

    const e = extent(result.ring);
    assert.ok(Math.abs(e.x1 - 10) <= result.cellSize);
    assert.ok(Math.abs(result.area - 60) < 8, `area ${result.area}`);
  });

  it('is unaffected by how high the parts sit', () => {
    // A roof at 12 m and a floor at 0 cover the same ground; the footprint is a
    // plan projection and must not care.
    const flat = extractPlanFootprint(slabs([{ x0: 0, y0: 0, x1: 10, y1: 6 }]));
    const stacked = extractPlanFootprint(slabs([
      { x0: 0, y0: 0, x1: 10, y1: 6, h: 0 },
      { x0: 0, y0: 0, x1: 10, y1: 6, h: 12 },
    ]));
    assert.ok(flat.ok && stacked.ok);

    assert.ok(Math.abs(flat.area - stacked.area) < 0.5);
  });

  it('counts detached parts and returns the largest', () => {
    const result = extractPlanFootprint(slabs([
      { x0: 0, y0: 0, x1: 10, y1: 10 },
      { x0: 40, y0: 0, x1: 43, y1: 3 },
    ]));
    assert.ok(result.ok);

    assert.ok(result.ringCount >= 2, `expected detached rings, got ${result.ringCount}`);
    assert.ok(result.area > 80, 'the larger part is the footprint');
  });

  it('reports the cell size, because that is the accuracy', () => {
    const result = extractPlanFootprint(slabs([{ x0: 0, y0: 0, x1: 10, y1: 6 }]), {
      cellSize: 0.5,
    });
    assert.ok(result.ok);

    assert.equal(result.cellSize, 0.5);
  });

  it('coarsens the grid rather than allocating a huge one', () => {
    // A site model spanning a kilometre at 0.25 m would be millions of cells.
    const result = extractPlanFootprint(slabs([{ x0: 0, y0: 0, x1: 4000, y1: 4000 }]), {
      cellSize: 0.25, maxCells: 100,
    });
    assert.ok(result.ok);

    assert.ok(result.cellSize >= 40, `expected a coarsened grid, got ${result.cellSize} m`);
  });

  it('returns counter-clockwise, like the other outline producers', () => {
    const result = extractPlanFootprint(slabs([{ x0: 0, y0: 0, x1: 10, y1: 6 }]));
    assert.ok(result.ok);

    assert.ok(ringArea(result.ring) > 0);
  });

  it('says so when there are no triangles', () => {
    const empty = { positions: new Float32Array(), indices: new Uint32Array() };

    assert.deepEqual(extractPlanFootprint(empty), { ok: false, reason: 'empty' });
  });

  it('refuses a surface that is edge-on in plan', () => {
    // A single vertical wall projects to a line. There is no footprint to
    // report, and inventing a thickness would invent a building.
    const wall: TriangleSoup = {
      positions: new Float32Array([0, 0, 0, 0, 3, 0, 0, 3, -8]),
      indices: new Uint32Array([0, 1, 2]),
    };

    const result = extractPlanFootprint(wall);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'degenerate');
  });
});

describe('simplifyRing', () => {
  it('turns a traced staircase back into a rectangle', () => {
    // The trace emits one vertex per cell edge; the shape has four corners.
    const stair: Point2[] = [];
    for (let x = 0; x <= 10; x += 0.25) stair.push({ x, y: 0 });
    for (let y = 0.25; y <= 6; y += 0.25) stair.push({ x: 10, y });
    for (let x = 9.75; x >= 0; x -= 0.25) stair.push({ x, y: 6 });
    for (let y = 5.75; y >= 0.25; y -= 0.25) stair.push({ x: 0, y });

    const simplified = simplifyRing(stair, 0.25);

    assert.ok(simplified.length <= 8, `expected a handful of vertices, got ${simplified.length}`);
    assert.ok(Math.abs(Math.abs(ringArea(simplified)) - 60) < 1);
  });

  it('does not depend on where the trace started', () => {
    // Two runs over the same building must report the same residual, so the
    // simplification cannot key on the first vertex.
    const ring: Point2[] = [];
    for (let x = 0; x <= 10; x += 0.5) ring.push({ x, y: 0 });
    for (let y = 0.5; y <= 6; y += 0.5) ring.push({ x: 10, y });
    for (let x = 9.5; x >= 0; x -= 0.5) ring.push({ x, y: 6 });
    for (let y = 5.5; y >= 0.5; y -= 0.5) ring.push({ x: 0, y });

    const rotated = [...ring.slice(7), ...ring.slice(0, 7)];

    const a = Math.abs(ringArea(simplifyRing(ring, 0.5)));
    const b = Math.abs(ringArea(simplifyRing(rotated, 0.5)));
    assert.ok(Math.abs(a - b) < 0.6, `${a} vs ${b}`);
  });

  it('leaves a ring alone at zero tolerance', () => {
    const ring: Point2[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];

    assert.deepEqual(simplifyRing(ring, 0), ring);
  });

  it('keeps a corner that matters more than the tolerance', () => {
    const l: Point2[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 },
      { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
    ];

    assert.equal(simplifyRing(l, 0.25).length, 6);
  });
});
