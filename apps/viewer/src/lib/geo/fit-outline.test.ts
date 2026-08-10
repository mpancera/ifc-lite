/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  closestPointOnRing,
  fitOutline,
  polygonAreaCentroid,
  type Point2,
} from './fit-outline.js';
import { PARCEL_CH775979211712 } from './__fixtures__/parcel-ring.js';

const parcel: Point2[] = PARCEL_CH775979211712.map(([x, y]) => ({ x, y }));

/**
 * Resample a ring at `count` evenly spaced positions along its perimeter.
 * Stands in for a differently tessellated model outline: same shape, other
 * vertices, so the fit cannot be leaning on a vertex correspondence.
 */
function resample(ring: readonly Point2[], count: number): Point2[] {
  const lengths: number[] = [];
  let perimeter = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    perimeter += length;
  }

  const out: Point2[] = [];
  let segment = 0;
  let consumed = 0;
  for (let i = 0; i < count; i += 1) {
    const target = (i / count) * perimeter;
    while (segment < lengths.length - 1 && consumed + lengths[segment] < target) {
      consumed += lengths[segment];
      segment += 1;
    }
    const a = ring[segment];
    const b = ring[(segment + 1) % ring.length];
    const t = lengths[segment] > 0 ? (target - consumed) / lengths[segment] : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** The local ring a model would carry if it sat at the given placement. */
function localRingFor(
  mapRing: readonly Point2[],
  placement: { eastings: number; northings: number; rotationDeg: number; scale: number },
): Point2[] {
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return mapRing.map((p) => {
    const dx = p.x - placement.eastings;
    const dy = p.y - placement.northings;
    // Inverse of the IfcMapConversion rotation, then undo the scale.
    return {
      x: (dx * cos + dy * sin) / placement.scale,
      y: (-dx * sin + dy * cos) / placement.scale,
    };
  });
}

function expectOk(result: ReturnType<typeof fitOutline>) {
  assert.ok(result.ok, `expected a fit, got ${result.ok ? '' : result.reason}`);
  return result;
}

describe('polygonAreaCentroid', () => {
  it('does not move when vertices are added along an edge', () => {
    // The invariant the whole fit rests on: a tessellated outline carries
    // hundreds of points along a curve and four along a straight run, so a
    // vertex mean would sit wherever the mesher put them.
    const square: Point2[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const oversampled: Point2[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 }, { x: 8, y: 0 },
      { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const plain = polygonAreaCentroid(square);
    const dense = polygonAreaCentroid(oversampled);
    assert.ok(Math.abs(plain.x - dense.x) < 1e-9);
    assert.ok(Math.abs(plain.y - dense.y) < 1e-9);
    assert.ok(Math.abs(plain.x - 5) < 1e-9);

    // A vertex mean, by contrast, is dragged toward the dense edge.
    const vertexMeanY = oversampled.reduce((sum, p) => sum + p.y, 0) / oversampled.length;
    assert.ok(vertexMeanY < 4, `vertex mean ${vertexMeanY} should be pulled off centre`);
  });

  it('is unaffected by where the ring starts', () => {
    const rotated = [...parcel.slice(40), ...parcel.slice(0, 40)];
    const a = polygonAreaCentroid(parcel);
    const b = polygonAreaCentroid(rotated);
    assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);
  });
});

describe('closestPointOnRing', () => {
  it('measures to the boundary, including across a segment', () => {
    const square: Point2[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    // Beside an edge, not near any vertex.
    const beside = closestPointOnRing({ x: 5, y: -3 }, square);
    assert.ok(Math.abs(beside.distance - 3) < 1e-9);
    assert.ok(Math.abs(beside.point.x - 5) < 1e-9);
    // Past a corner: clamps to the vertex.
    const past = closestPointOnRing({ x: -4, y: -3 }, square);
    assert.ok(Math.abs(past.distance - 5) < 1e-9);
  });
});

describe('fitOutline', () => {
  it('recovers a placement from a resampled, re-wound outline', () => {
    const truth = { eastings: 2621834.586, northings: 1259822.023, rotationDeg: 31.4, scale: 1 };
    // Different vertex count, different starting point, opposite winding —
    // none of which the fit is allowed to depend on.
    const local = resample(localRingFor(parcel, truth), 200).reverse();

    const fit = expectOk(fitOutline(local, parcel, { lockScale: 1 }));
    assert.ok(Math.abs(fit.solution.rotationDeg - truth.rotationDeg) < 0.2,
      `rotation ${fit.solution.rotationDeg}`);
    assert.ok(Math.abs(fit.solution.eastings - truth.eastings) < 0.5,
      `eastings ${fit.solution.eastings}`);
    assert.ok(Math.abs(fit.solution.northings - truth.northings) < 0.5,
      `northings ${fit.solution.northings}`);
    assert.ok(fit.meanDistance < 0.5, `mean distance ${fit.meanDistance}`);
  });

  it('handles the unrotated case that prompted this', () => {
    const truth = { eastings: 2621834.586, northings: 1259822.023, rotationDeg: 0, scale: 1 };
    const local = resample(localRingFor(parcel, truth), 150);
    const fit = expectOk(fitOutline(local, parcel, { lockScale: 1 }));
    assert.ok(Math.abs(fit.solution.rotationDeg) < 0.2, `rotation ${fit.solution.rotationDeg}`);
    assert.ok(Math.abs(fit.solution.eastings - truth.eastings) < 0.5);
    assert.ok(Math.abs(fit.solution.northings - truth.northings) < 0.5);
  });

  it('bridges a millimetre model to a metre parcel', () => {
    const truth = { eastings: 2621834.586, northings: 1259822.023, rotationDeg: -17.25, scale: 0.001 };
    const local = resample(localRingFor(parcel, truth), 180);
    // Local coordinates are in the thousands of millimetres, as a real file's
    // would be.
    assert.ok(Math.max(...local.map(p => Math.abs(p.x))) > 10000);

    const fit = expectOk(fitOutline(local, parcel, { lockScale: 0.001 }));
    assert.ok(Math.abs(fit.solution.rotationDeg - truth.rotationDeg) < 0.2,
      `rotation ${fit.solution.rotationDeg}`);
    assert.ok(Math.abs(fit.solution.eastings - truth.eastings) < 0.5);
    assert.strictEqual(fit.solution.scale, 0.001);
  });

  it('finds a quarter turn, where a bounding box would still agree', () => {
    // The failure mode that rules out comparing extents: a square-ish plot
    // turned 90° has a near-identical bounding box and a completely wrong
    // placement.
    const truth = { eastings: 2621834.586, northings: 1259822.023, rotationDeg: 90, scale: 1 };
    const local = resample(localRingFor(parcel, truth), 160);
    const fit = expectOk(fitOutline(local, parcel, { lockScale: 1 }));
    assert.ok(Math.abs(fit.solution.rotationDeg - 90) < 0.2, `rotation ${fit.solution.rotationDeg}`);
  });

  it('reports a large distance when the outline is not that parcel', () => {
    // A plain rectangle of roughly the right size is NOT this irregular plot,
    // and the fit has to say so rather than quietly producing a placement.
    const rectangle: Point2[] = [
      { x: 0, y: 0 }, { x: 138, y: 0 }, { x: 138, y: 149 }, { x: 0, y: 149 },
    ];
    const fit = expectOk(fitOutline(rectangle, parcel, { lockScale: 1 }));
    assert.ok(fit.maxDistance > 5, `max distance ${fit.maxDistance} should expose the mismatch`);
  });

  it('refuses a ring without a shape', () => {
    const two: Point2[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    assert.deepStrictEqual(fitOutline(two, parcel), { ok: false, reason: 'degenerate-local' });
    assert.deepStrictEqual(
      fitOutline(parcel, two),
      { ok: false, reason: 'degenerate-map' },
    );
  });
});
