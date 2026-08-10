/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { solveGeoreference, type ControlPointPair } from './solve-georeference.js';

/**
 * The IFC4 IfcMapConversion formula, written out once so the tests exercise
 * the contract the solver claims to satisfy rather than re-deriving its
 * arithmetic. A solver bug and a matching bug here cannot cancel out, because
 * this is the spec text, not the implementation.
 */
function applyMapConversion(
  local: { x: number; y: number },
  c: { eastings: number; northings: number; xAxisAbscissa: number; xAxisOrdinate: number; scale: number },
): { easting: number; northing: number } {
  return {
    easting: c.eastings + c.scale * (local.x * c.xAxisAbscissa - local.y * c.xAxisOrdinate),
    northing: c.northings + c.scale * (local.x * c.xAxisOrdinate + local.y * c.xAxisAbscissa),
  };
}

function pairsFrom(
  locals: Array<{ x: number; y: number }>,
  truth: { eastings: number; northings: number; rotationDeg: number; scale: number },
): ControlPointPair[] {
  const rad = (truth.rotationDeg * Math.PI) / 180;
  const conversion = {
    eastings: truth.eastings,
    northings: truth.northings,
    xAxisAbscissa: Math.cos(rad),
    xAxisOrdinate: Math.sin(rad),
    scale: truth.scale,
  };
  return locals.map(local => ({ local, map: applyMapConversion(local, conversion) }));
}

function expectOk(result: ReturnType<typeof solveGeoreference>) {
  assert.ok(result.ok, `expected a solution, got ${result.ok ? '' : result.reason}`);
  return result.solution;
}

