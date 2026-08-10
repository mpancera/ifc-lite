/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { CoordinateInfo } from '@ifc-lite/geometry';

import {
  applyMapConversionAttributes,
  metreFitToMapConversion,
  planPointToIfcMetres,
  ringToIfcMetres,
} from './mesh-to-map.js';
import { solveGeoreference } from './solve-georeference.js';
import type { Point2 } from './fit-outline.js';

const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };

function coordinateInfo(
  originShift: { x: number; y: number; z: number },
  wasmRtcOffset?: { x: number; y: number; z: number },
): CoordinateInfo {
  return {
    originShift,
    originalBounds: bounds,
    shiftedBounds: bounds,
    hasLargeCoordinates: Boolean(wasmRtcOffset),
    wasmRtcOffset,
  };
}

/**
 * The forward pipeline as documented on `computeProjectedCenter`, so the test
 * inverts a construction rather than restating the implementation.
 *
 * IFC (Z-up, metres) → Y-up → minus the RTC offset and the origin shift that
 * were applied on the way out.
 */
function storedPosition(
  ifc: { x: number; y: number; z: number },
  info: CoordinateInfo,
): { x: number; y: number; z: number } {
  const rtc = info.wasmRtcOffset ?? { x: 0, y: 0, z: 0 };
  return {
    x: ifc.x - info.originShift.x - rtc.x,
    y: ifc.z - info.originShift.y - rtc.z,
    z: -ifc.y - info.originShift.z + rtc.y,
  };
}

describe('planPointToIfcMetres', () => {
  it('flips the plan axes when there is nothing to undo', () => {
    // Viewer Y-up maps to IFC Z-up as (vx,vy,vz) → (vx,-vz,vy).
    assert.deepStrictEqual(planPointToIfcMetres(12, -34, undefined), { x: 12, y: 34 });
  });

  it('undoes an origin shift', () => {
    const info = coordinateInfo({ x: -100, y: 0, z: 250 });
    const ifc = { x: 40, y: 60, z: 3 };
    const stored = storedPosition(ifc, info);
    const recovered = planPointToIfcMetres(stored.x, stored.z, info);
    assert.ok(Math.abs(recovered.x - ifc.x) < 1e-9);
    assert.ok(Math.abs(recovered.y - ifc.y) < 1e-9);
  });

  it('undoes an RTC offset stated in IFC axes', () => {
    // The double negative that would otherwise displace a georeferenced model
    // by the whole RTC offset: the offset is Z-up, so its Y component reaches
    // plan-Y through two sign flips.
    const info = coordinateInfo({ x: 0, y: 0, z: 0 }, { x: 2621750, y: 1259750, z: 300 });
    const ifc = { x: 2621834.586, y: 1259822.023, z: 306.7 };
    const stored = storedPosition(ifc, info);
    const recovered = planPointToIfcMetres(stored.x, stored.z, info);
    assert.ok(Math.abs(recovered.x - ifc.x) < 1e-6, `x ${recovered.x}`);
    assert.ok(Math.abs(recovered.y - ifc.y) < 1e-6, `y ${recovered.y}`);
  });

  it('undoes both together', () => {
    const info = coordinateInfo({ x: -12.5, y: 3, z: 44.25 }, { x: 2621750, y: 1259750, z: 300 });
    const ifc = { x: 2621900.5, y: 1259900.25, z: 310 };
    const stored = storedPosition(ifc, info);
    const recovered = planPointToIfcMetres(stored.x, stored.z, info);
    assert.ok(Math.abs(recovered.x - ifc.x) < 1e-6);
    assert.ok(Math.abs(recovered.y - ifc.y) < 1e-6);
  });
});

describe('ringToIfcMetres', () => {
  it('agrees with the single-point conversion', () => {
    const info = coordinateInfo({ x: 5, y: 0, z: -7 }, { x: 1000, y: 2000, z: 0 });
    // extractPlanOutline emits (x, -z), so feed it in that convention.
    const ring: Point2[] = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }];
    const converted = ringToIfcMetres(ring, info);
    ring.forEach((p, index) => {
      const expected = planPointToIfcMetres(p.x, -p.y, info);
      assert.deepStrictEqual(converted[index], expected);
    });
  });
});

