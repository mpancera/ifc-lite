/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_ZONE_SIZE, NEW_ZONE_FOOTPRINT_FRACTION, defaultZoneGeometry,
  mergeBounds, preferBounds,
} from './default-zone.js';

/** Roughly Marc's model: origin at a corner of the site, not at its middle. */
const REAL_MODEL = { min: [-58.6, -2.4, -17.2], max: [68.6, 9.0, 73.7] } as const;

describe('defaultZoneGeometry', () => {
  it('centres the box on the model, not on the world origin', () => {
    // The reported bug: the origin sits at the EDGE of a real site, so the
    // fixed box appeared as a speck at the corner and classified nothing.
    const { center } = defaultZoneGeometry(REAL_MODEL);

    assert.equal(center[0], (-58.6 + 68.6) / 2);
    assert.equal(center[2], (-17.2 + 73.7) / 2);
  });

  it('spans a readable share of the footprint', () => {
    const { size } = defaultZoneGeometry(REAL_MODEL);

    assert.equal(size[0], (68.6 - -58.6) * NEW_ZONE_FOOTPRINT_FRACTION);
    assert.equal(size[2], (73.7 - -17.2) * NEW_ZONE_FOOTPRINT_FRACTION);
  });

  it('takes the FULL height', () => {
    // A compartment that stops halfway up silently excludes everything above,
    // and too-short is invisible while too-tall is obvious.
    const { size, center } = defaultZoneGeometry(REAL_MODEL);

    assert.equal(size[1], 9.0 - -2.4);
    assert.equal(center[1], (-2.4 + 9.0) / 2);
  });

  it('lands inside the model bounds on every axis', () => {
    const { center, size } = defaultZoneGeometry(REAL_MODEL);

    for (const a of [0, 1, 2]) {
      assert.ok(center[a] - size[a] / 2 >= REAL_MODEL.min[a] - 1e-9, `axis ${a} low`);
      assert.ok(center[a] + size[a] / 2 <= REAL_MODEL.max[a] + 1e-9, `axis ${a} high`);
    }
  });

  it('falls back to the fixed box when nothing is loaded', () => {
    const zone = defaultZoneGeometry(null);

    assert.deepEqual(zone.center, [0, 0, 0]);
    assert.deepEqual(zone.size, [...FALLBACK_ZONE_SIZE]);
  });

  it('survives a flat site without producing a zero-height box', () => {
    // A box with no height can never contain anything — the same failure the
    // fix is about, arrived at from the other direction.
    const flat = { min: [0, 4, 0], max: [30, 4, 30] } as const;
    const { size } = defaultZoneGeometry(flat);

    assert.equal(size[1], FALLBACK_ZONE_SIZE[1]);
    assert.ok(size[0] > 0 && size[2] > 0);
  });

  it('survives a single-point scene', () => {
    const point = { min: [5, 5, 5], max: [5, 5, 5] } as const;
    const { center, size } = defaultZoneGeometry(point);

    assert.deepEqual(center, [5, 5, 5]);
    assert.deepEqual(size, [...FALLBACK_ZONE_SIZE]);
  });

  it('never rotates a fresh zone', () => {
    assert.equal(defaultZoneGeometry(REAL_MODEL).rotationY, 0);
    assert.equal(defaultZoneGeometry(null).rotationY, 0);
  });
});

describe('mergeBounds', () => {
  it('unions the boxes', () => {
    const merged = mergeBounds([
      { min: [0, 0, 0], max: [10, 3, 10] },
      { min: [-5, 2, 4], max: [4, 9, 20] },
    ])!;

    assert.deepEqual(merged.min, [-5, 0, 0]);
    assert.deepEqual(merged.max, [10, 9, 20]);
  });

  it('passes a single box through', () => {
    const one = { min: [1, 2, 3], max: [4, 5, 6] } as const;
    assert.deepEqual(mergeBounds([one]), { min: [1, 2, 3], max: [4, 5, 6] });
  });

  it('reports null for nothing at all', () => {
    assert.equal(mergeBounds([]), null);
  });
});

describe('preferBounds', () => {
  // The real case: the terrain dwarfs the building and sits around it, so the
  // rooms are the honest answer to "where is the building".
  const rooms = { min: [14.3, -2.4, -60.5], max: [58.8, 12.2, -22.6] } as const;
  const scene = { min: [-57.2, -2.7, -148.7], max: [81, 12.2, 0.1] } as const;

  it('takes the first usable candidate', () => {
    assert.deepEqual(preferBounds(rooms, scene), rooms);
  });

  it('skips a missing candidate', () => {
    assert.deepEqual(preferBounds(null, scene), scene);
  });

  it('skips a degenerate candidate', () => {
    // A model with no rooms would otherwise centre the zone on a point.
    const point = { min: [1, 1, 1], max: [1, 1, 1] } as const;
    assert.deepEqual(preferBounds(point, scene), scene);
  });

  it('reports null when nothing is usable', () => {
    assert.equal(preferBounds(null, null), null);
  });

  it('feeds a box that actually covers the building', () => {
    // End to end: the measured failure was a default box catching 0 of 331
    // elements because it sat on the terrain instead of the building.
    const { center, size } = defaultZoneGeometry(preferBounds(rooms, scene));

    assert.ok(center[0] > rooms.min[0] && center[0] < rooms.max[0]);
    assert.ok(center[2] > rooms.min[2] && center[2] < rooms.max[2]);
    assert.ok(size[0] > 10 && size[2] > 10, 'large enough to contain rooms');
  });
});
