/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPARTMENT_FALLBACK_COLOUR, COMPARTMENT_LAYER, COMPARTMENT_LINE_WEIGHT_M,
  fallbackColourFor, FIRE_TRIGGER_LAYER, layerInsets, ZONE_FALLBACK_COLOUR,
  ZONE_LINE_WEIGHT_M,
} from './zoneLayers.js';

describe('layerInsets', () => {
  it('rests a single line ON its boundary rather than straddling it', () => {
    // Half its own weight inward: the fire-plan convention, and the reason the
    // drawn width and the inset have to be the same number.
    assert.deepEqual(layerInsets([FIRE_TRIGGER_LAYER]), [ZONE_LINE_WEIGHT_M / 2]);
  });

  it('starts each layer where the one outside it ended', () => {
    const [outer, inner] = layerInsets([COMPARTMENT_LAYER, FIRE_TRIGGER_LAYER]);

    assert.equal(outer, COMPARTMENT_LINE_WEIGHT_M / 2);
    assert.equal(inner, COMPARTMENT_LINE_WEIGHT_M + ZONE_LINE_WEIGHT_M / 2);
  });

  it('leaves no gap and no overlap between neighbours, at any weights', () => {
    const layers = [
      { themeId: 'a', weightM: 0.4 },
      { themeId: 'b', weightM: 0.1 },
      { themeId: 'c', weightM: 0.25 },
    ];
    const insets = layerInsets(layers);

    for (let i = 1; i < layers.length; i++) {
      // The inner edge of one line is the outer edge of the next: touching,
      // which is what makes two coinciding boundaries read as two lines
      // instead of one drawn twice.
      const innerEdgeOfPrevious = insets[i - 1] + layers[i - 1].weightM / 2;
      const outerEdgeOfThis = insets[i] - layers[i].weightM / 2;
      assert.equal(outerEdgeOfThis, innerEdgeOfPrevious, `between ${i - 1} and ${i}`);
    }
  });

  it('answers nothing for no layers', () => {
    assert.deepEqual(layerInsets([]), []);
  });
});

describe('the layer weights', () => {
  it('draws a Brandabschnitt heavier than the zones inside it', () => {
    // The compartment is what the building is divided INTO; a detection zone
    // is only what reports from within one. The heavier line is the stronger
    // statement, and on a sheet that difference is the whole legend.
    assert.ok(COMPARTMENT_LINE_WEIGHT_M > ZONE_LINE_WEIGHT_M);
  });
});

describe('fallbackColourFor', () => {
  it('gives the two layers different colours when neither is painted', () => {
    // Otherwise two unpainted layers merge into one red smear and the sheet
    // says less than it did with a single layer.
    assert.equal(fallbackColourFor('fire-compartment'), COMPARTMENT_FALLBACK_COLOUR);
    assert.equal(fallbackColourFor('fire-trigger'), ZONE_FALLBACK_COLOUR);
    assert.notEqual(COMPARTMENT_FALLBACK_COLOUR, ZONE_FALLBACK_COLOUR);
  });

  it('treats anything else as a detection zone', () => {
    assert.equal(fallbackColourFor('gas-trigger'), ZONE_FALLBACK_COLOUR);
  });
});
