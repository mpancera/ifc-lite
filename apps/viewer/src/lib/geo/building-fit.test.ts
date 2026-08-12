/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  compareCrsNames,
  fitFootprintToReference,
  looksLikeUniformInset,
  placementShiftMetres,
} from './building-fit.js';
import { applyMapConversionAttributes } from './mesh-to-map.js';
import type { Point2 } from './fit-outline.js';

/**
 * A building 20 × 12 m, in LV95 metres. Stands in for the surveyed reference.
 */
const REFERENCE: Point2[] = [
  { x: 2665000, y: 1245000 },
  { x: 2665020, y: 1245000 },
  { x: 2665020, y: 1245012 },
  { x: 2665000, y: 1245012 },
];

/** The same building modelled about a local origin, in metres. */
const LOCAL: Point2[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 12 },
  { x: 0, y: 12 },
];

/** Move a ring bodily. */
const shifted = (ring: readonly Point2[], dx: number, dy: number): Point2[] =>
  ring.map(p => ({ x: p.x + dx, y: p.y + dy }));

describe('fitFootprintToReference', () => {
  it('places a local model onto its surveyed outline', () => {
    const result = fitFootprintToReference({
      localRing: LOCAL,
      referenceRing: REFERENCE,
      mapUnitScale: 1,
      lengthUnitScale: 1,
      lockRotationDeg: 0,
    });
    assert.ok(result.ok);

    // The transform is what matters, so check it by USING it: the model's own
    // corner must land on the surveyed corner.
    const placed = applyMapConversionAttributes(LOCAL[0], result.report.attributes);
    assert.ok(Math.abs(placed.x - REFERENCE[0].x) < 1e-6, `easting off by ${placed.x - REFERENCE[0].x}`);
    assert.ok(Math.abs(placed.y - REFERENCE[0].y) < 1e-6, `northing off by ${placed.y - REFERENCE[0].y}`);
  });

  it('holds the rotation it was given and says so', () => {
    const result = fitFootprintToReference({
      localRing: LOCAL,
      referenceRing: REFERENCE,
      mapUnitScale: 1,
      lengthUnitScale: 1,
      lockRotationDeg: 0,
    });
    assert.ok(result.ok);

    assert.equal(result.report.rotationDeg, 0);
    assert.equal(result.report.rotationWasHeld, true);
    assert.equal(result.report.attributes.xAxisAbscissa, 1);
    assert.equal(result.report.attributes.xAxisOrdinate, 0);
  });

  it('searches for the rotation when none is held', () => {
    const result = fitFootprintToReference({
      localRing: LOCAL,
      referenceRing: REFERENCE,
      mapUnitScale: 1,
      lengthUnitScale: 1,
    });
    assert.ok(result.ok);

    assert.equal(result.report.rotationWasHeld, false);
  });

  it('carries the millimetre model unit into Scale, not into the position', () => {
    // The same building drawn in millimetres. The fit is handed metres either
    // way; what changes is the bridge IfcMapConversion.Scale has to state.
    const result = fitFootprintToReference({
      localRing: LOCAL,
      referenceRing: REFERENCE,
      mapUnitScale: 1,
      lengthUnitScale: 0.001,
      lockRotationDeg: 0,
    });
    assert.ok(result.ok);

    assert.equal(result.report.attributes.scale, 0.001);
    // Eastings stay in map units — a millimetre file does not move the plot.
    assert.ok(Math.abs(result.report.attributes.eastings - REFERENCE[0].x) < 1e-6);
  });

  it('reads a foot-unit reference as feet, not as metres', () => {
    // The one error this module exists to prevent: the reference arrives in the
    // map unit, and a US survey foot grid read as metres puts the building a
    // third of the way out of its own plot with an ordinary-looking residual.
    const feetPerMetre = 1 / 0.3048;
    const referenceInFeet = REFERENCE.map(p => ({ x: p.x * feetPerMetre, y: p.y * feetPerMetre }));

    const result = fitFootprintToReference({
      localRing: LOCAL.map(p => ({ x: p.x, y: p.y })),
      referenceRing: referenceInFeet,
      mapUnitScale: 0.3048,
      lengthUnitScale: 1,
      lockRotationDeg: 0,
    });
    assert.ok(result.ok);

    // The attributes are in map units (feet), so applying them must reproduce
    // the reference ring as it was given.
    const placed = applyMapConversionAttributes(LOCAL[0], result.report.attributes);
    assert.ok(
      Math.abs(placed.x - referenceInFeet[0].x) < 1e-3,
      `easting off by ${placed.x - referenceInFeet[0].x} ft`,
    );
    // A metre model in a foot grid: Scale bridges the two.
    assert.ok(Math.abs(result.report.attributes.scale - feetPerMetre) < 1e-9);
    // And the residual is reported in metres, not in feet.
    assert.ok(result.report.meanDistance < 1e-3, `got ${result.report.meanDistance} m`);
  });

  it('reports the distances a person has to see before applying', () => {
    // One corner pulled 3 m out, as a bay window present in one source and not
    // the other would be.
    const dented = [...LOCAL];
    dented[0] = { x: dented[0].x - 3, y: dented[0].y - 3 };

    const result = fitFootprintToReference({
      localRing: dented,
      referenceRing: REFERENCE,
      mapUnitScale: 1,
      lengthUnitScale: 1,
      lockRotationDeg: 0,
    });
    assert.ok(result.ok);

    assert.ok(result.report.maxDistance > 1, `got ${result.report.maxDistance} m`);
    assert.ok(result.report.meanDistance > 0);
    assert.equal(result.report.localVertexCount, 4);
    assert.equal(result.report.referenceVertexCount, 4);
  });

  it('refuses a reference that is not a ring', () => {
    const result = fitFootprintToReference({
      localRing: LOCAL,
      referenceRing: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      mapUnitScale: 1,
      lengthUnitScale: 1,
      lockRotationDeg: 0,
    });

    assert.deepEqual(result, { ok: false, reason: 'degenerate-map' });
  });
});

