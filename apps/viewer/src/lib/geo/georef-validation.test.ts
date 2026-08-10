/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { MapConversion, ProjectedCRS, SiteReferenceLocation } from '@ifc-lite/parser';

import {
  matchVendorDefaultSiteLocation,
  validateGeoreference,
  ROUND_TRIP_TOLERANCE_M,
} from './georef-validation.js';

const swissCRS: ProjectedCRS = {
  id: 1,
  name: 'EPSG:2056',
  description: 'CH1903+ / LV95',
  mapUnit: 'METRE',
  mapUnitScale: 1,
};

function conversion(overrides: Partial<MapConversion> = {}): MapConversion {
  return {
    id: 2,
    sourceCRS: 0,
    targetCRS: 1,
    eastings: 2621834.586,
    northings: 1259822.023,
    orthogonalHeight: 306.7,
    xAxisAbscissa: 1,
    xAxisOrdinate: 0,
    scale: 1,
    ...overrides,
  };
}

function codes(findings: ReturnType<typeof validateGeoreference>): string[] {
  return findings.map(finding => finding.code);
}

describe('validateGeoreference', () => {
  it('passes a correctly referenced model without complaint', () => {
    const findings = validateGeoreference({
      projectedCRS: swissCRS,
      mapConversion: conversion(),
      // IfcSite rounded to the nearest second, as authoring tools write it.
      siteReference: { expressId: 9, latitude: 47.4888, longitude: 7.7283, elevation: 306.7 },
      derivedLatLon: { lat: 47.488798, lon: 7.728347 },
      roundTripResidual: 0.0012,
      lengthUnitScale: 1,
    });
    assert.deepStrictEqual(findings, []);
  });

  it('tolerates an IfcSite that names the town rather than the plot', () => {
    // Liestal town centre vs. the actual parcel — ~2 km apart, which is
    // ordinary practice and must not be reported.
    const findings = validateGeoreference({
      projectedCRS: swissCRS,
      mapConversion: conversion(),
      siteReference: { expressId: 9, latitude: 47.4839, longitude: 7.7355, elevation: 327 },
      derivedLatLon: { lat: 47.488798, lon: 7.728347 },
      lengthUnitScale: 1,
    });
    assert.deepStrictEqual(findings, []);
  });

  describe('the 004_MOD_ARC case: a model that was never georeferenced', () => {
    // Real values from an architectural model delivered against parcel
    // CH775979211712. Its IfcMapConversion carries eastings/northings far
    // outside LV95, while IfcSite still holds the authoring tool's default
    // location — the two disagree by most of the planet.
    const siteReference: SiteReferenceLocation = {
      expressId: 174,
      latitude: 37.795,        // 37° 47' 42"
      longitude: -122.393889,  // -122° 23' 38"
      elevation: 356.047,
    };
    const brokenConversion = conversion({
      eastings: -6369756.24665224,
      northings: 8016565.41270915,
      orthogonalHeight: 0,
      xAxisAbscissa: 0,
      xAxisOrdinate: 1,
      scale: undefined,
    });
    // Where EPSG:2056 actually puts those eastings/northings, and what the
    // round trip through proj4 costs there (measured, not assumed).
    const derivedLatLon = { lat: 37.796393, lon: 57.468487 };
    const roundTripResidual = 14654869.88;

    it('reports the contradiction between the two location statements', () => {
      const findings = validateGeoreference({
        projectedCRS: swissCRS,
        mapConversion: brokenConversion,
        siteReference,
        derivedLatLon,
        roundTripResidual,
        lengthUnitScale: 0.001,
      });
      const conflict = findings.find(f => f.code === 'site-location-conflict');
      assert.ok(conflict, 'expected a site-location-conflict finding');
      assert.strictEqual(conflict.severity, 'error');
      // Both statements are named so the reader knows which two to compare.
      // (The distance itself is locale-formatted, so it isn't asserted here.)
      assert.match(conflict.detail, /IfcMapConversion/);
      assert.match(conflict.detail, /IfcSite/);
    });

    it('names the untouched vendor default', () => {
      const findings = validateGeoreference({
        projectedCRS: swissCRS,
        mapConversion: brokenConversion,
        siteReference,
        derivedLatLon,
        roundTripResidual,
        lengthUnitScale: 0.001,
      });
      const vendor = findings.find(f => f.code === 'site-location-is-vendor-default');
      assert.ok(vendor, 'expected a vendor-default finding');
      assert.match(vendor.detail, /San Francisco/);
    });

    it('flags the millimetre model written against a metre map unit', () => {
      const findings = validateGeoreference({
        projectedCRS: swissCRS,
        mapConversion: brokenConversion,
        siteReference,
        derivedLatLon,
        roundTripResidual,
        lengthUnitScale: 0.001,
      });
      assert.ok(findings.some(f => f.code === 'scale-unit-mismatch'));
    });

    it('orders errors ahead of warnings', () => {
      const findings = validateGeoreference({
        projectedCRS: swissCRS,
        mapConversion: brokenConversion,
        siteReference,
        derivedLatLon,
        roundTripResidual,
        lengthUnitScale: 0.001,
      });
      const firstWarning = findings.findIndex(f => f.severity === 'warning');
      const lastError = findings.map(f => f.severity).lastIndexOf('error');
      assert.ok(firstWarning === -1 || lastError < firstWarning);
    });
  });

  describe('round-trip residual', () => {
    it('reports coordinates the projection cannot represent', () => {
      const findings = validateGeoreference({
        projectedCRS: swissCRS,
        mapConversion: conversion({ eastings: -6369756, northings: 8016565 }),
        roundTripResidual: 14654869.88,
        lengthUnitScale: 1,
      });
      assert.deepStrictEqual(codes(findings), ['coordinates-outside-projection-domain']);
    });

    it('stays silent at the measured noise floor of a valid coordinate', () => {
      const findings = validateGeoreference({
        projectedCRS: swissCRS,
        mapConversion: conversion(),
        roundTripResidual: ROUND_TRIP_TOLERANCE_M - 0.0001,
        lengthUnitScale: 1,
      });
      assert.deepStrictEqual(findings, []);
    });

    it('stays silent when the caller could not measure one', () => {
      // A clean round trip proves nothing (transverse Mercator round-trips
      // absurd values perfectly), so an absent measurement is not a finding.
      for (const residual of [null, undefined]) {
        const findings = validateGeoreference({
          projectedCRS: swissCRS,
          mapConversion: conversion({ eastings: -6369756, northings: 8016565 }),
          roundTripResidual: residual,
          lengthUnitScale: 1,
        });
        assert.deepStrictEqual(findings, []);
      }
    });
  });

  describe('matchVendorDefaultSiteLocation', () => {
    it('recognises the Revit default', () => {
      assert.match(
        String(matchVendorDefaultSiteLocation({ latitude: 37.795, longitude: -122.393889 })),
        /San Francisco/,
      );
    });

    it('recognises an unpopulated 0/0', () => {
      assert.ok(matchVendorDefaultSiteLocation({ latitude: 0, longitude: 0 }));
    });

    it('does not fire on a real project location', () => {
      assert.strictEqual(
        matchVendorDefaultSiteLocation({ latitude: 47.4888, longitude: 7.7283 }),
        null,
      );
    });

    it('does not fire on a real San Francisco project', () => {
      // A genuine building 5 km from the template's coordinates must pass.
      assert.strictEqual(
        matchVendorDefaultSiteLocation({ latitude: 37.7402, longitude: -122.4512 }),
        null,
      );
    });
  });

  it('produces nothing when the model carries no georeferencing at all', () => {
    assert.deepStrictEqual(validateGeoreference({}), []);
  });

  it('checks the site location even without a coordinate operation', () => {
    const findings = validateGeoreference({
      siteReference: { expressId: 9, latitude: 37.795, longitude: -122.393889, elevation: 0 },
    });
    assert.deepStrictEqual(codes(findings), ['site-location-is-vendor-default']);
  });
});
