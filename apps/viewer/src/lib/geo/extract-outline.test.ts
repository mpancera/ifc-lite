/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { extractPlanOutline, ringSignedArea, type TriangleSoup } from './extract-outline.js';
import { fitOutline, type Point2 } from './fit-outline.js';
import { PARCEL_CH775979211712 } from './__fixtures__/parcel-ring.js';

const parcel: Point2[] = PARCEL_CH775979211712.map(([x, y]) => ({ x, y }));

/**
 * Fan-triangulate a plan ring into viewer space, emitting three FRESH vertices
 * per triangle — the unshared layout a tessellator actually produces, and the
 * one that makes every edge look like a border until welding fixes it.
 *
 * Plan (IFC X/Y) maps to viewer space as `(x, height, -y)`.
 *
 * A fan across a concave ring makes triangles that overlap on the page, but
 * topologically the border is still exactly the ring's own edges: the spokes
 * are each used by two triangles, the rim edges by one. That is the property
 * under test, so the overlap is harmless.
 */
function fanSoup(ring: readonly Point2[], height = 0): TriangleSoup {
  const positions: number[] = [];
  const indices: number[] = [];
  const push = (p: Point2) => {
    indices.push(positions.length / 3);
    positions.push(p.x, height, -p.y);
  };
  for (let i = 1; i < ring.length - 1; i += 1) {
    push(ring[0]);
    push(ring[i]);
    push(ring[i + 1]);
  }
  return { positions, indices };
}

function expectOk(result: ReturnType<typeof extractPlanOutline>) {
  assert.ok(result.ok, `expected an outline, got ${result.ok ? '' : result.reason}`);
  return result;
}

/** Rounded point set, so a comparison ignores start vertex and winding. */
function pointSet(ring: readonly Point2[]): Set<string> {
  return new Set(ring.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`));
}

const square: Point2[] = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];

describe('extractPlanOutline', () => {
  it('recovers the border of a shared-vertex surface', () => {
    const soup: TriangleSoup = {
      positions: [0, 0, 0, 10, 0, 0, 10, 0, -10, 0, 0, -10],
      indices: [0, 1, 2, 0, 2, 3],
    };
    const result = expectOk(extractPlanOutline(soup));
    assert.strictEqual(result.ring.length, 4);
    assert.ok(Math.abs(result.area - 100) < 1e-6, `area ${result.area}`);
    assert.deepStrictEqual(pointSet(result.ring), pointSet(square));
  });

  it('welds a soup whose triangles share no vertices', () => {
    // The layout that would otherwise make every single edge look like a
    // border and produce no closed ring at all.
    const soup = fanSoup(square);
    assert.strictEqual(soup.positions.length / 3, 6, 'fixture must be unshared');
    const result = expectOk(extractPlanOutline(soup));
    assert.strictEqual(result.ring.length, 4);
    assert.ok(Math.abs(result.area - 100) < 1e-6);
  });

  it('is unaffected by triangle winding', () => {
    // MeshData documents winding as unreliable, so a reversed triangle must
    // not turn an interior edge into a border.
    const consistent: TriangleSoup = {
      positions: [0, 0, 0, 10, 0, 0, 10, 0, -10, 0, 0, -10],
      indices: [0, 1, 2, 0, 2, 3],
    };
    const mixed: TriangleSoup = { ...consistent, indices: [0, 1, 2, 3, 2, 0] };
    const a = expectOk(extractPlanOutline(consistent));
    const b = expectOk(extractPlanOutline(mixed));
    assert.deepStrictEqual(pointSet(a.ring), pointSet(b.ring));
    assert.ok(Math.abs(a.area - b.area) < 1e-9);
  });

  it('refuses a closed solid, whose plan outline is a silhouette', () => {
    // Unit cube: 8 corners, 12 triangles, every edge shared.
    const positions = [
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ];
    const indices = [
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
    ];
    assert.deepStrictEqual(
      extractPlanOutline({ positions, indices }),
      { ok: false, reason: 'no-boundary' },
    );
  });

  it('reports an empty mesh as empty', () => {
    assert.deepStrictEqual(
      extractPlanOutline({ positions: [], indices: [] }),
      { ok: false, reason: 'empty' },
    );
  });

  it('returns the largest ring when a mesh has several parts', () => {
    const small = fanSoup([
      { x: 100, y: 100 }, { x: 102, y: 100 }, { x: 102, y: 102 }, { x: 100, y: 102 },
    ]);
    const big = fanSoup(square);
    const combined: TriangleSoup = {
      positions: [...Array.from(small.positions), ...Array.from(big.positions)],
      indices: [
        ...Array.from(small.indices),
        ...Array.from(big.indices).map(i => i + small.positions.length / 3),
      ],
    };
    const result = expectOk(extractPlanOutline(combined));
    assert.strictEqual(result.ringCount, 2);
    assert.ok(Math.abs(result.area - 100) < 1e-6, `area ${result.area}`);
  });

  describe('on the real parcel', () => {
    it('gives back exactly the boundary it was built from', () => {
      const result = expectOk(extractPlanOutline(fanSoup(parcel)));
      assert.strictEqual(result.ring.length, parcel.length);
      assert.deepStrictEqual(pointSet(result.ring), pointSet(parcel));
      assert.ok(
        Math.abs(result.area - Math.abs(ringSignedArea(parcel))) < 1e-3,
        `area ${result.area}`,
      );
    });

    it('survives a surface with height, as a terrain patch would', () => {
      // Vertices lifted by a smooth function: the border is a 3D curve, and
      // its projection is still the parcel.
      const soup = fanSoup(parcel);
      const lifted = Array.from(soup.positions);
      for (let i = 0; i < lifted.length; i += 3) {
        lifted[i + 1] = 300 + Math.sin(lifted[i] / 40) * 3;
      }
      const result = expectOk(extractPlanOutline({ positions: lifted, indices: soup.indices }));
      assert.deepStrictEqual(pointSet(result.ring), pointSet(parcel));
    });
  });

  it('feeds the fit end to end, from triangles to a coordinate operation', () => {
    // The whole chain: a model's site plate, sitting at a known placement, is
    // reduced to a ring and fitted back onto the published parcel.
    const truth = { eastings: 2621834.586, northings: 1259822.023, rotationDeg: 24.6, scale: 1 };
    const rad = (truth.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const localRing = parcel.map((p) => {
      const dx = p.x - truth.eastings;
      const dy = p.y - truth.northings;
      return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
    });

    const extracted = expectOk(extractPlanOutline(fanSoup(localRing, 312.5)));
    const fit = fitOutline(extracted.ring, parcel, { lockScale: 1 });
    assert.ok(fit.ok, 'fit should succeed');
    assert.ok(Math.abs(fit.solution.rotationDeg - truth.rotationDeg) < 0.05,
      `rotation ${fit.solution.rotationDeg}`);
    assert.ok(Math.abs(fit.solution.eastings - truth.eastings) < 0.05,
      `eastings ${fit.solution.eastings}`);
    assert.ok(Math.abs(fit.solution.northings - truth.northings) < 0.05,
      `northings ${fit.solution.northings}`);
  });
});