describe('metreFitToMapConversion', () => {
  const square: Point2[] = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 },
  ];
  const truth = { eastings: 2621834.586, northings: 1259822.023, rotationDeg: 22.5 };

  /** Fit the same metre-space geometry every time, as the parcel fit does. */
  function metreSolution() {
    const rad = (truth.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const pairs = square.map(p => ({
      local: p,
      map: {
        easting: truth.eastings + p.x * cos - p.y * sin,
        northing: truth.northings + p.x * sin + p.y * cos,
      },
    }));
    const result = solveGeoreference(pairs, { lockScale: 1 });
    assert.ok(result.ok);
    return result.solution;
  }

  it('leaves a metre file against a metre CRS alone', () => {
    const attributes = metreFitToMapConversion(metreSolution(), 1, 1);
    assert.ok(Math.abs(attributes.eastings - truth.eastings) < 1e-6);
    assert.strictEqual(attributes.scale, 1);
  });

  it('gives a millimetre file the Scale the schema requires', () => {
    // The trap: the fit ran in metres and solved scale 1, but a millimetre
    // model against a metre CRS must carry Scale 0.001 or its geometry is
    // placed a thousand times too large.
    const attributes = metreFitToMapConversion(metreSolution(), 1, 0.001);
    assert.strictEqual(attributes.scale, 0.001);
    // Eastings are still metres here, because the MAP unit is metres.
    assert.ok(Math.abs(attributes.eastings - truth.eastings) < 1e-6);
  });

  it('restates the offsets when the map unit is not metres', () => {
    const attributes = metreFitToMapConversion(metreSolution(), 0.001, 0.001);
    assert.ok(Math.abs(attributes.eastings - truth.eastings * 1000) < 1e-3);
    assert.strictEqual(attributes.scale, 1);
  });

  it('carries the rotation through untouched', () => {
    const solution = metreSolution();
    for (const [mus, lus] of [[1, 1], [1, 0.001], [0.001, 0.001]]) {
      const attributes = metreFitToMapConversion(solution, mus, lus);
      assert.strictEqual(attributes.xAxisAbscissa, solution.xAxisAbscissa);
      assert.strictEqual(attributes.xAxisOrdinate, solution.xAxisOrdinate);
    }
  });

  describe('the whole bridge holds', () => {
    // The invariant that makes the conversion trustworthy: feed the produced
    // attributes a local point in the PROJECT length unit and it must land on
    // the map point, in map units — the IFC formula's own contract.
    for (const [label, mus, lus] of [
      ['metre file, metre CRS', 1, 1],
      ['millimetre file, metre CRS', 1, 0.001],
      ['metre file, millimetre CRS', 0.001, 1],
      ['millimetre file, millimetre CRS', 0.001, 0.001],
    ] as Array<[string, number, number]>) {
      it(label, () => {
        const attributes = metreFitToMapConversion(metreSolution(), mus, lus);
        for (const metrePoint of square) {
          const localInProjectUnits = { x: metrePoint.x / lus, y: metrePoint.y / lus };
          const placed = applyMapConversionAttributes(localInProjectUnits, attributes);

          const rad = (truth.rotationDeg * Math.PI) / 180;
          const expectedMetres = {
            x: truth.eastings + metrePoint.x * Math.cos(rad) - metrePoint.y * Math.sin(rad),
            y: truth.northings + metrePoint.x * Math.sin(rad) + metrePoint.y * Math.cos(rad),
          };
          // Compare in metres, so every unit pairing is judged the same way.
          assert.ok(
            Math.abs(placed.x * mus - expectedMetres.x) < 1e-3,
            `${label}: easting ${placed.x * mus} vs ${expectedMetres.x}`,
          );
          assert.ok(
            Math.abs(placed.y * mus - expectedMetres.y) < 1e-3,
            `${label}: northing ${placed.y * mus} vs ${expectedMetres.y}`,
          );
        }
      });
    }
  });
});
