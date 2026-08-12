/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { collectRings, declaredCrs, findIdentifier, parseOutlineGeoJson } from './reference-outline.js';

/** A small LV95 building ring near Baden, closed the way GeoJSON closes rings. */
const LV95_RING = [
  [2665400, 1258200], [2665420, 1258200], [2665420, 1258215],
  [2665400, 1258215], [2665400, 1258200],
];

function featureCollection(ring: number[][], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    ...extra,
    features: [{
      type: 'Feature',
      properties: { EGID: '2355731' },
      geometry: { type: 'Polygon', coordinates: [ring] },
    }],
  });
}

describe('parseOutlineGeoJson', () => {
  it('reads a projected ring out of a FeatureCollection', () => {
    const result = parseOutlineGeoJson(featureCollection(LV95_RING), { assumeCrs: 'EPSG:2056' });
    assert.ok(result.ok);

    assert.equal(result.outline.ring.length, 4);
    assert.deepEqual(result.outline.ring[0], { x: 2665400, y: 1258200 });
  });

  it('drops the repeated closing vertex', () => {
    // The fit treats rings as implicitly closed; a duplicate would weight that
    // vertex twice in the centroid and in every residual.
    const result = parseOutlineGeoJson(featureCollection(LV95_RING), { assumeCrs: 'EPSG:2056' });
    assert.ok(result.ok);

    const ring = result.outline.ring;
    assert.notDeepEqual(ring[0], ring[ring.length - 1]);
  });

  it('picks up the identifier the file carries', () => {
    const result = parseOutlineGeoJson(featureCollection(LV95_RING), { assumeCrs: 'EPSG:2056' });
    assert.ok(result.ok);

    assert.equal(result.outline.identifier, '2355731');
  });

  it('prefers the CRS the file names over the assumption', () => {
    // The file knows; the caller only guesses.
    const named = featureCollection(LV95_RING, {
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2056' } },
    });

    const result = parseOutlineGeoJson(named, { assumeCrs: 'EPSG:21781' });
    assert.ok(result.ok);

    assert.equal(result.outline.crsName, 'EPSG:2056');
  });

  it('refuses degrees, rather than fitting against them', () => {
    // The failure this module exists for. Read as longitude and latitude, a
    // Swiss building lands in the Gulf of Guinea and the fit then reports a
    // two-million-metre shift, which reads as a broken model.
    const degrees = featureCollection([
      [8.30, 47.47], [8.31, 47.47], [8.31, 47.48], [8.30, 47.48], [8.30, 47.47],
    ]);

    const result = parseOutlineGeoJson(degrees, { assumeCrs: 'EPSG:2056' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'degrees-not-projected');
  });

  it('accepts degrees when the file itself says which CRS', () => {
    // Then it is not a guess any more, and reprojection is somebody's job.
    const degrees = featureCollection([
      [8.30, 47.47], [8.31, 47.47], [8.31, 47.48], [8.30, 47.48], [8.30, 47.47],
    ], { crs: 'EPSG:4326' });

    const result = parseOutlineGeoJson(degrees);
    assert.ok(result.ok);
    assert.equal(result.outline.crsName, 'EPSG:4326');
  });

  it('refuses projected coordinates when nobody says which system', () => {
    // Degrees and metres are safe to tell apart; two projected systems are not.
    const result = parseOutlineGeoJson(featureCollection(LV95_RING));

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'crs-unknown');
  });

  it('takes the largest ring and says how many there were', () => {
    // A courtyard arrives as an inner ring of the same polygon; the outer one
    // is the footprint.
    const withHole = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          LV95_RING,
          [[2665405, 1258205], [2665410, 1258205], [2665410, 1258210], [2665405, 1258205]],
        ],
      },
    });

    const result = parseOutlineGeoJson(withHole, { assumeCrs: 'EPSG:2056' });
    assert.ok(result.ok);

    assert.equal(result.outline.candidateCount, 2);
    assert.equal(result.outline.ring.length, 4);
    assert.deepEqual(result.outline.ring[0], { x: 2665400, y: 1258200 });
  });

  it('reads a bare geometry as readily as a collection', () => {
    const bare = JSON.stringify({ type: 'Polygon', coordinates: [LV95_RING] });

    const result = parseOutlineGeoJson(bare, { assumeCrs: 'EPSG:2056' });
    assert.ok(result.ok);
    assert.equal(result.outline.ring.length, 4);
  });

  it('says so when the text is not JSON', () => {
    assert.deepEqual(parseOutlineGeoJson('0 SECTION\n2 ENTITIES'), { ok: false, reason: 'not-json' });
  });

  it('says so when there is no polygon in it', () => {
    const points = JSON.stringify({ type: 'Point', coordinates: [2665400, 1258200] });

    assert.deepEqual(parseOutlineGeoJson(points), { ok: false, reason: 'no-polygon' });
  });

  it('says so when the ring has no shape', () => {
    const line = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[2665400, 1258200], [2665420, 1258200], [2665400, 1258200]]],
    });

    const result = parseOutlineGeoJson(line, { assumeCrs: 'EPSG:2056' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'too-few-vertices');
  });
});

describe('collectRings', () => {
  it('finds rings however they are nested', () => {
    // MultiPolygon nests one level deeper than Polygon, and the difference says
    // nothing about the boundary.
    const multi = {
      type: 'MultiPolygon',
      coordinates: [[LV95_RING], [LV95_RING]],
    };

    assert.equal(collectRings(multi).length, 2);
  });

  it('does not mistake a bounding box for a ring', () => {
    // `bbox` is a flat array of four numbers, not an array of positions.
    assert.equal(collectRings({ bbox: [2665400, 1258200, 2665420, 1258215] }).length, 0);
  });

  it('finds nothing in an empty document', () => {
    assert.deepEqual(collectRings({}), []);
  });
});

describe('declaredCrs', () => {
  it('reads the OGC urn form', () => {
    assert.equal(
      declaredCrs({ crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2056' } } }),
      'EPSG:2056',
    );
  });

  it('reads the short form a hand-rolled export writes', () => {
    assert.equal(declaredCrs({ crs: 'EPSG:2056' }), 'EPSG:2056');
  });

  it('returns nothing when the file is silent', () => {
    assert.equal(declaredCrs({ type: 'FeatureCollection', features: [] }), null);
  });
});

describe('findIdentifier', () => {
  it('finds an EGID whatever its casing', () => {
    assert.equal(findIdentifier({ properties: { egid: 2355731 } }), '2355731');
    assert.equal(findIdentifier({ properties: { EGID: '2355731' } }), '2355731');
  });

  it('returns nothing rather than an empty string', () => {
    assert.equal(findIdentifier({ properties: { EGID: '  ' } }), null);
  });

  it('returns nothing when the file carries no identifier', () => {
    assert.equal(findIdentifier({ properties: { name: 'Haus' } }), null);
  });
});