describe('placementShiftMetres', () => {
  it('measures how far the model would move', () => {
    const result = fitFootprintToReference({
      localRing: LOCAL,
      referenceRing: shifted(REFERENCE, 30, 40),
      mapUnitScale: 1,
      lengthUnitScale: 1,
      lockRotationDeg: 0,
    });
    assert.ok(result.ok);

    const shift = placementShiftMetres(
      { eastings: REFERENCE[0].x, northings: REFERENCE[0].y },
      result.report.attributes,
      1,
    );
    assert.ok(shift !== null);
    assert.ok(Math.abs(shift - 50) < 1e-6, `got ${shift} m`);
  });

  it('converts a foot-grid shift to metres', () => {
    const shift = placementShiftMetres(
      { eastings: 0, northings: 0 },
      { eastings: 100, northings: 0, xAxisAbscissa: 1, xAxisOrdinate: 0, scale: 1 },
      0.3048,
    );
    assert.ok(shift !== null);
    assert.ok(Math.abs(shift - 30.48) < 1e-9, `got ${shift} m`);
  });

  it('says nothing when there is no placement to move from', () => {
    const shift = placementShiftMetres(
      undefined,
      { eastings: 100, northings: 0, xAxisAbscissa: 1, xAxisOrdinate: 0, scale: 1 },
      1,
    );
    assert.equal(shift, null);
  });
});

describe('looksLikeUniformInset', () => {
  it('recognises a footprint that is smaller all the way round', () => {
    // The roof-overhang case: the reference surveyed at the facade, the model
    // silhouette out at the eaves. Fitting them is correct and the gap stays.
    const inset = 0.6;
    const local: Point2[] = [
      { x: inset, y: inset },
      { x: 20 - inset, y: inset },
      { x: 20 - inset, y: 12 - inset },
      { x: inset, y: 12 - inset },
    ];

    const result = fitFootprintToReference({
      localRing: local,
      referenceRing: REFERENCE,
      mapUnitScale: 1,
      lengthUnitScale: 1,
      lockRotationDeg: 0,
    });
    assert.ok(result.ok);

    assert.equal(
      looksLikeUniformInset(result.report.meanDistance, result.report.maxDistance),
      true,
      `mean ${result.report.meanDistance} / max ${result.report.maxDistance}`,
    );
  });

  it('does not call a one-sided error uniform', () => {
    // Half a metre out on one side only — a real position error, and moving the
    // model WOULD close it. Must not be excused as an overhang.
    const local: Point2[] = [
      { x: 0, y: 0 },
      { x: 20.6, y: 0 },
      { x: 20.6, y: 12 },
      { x: 0, y: 12 },
    ];

    const result = fitFootprintToReference({
      localRing: local,
      referenceRing: REFERENCE,
      mapUnitScale: 1,
      lengthUnitScale: 1,
      lockRotationDeg: 0,
    });
    assert.ok(result.ok);

    assert.equal(
      looksLikeUniformInset(result.report.meanDistance, result.report.maxDistance),
      false,
      `mean ${result.report.meanDistance} / max ${result.report.maxDistance}`,
    );
  });

  it('stays quiet at survey tolerance', () => {
    assert.equal(looksLikeUniformInset(0.05, 0.06), false);
  });
});

describe('compareCrsNames', () => {
  it('matches the same grid written two ways', () => {
    assert.equal(compareCrsNames('EPSG:2056', 'urn:ogc:def:crs:EPSG::2056'), 'match');
  });

  it('catches the two Swiss grids being confused', () => {
    // LV03 and LV95 are ~100 m apart: near enough that the fit succeeds, far
    // enough that the building ends up somewhere else.
    assert.equal(compareCrsNames('EPSG:2056', 'EPSG:21781'), 'mismatch');
  });

  it('does not turn a name without a code into a mismatch', () => {
    assert.equal(compareCrsNames('CH1903+ / LV95', 'EPSG:2056'), 'unknown');
    assert.equal(compareCrsNames(undefined, 'EPSG:2056'), 'unknown');
  });
});
