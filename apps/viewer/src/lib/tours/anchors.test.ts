/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The templated anchors have to survive being turned into a CSS selector.
 *
 * A fixed anchor is a hand-written constant and cannot surprise anyone. A
 * templated one is built from model data — a property set name, a property
 * name, a lens id — and the resolver looks it up with
 * `document.querySelector('[data-tour="..."]')`. A value carrying a quote
 * would produce a selector that throws, which the resolver reports as a
 * missing anchor: the clip would point at nothing and blame the UI.
 */

import '@/test/setup-dom.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activityAnchor, anchorSelector, lensCardAnchor, propertyRowAnchor, toolAnchor } from './anchors';

describe('propertyRowAnchor', () => {
  it('names the row by its set and property, not by its position', () => {
    // Position moves whenever a model carries one property more; the pair
    // does not.
    assert.equal(
      propertyRowAnchor('Pset_ConstructionOccurence', 'AssetIdentifier'),
      'property-row-Pset_ConstructionOccurence:AssetIdentifier',
    );
  });

  it('keeps two properties of the same name in different sets apart', () => {
    assert.notEqual(
      propertyRowAnchor('Pset_WallCommon', 'Reference'),
      propertyRowAnchor('Pset_DoorCommon', 'Reference'),
    );
  });

  it('survives a property name with spaces, which real psets have', () => {
    const selector = anchorSelector(propertyRowAnchor('Pset_Custom', 'Fire Rating'));
    assert.equal(selector, '[data-tour="property-row-Pset_Custom:Fire Rating"]');
    // The selector must parse; a throwing one reads as "anchor missing".
    assert.doesNotThrow(() => document.querySelector(selector), 'selector must be valid CSS');
  });
});

describe('every templated anchor', () => {
  it('produces a selector the browser accepts', () => {
    const anchors = [
      propertyRowAnchor('Pset_ConstructionOccurence', 'AssetIdentifier'),
      activityAnchor('properties'),
      toolAnchor('measure'),
      lensCardAnchor('lens-by-class'),
    ];
    for (const anchor of anchors) {
      assert.doesNotThrow(() => document.querySelector(anchorSelector(anchor)), anchor);
    }
  });
});
