/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { findScaleHints, metresPerPoint, resolvePdfUnits } from './scale.js';

describe('findScaleHints', () => {
  it('reads 1_100 from a file name and 1:50 from a sheet', () => {
    expect(findScaleHints({ fileName: '123456 Ground floor 1_100.pdf' })).toEqual([{ denominator: 100, source: 'filename', match: '1_100' }]);
    expect(findScaleHints({ texts: ['Scale', 'M 1:50', 'Sheet 3'] })).toEqual([{ denominator: 50, source: 'titleblock', match: '1:50' }]);
  });

  it('ignores numbers that are not plan scales', () => {
    expect(findScaleHints({ fileName: 'Rev 1-3 plan v1_12.pdf' })).toEqual([]);
    expect(findScaleHints({ texts: ['21:100', '1:1234'] })).toEqual([]);
  });

  it('accepts the usual spellings', () => {
    expect(findScaleHints({ texts: ['1 : 200'] })[0]?.denominator).toBe(200);
    expect(findScaleHints({ texts: ['1-500'] })[0]?.denominator).toBe(500);
  });
});

describe('metresPerPoint', () => {
  it('is one point on paper times the scale', () => {
    // 1 pt = 25.4/72 mm on paper; at 1:100 that is 35.28 mm in the building.
    expect(metresPerPoint(100)).toBeCloseTo(0.035278, 6);
  });
});

describe('resolvePdfUnits', () => {
  it('lets calibration win over everything', () => {
    expect(resolvePdfUnits({ fileName: 'a 1_100.pdf', texts: ['1:50'], calibrationMetresPerPoint: 0.01 })).toEqual({
      source: 'calibration',
      metresPerUnit: 0.01,
    });
  });

  it('prefers the sheet over the file name', () => {
    const u = resolvePdfUnits({ fileName: 'a 1_100.pdf', texts: ['1:50'] });
    expect(u.source).toBe('titleblock');
    expect(u.scaleDenominator).toBe(50);
  });

  it('falls back to the file name', () => {
    const u = resolvePdfUnits({ fileName: 'a 1_100.pdf', texts: ['Office', '12.5 m2'] });
    expect(u.source).toBe('filename');
    expect(u.scaleDenominator).toBe(100);
    expect(u.metresPerUnit).toBeCloseTo(0.035278, 6);
  });

  it('is unknown with a unit of 0 when nothing can be read', () => {
    expect(resolvePdfUnits({ fileName: 'plan.pdf', texts: [] })).toEqual({ source: 'unknown', metresPerUnit: 0 });
  });
});