describe('solveGeoreference', () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 42.5, y: 0 },
    { x: 42.5, y: 17.25 },
    { x: 0, y: 17.25 },
  ];

  it('recovers a transform it was given, to the last millimetre', () => {
    const truth = { eastings: 2621834.586, northings: 1259822.023, rotationDeg: 33.75, scale: 1 };
    const solution = expectOk(solveGeoreference(pairsFrom(corners, truth), { lockScale: 1 }));

    assert.ok(Math.abs(solution.eastings - truth.eastings) < 1e-6);
    assert.ok(Math.abs(solution.northings - truth.northings) < 1e-6);
    assert.ok(Math.abs(solution.rotationDeg - truth.rotationDeg) < 1e-9);
    assert.ok(solution.maxResidual < 1e-6, `residual ${solution.maxResidual}`);
  });

  it('puts every control point back where it came from', () => {
    const truth = { eastings: 2600000, northings: 1200000, rotationDeg: -117.5, scale: 1 };
    const pairs = pairsFrom(corners, truth);
    const solution = expectOk(solveGeoreference(pairs, { lockScale: 1 }));

    for (const pair of pairs) {
      const placed = applyMapConversion(pair.local, solution);
      assert.ok(Math.abs(placed.easting - pair.map.easting) < 1e-6);
      assert.ok(Math.abs(placed.northing - pair.map.northing) < 1e-6);
    }
  });

  it('reports an unrotated model as XAxisAbscissa 1 / XAxisOrdinate 0', () => {
    const solution = expectOk(solveGeoreference(
      pairsFrom(corners, { eastings: 2621758, northings: 1259753, rotationDeg: 0, scale: 1 }),
      { lockScale: 1 },
    ));
    assert.ok(Math.abs(solution.xAxisAbscissa - 1) < 1e-12);
    assert.ok(Math.abs(solution.xAxisOrdinate) < 1e-12);
  });

  it('reports a quarter turn as XAxisAbscissa 0 / XAxisOrdinate 1', () => {
    // The convention the 004_MOD_ARC file used for its (wrong) placement.
    const solution = expectOk(solveGeoreference(
      pairsFrom(corners, { eastings: 2621758, northings: 1259753, rotationDeg: 90, scale: 1 }),
      { lockScale: 1 },
    ));
    assert.ok(Math.abs(solution.xAxisAbscissa) < 1e-12);
    assert.ok(Math.abs(solution.xAxisOrdinate - 1) < 1e-12);
  });

  it('keeps the rotation in (-180, 180]', () => {
    for (const rotationDeg of [179, -179, 90, -90, 0]) {
      const solution = expectOk(solveGeoreference(
        pairsFrom(corners, { eastings: 2600000, northings: 1200000, rotationDeg, scale: 1 }),
        { lockScale: 1 },
      ));
      assert.ok(solution.rotationDeg > -180 && solution.rotationDeg <= 180);
      assert.ok(Math.abs(solution.rotationDeg - rotationDeg) < 1e-9);
    }
  });

  describe('bridging a millimetre model to a metre CRS', () => {
    // Parcel CH775979211712 and the flat site plate from 004_MOD_ARC, which
    // turned out to BE that parcel boundary. Local coordinates in millimetres
    // (the file's project unit), map coordinates in metres.
    const pairs: ControlPointPair[] = [
      { local: { x: -57186, y: -123 }, map: { easting: 2621777.4, northing: 1259821.9 }, label: 'SW' },
      { local: { x: 80993, y: 148658 }, map: { easting: 2621915.6, northing: 1259970.6 }, label: 'NE' },
    ];

    it('recovers the origin derived by hand from the parcel geometry', () => {
      const solution = expectOk(solveGeoreference(pairs, { lockScale: 0.001 }));
      // Hand-derived: E 2621834.586 / N 1259822.023. Agreement to 5 cm is the
      // interesting claim; the inputs themselves are only decimetre-clean.
      assert.ok(
        Math.abs(solution.eastings - 2621834.586) < 0.05,
        `eastings ${solution.eastings}`,
      );
      assert.ok(
        Math.abs(solution.northings - 1259822.023) < 0.05,
        `northings ${solution.northings}`,
      );
    });

    it('finds the plate unrotated against the parcel', () => {
      const solution = expectOk(solveGeoreference(pairs, { lockScale: 0.001 }));
      assert.ok(Math.abs(solution.rotationDeg) < 0.05, `rotation ${solution.rotationDeg}`);
    });

    it('measures the scale check in ppm against the locked value', () => {
      const solution = expectOk(solveGeoreference(pairs, { lockScale: 0.001 }));
      assert.ok(solution.scaleDeviationPpm !== null);
      // The two diagonals differ by a couple of hundred ppm — the rounding in
      // the published parcel extent, not a unit problem.
      assert.ok(
        Math.abs(solution.scaleDeviationPpm) < 1000,
        `deviation ${solution.scaleDeviationPpm} ppm`,
      );
    });
  });

  describe('a mis-picked point is named, not averaged away', () => {
    const truth = { eastings: 2621834.586, northings: 1259822.023, rotationDeg: 12, scale: 1 };
    const pairs = pairsFrom(corners, truth);
    // Third point typed 3 m out — the failure the DXF aligner refuses extra
    // pairs to avoid. Residuals answer it instead of forbidding it.
    const spoiled = pairs.map((pair, index) => (
      index === 2
        ? { ...pair, map: { easting: pair.map.easting + 3, northing: pair.map.northing } }
        : pair
    ));

    it('points at the offending pair', () => {
      const solution = expectOk(solveGeoreference(spoiled, { lockScale: 1 }));
      assert.strictEqual(solution.worstPairIndex, 2);
    });

    it('leaves a residual big enough to notice', () => {
      const solution = expectOk(solveGeoreference(spoiled, { lockScale: 1 }));
      assert.ok(solution.maxResidual > 1, `max residual ${solution.maxResidual}`);
      assert.ok(solution.rmsResidual > 0.5, `rms ${solution.rmsResidual}`);
    });

    it('still fits the untouched pairs far better than the bad one', () => {
      const solution = expectOk(solveGeoreference(spoiled, { lockScale: 1 }));
      const others = solution.residuals.filter((_, index) => index !== 2);
      for (const residual of others) {
        assert.ok(residual < solution.maxResidual);
      }
    });
  });

  describe('when the scale is left free', () => {
    it('recovers a model authored in the wrong unit', () => {
      // Local coordinates a thousand times too large: the classic millimetre
      // model handed over as if it were metres.
      const truth = { eastings: 2621834.586, northings: 1259822.023, rotationDeg: 5, scale: 0.001 };
      const solution = expectOk(solveGeoreference(pairsFrom(
        corners.map(c => ({ x: c.x * 1000, y: c.y * 1000 })),
        truth,
      )));
      assert.ok(Math.abs(solution.solvedScale - 0.001) < 1e-9, `scale ${solution.solvedScale}`);
    });

    it('reports no deviation, because there is nothing to deviate from', () => {
      const solution = expectOk(solveGeoreference(
        pairsFrom(corners, { eastings: 2600000, northings: 1200000, rotationDeg: 0, scale: 1 }),
      ));
      assert.strictEqual(solution.scaleDeviationPpm, null);
      assert.strictEqual(solution.scale, solution.solvedScale);
    });
  });

  describe('refusals', () => {
    it('needs at least two pairs', () => {
      const one: ControlPointPair[] = [
        { local: { x: 0, y: 0 }, map: { easting: 2600000, northing: 1200000 } },
      ];
      assert.deepStrictEqual(solveGeoreference(one), { ok: false, reason: 'too-few-pairs' });
      assert.deepStrictEqual(solveGeoreference([]), { ok: false, reason: 'too-few-pairs' });
    });

    it('distinguishes points stacked in the model from points stacked on the map', () => {
      const stackedLocal: ControlPointPair[] = [
        { local: { x: 5, y: 5 }, map: { easting: 2600000, northing: 1200000 } },
        { local: { x: 5, y: 5 }, map: { easting: 2600010, northing: 1200010 } },
      ];
      const stackedMap: ControlPointPair[] = [
        { local: { x: 0, y: 0 }, map: { easting: 2600000, northing: 1200000 } },
        { local: { x: 10, y: 10 }, map: { easting: 2600000, northing: 1200000 } },
      ];
      assert.deepStrictEqual(
        solveGeoreference(stackedLocal),
        { ok: false, reason: 'coincident-local' },
      );
      assert.deepStrictEqual(
        solveGeoreference(stackedMap),
        { ok: false, reason: 'coincident-map' },
      );
    });
  });
});
