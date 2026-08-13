/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  northBearingDeg, niceScaleBarLength, formatScaleBarLength,
  scaleDenominator, pixelsPerMetreForScale, nearestStandardScale, formatScaleRatio,
} from './planChrome.js';

const DEG = Math.PI / 180;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

describe('northBearingDeg', () => {
  it('points north straight up on an unturned plan', () => {
    assert.equal(northBearingDeg(0), 0);
  });

  it('turns north WITH the plan, not against it', () => {
    // Turning the plan a quarter turn clockwise takes north from up to the
    // right. The opposite sign would look just as plausible and be wrong.
    assert.equal(round(northBearingDeg(90 * DEG)), 90);
    assert.equal(round(northBearingDeg(180 * DEG)), 180);
  });

  it('reads a negative angle as its positive bearing', () => {
    // A plan turned back by a quarter turn faces north to the LEFT, which is
    // 270° — not −90°, which is what a readout beside the arrow must not say.
    assert.equal(round(northBearingDeg(-90 * DEG)), 270);
  });

  it('wraps past a full turn', () => {
    assert.equal(round(northBearingDeg(450 * DEG)), 90);
  });

  it('answers zero for an angle that is not a number', () => {
    assert.equal(northBearingDeg(Number.NaN), 0);
  });
});

describe('scaleDenominator / pixelsPerMetreForScale', () => {
  // A round 4 px per millimetre, so the arithmetic is checkable by eye.
  const MM = 0.25;

  it('reads a metre drawn 1000 px long as full size', () => {
    assert.equal(round(scaleDenominator(4000, MM)!), 1);
  });

  it('reads a metre drawn 10 mm long as 1:100', () => {
    // 10 mm of glass at 0.25 mm per pixel is 40 px.
    assert.equal(round(scaleDenominator(40, MM)!), 100);
  });

  it('inverts itself', () => {
    for (const d of [1, 20, 50, 100, 500, 5000]) {
      const px = pixelsPerMetreForScale(d, MM)!;
      assert.equal(round(scaleDenominator(px, MM)!), d);
    }
  });

  it('uses the browser 96 dpi pixel when none is given', () => {
    // 1:100 means a metre is 10 mm on the glass, which at 96 dpi is 37.795 px.
    const px = pixelsPerMetreForScale(100)!;
    assert.equal(Math.round(px * 1000) / 1000, 37.795);
  });

  it('has no scale for a zoom that is not a zoom', () => {
    assert.equal(scaleDenominator(0), null);
    assert.equal(scaleDenominator(-3), null);
    assert.equal(scaleDenominator(Number.NaN), null);
    assert.equal(pixelsPerMetreForScale(0), null);
  });
});

describe('nearestStandardScale', () => {
  it('lands on the issued scales, not on round numbers', () => {
    assert.equal(nearestStandardScale(97), 100);
    assert.equal(nearestStandardScale(23), 25);
  });

  it('compares on a log axis, the way scales are read', () => {
    // 1:150 is the geometric middle of 100 and 200 — linearly it would look
    // closer to 200, which is not how anybody reads a scale.
    assert.equal(nearestStandardScale(140), 100);
    assert.equal(nearestStandardScale(160), 200);
  });

  it('clamps to the ends of the series', () => {
    assert.equal(nearestStandardScale(0.2), 1);
    assert.equal(nearestStandardScale(99999), 5000);
  });
});

describe('formatScaleRatio', () => {
  it('writes a ratio, rounded', () => {
    assert.equal(formatScaleRatio(100), '1:100');
    assert.equal(formatScaleRatio(187.3), '1:187');
  });
});

describe('niceScaleBarLength', () => {
  it('picks a length somebody can divide by', () => {
    // At 20 px per metre a 120 px bar holds 6 m, so the bar is 5 m — not 6.
    const bar = niceScaleBarLength(20, 120)!;
    assert.equal(bar.metres, 5);
    assert.equal(bar.pixels, 100);
  });

  it('takes the LONGEST nice length that still fits', () => {
    // 2 m would also fit at 20 px/m; a longer bar is read more accurately.
    assert.equal(niceScaleBarLength(20, 120)!.metres, 5);
  });

  it('follows the zoom up and down through the decades', () => {
    assert.equal(niceScaleBarLength(200, 120)!.metres, 0.5);
    assert.equal(niceScaleBarLength(2, 120)!.metres, 50);
    assert.equal(niceScaleBarLength(0.05, 120)!.metres, 2000);
  });

  it('never returns a bar longer than it was allowed', () => {
    for (const px of [1, 7, 40, 137, 900]) {
      for (const scale of [0.01, 0.3, 5, 63, 1200]) {
        const bar = niceScaleBarLength(scale, px)!;
        assert.ok(bar.pixels <= px || bar.metres === 0.001, `${scale} px/m in ${px} px`);
      }
    }
  });

  it('shows the smallest step rather than nothing when even a millimetre overflows', () => {
    // A million pixels to the metre: 1 mm is already 1000 px. A bar running
    // off the corner says "the zoom is extreme" more clearly than a blank
    // corner does.
    const bar = niceScaleBarLength(1e6, 120)!;
    assert.equal(bar.metres, 0.001);
    assert.equal(bar.pixels, 1000);
  });

  it('keeps up when the plan is zoomed far out', () => {
    // A metre is a hundredth of a pixel: the bar stands for kilometres.
    assert.equal(niceScaleBarLength(0.01, 120)!.metres, 10000);
  });

  it('has no bar for a scale that is not a scale', () => {
    assert.equal(niceScaleBarLength(0, 120), null);
    assert.equal(niceScaleBarLength(-5, 120), null);
    assert.equal(niceScaleBarLength(Number.NaN, 120), null);
    assert.equal(niceScaleBarLength(20, 0), null);
  });
});

describe('formatScaleBarLength', () => {
  it('writes round numbers, because every length here is round', () => {
    assert.equal(formatScaleBarLength(5), '5 m');
    assert.equal(formatScaleBarLength(2000), '2000 m');
  });

  it('drops to centimetres and millimetres rather than printing 0.0 m', () => {
    assert.equal(formatScaleBarLength(0.5), '50 cm');
    assert.equal(formatScaleBarLength(0.02), '2 cm');
    assert.equal(formatScaleBarLength(0.001), '1 mm');
  });
});
