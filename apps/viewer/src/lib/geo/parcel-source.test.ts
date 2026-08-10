/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  parcelSourceForCrs,
  parseParcelGeometry,
  swissParcelSource,
} from './parcel-source.js';

/** The shape geo.admin.ch returns for a plain single-part plot. */
function polygonResponse(ring: Array<[number, number]>) {
  return { results: [{ geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

describe('parseParcelGeometry', () => {
  const square: Array<[number, number]> = [
    [2621777.4, 1259821.9],
    [2621915.6, 1259821.9],
    [2621915.6, 1259970.6],
    [2621777.4, 1259970.6],
  ];

  it('reads a single-part boundary', () => {
    const ring = parseParcelGeometry(polygonResponse(square));
    assert.ok(ring);
    assert.strictEqual(ring.length, 4);
    assert.deepStrictEqual(ring[0], { x: 2621777.4, y: 1259821.9 });
  });

  it('drops the repeated closing vertex', () => {
    // GeoJSON closes its rings; the fit treats them as implicitly closed, and
    // a duplicate would weight that one vertex twice.
    const closed = [...square, square[0]];
    const ring = parseParcelGeometry(polygonResponse(closed));
    assert.ok(ring);
    assert.strictEqual(ring.length, 4);
  });

  it('reaches through the deeper nesting of a multi-part plot', () => {
    const multi = {
      results: [{ geometry: { type: 'MultiPolygon', coordinates: [[square]] } }],
    };
    const ring = parseParcelGeometry(multi);
    assert.ok(ring);
    assert.strictEqual(ring.length, 4);
  });

  it('returns null for an empty result set', () => {
    assert.strictEqual(parseParcelGeometry({ results: [] }), null);
  });

  it('returns null for anything without a usable ring', () => {
    for (const payload of [
      null,
      undefined,
      {},
      { results: [{}] },
      { results: [{ geometry: {} }] },
      // Two vertices are a line, not a boundary.
      polygonResponse([[2621777.4, 1259821.9], [2621915.6, 1259821.9]]),
    ]) {
      assert.strictEqual(parseParcelGeometry(payload), null, `expected null for ${JSON.stringify(payload)}`);
    }
  });
});

describe('swissParcelSource.fetchParcel', () => {
  it('rejects a malformed E-GRID without touching the network', async () => {
    // Checked before the privacy gate on purpose: a typo is not a privacy
    // decision, and reporting it as one would send the user to the wrong fix.
    for (const identifier of ['', 'CH123', '775979211712', 'CH77597921171X', 'CH7759792117123']) {
      const result = await swissParcelSource.fetchParcel(identifier);
      assert.deepStrictEqual(
        result,
        { ok: false, reason: 'invalid-identifier' },
        `expected rejection for "${identifier}"`,
      );
    }
  });

  it('refuses to look anything up while external requests are off', async () => {
    // No window in the test runner, so the gate reports "not allowed" — the
    // documented fail-closed direction. A well-formed E-GRID must still stop
    // here rather than reaching geo.admin.ch.
    const result = await swissParcelSource.fetchParcel('CH775979211712');
    assert.deepStrictEqual(result, { ok: false, reason: 'external-requests-disabled' });
  });

  it('accepts lower case and surrounding whitespace', async () => {
    // Reaches the privacy gate rather than the format check, which is how we
    // know normalisation happened.
    const result = await swissParcelSource.fetchParcel('  ch775979211712  ');
    assert.deepStrictEqual(result, { ok: false, reason: 'external-requests-disabled' });
  });
});

describe('parcelSourceForCrs', () => {
  it('matches the Swiss source to LV95', () => {
    assert.strictEqual(parcelSourceForCrs('EPSG:2056'), swissParcelSource);
    assert.strictEqual(parcelSourceForCrs(' epsg:2056 '), swissParcelSource);
  });

  it('offers nothing for a CRS with no cadastre behind it', () => {
    // The honest answer for a model in UTM32N: parcel fitting is simply not
    // available, rather than a Swiss lookup that would return nothing.
    assert.strictEqual(parcelSourceForCrs('EPSG:25832'), null);
    assert.strictEqual(parcelSourceForCrs(undefined), null);
  });
});
