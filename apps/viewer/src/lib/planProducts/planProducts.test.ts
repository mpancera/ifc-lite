/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_PRODUCTS, BRANDSCHUTZKONZEPT_ID, FEUERWEHRLAGEPLAN_ID,
  findProduct, productDrawsClass, productDrawsTheme, copyProduct,
} from './planProducts.js';
import {
  effectiveViewRotation, isPlacementValid, LAGEPLAN_SHEET, BRANDSCHUTZ_SHEET,
} from './productSheet.js';

const brandschutz = BUILT_IN_PRODUCTS.find((p) => p.id === BRANDSCHUTZKONZEPT_ID)!;
const lageplan = BUILT_IN_PRODUCTS.find((p) => p.id === FEUERWEHRLAGEPLAN_ID)!;

describe('the two shipped products', () => {
  it('are actually two different drawings, not one with a toggle', () => {
    // The premise of the whole feature. If these ever converge, somebody has
    // turned the Lageplan back into a view option of the concept plan.
    assert.notDeepEqual(brandschutz.zoneThemes, lageplan.zoneThemes);
    assert.ok(
      lageplan.zoneThemes.length < brandschutz.zoneThemes.length,
      'the Lageplan is the reduced drawing — it must show FEWER themes',
    );
  });

  it('keeps detection and extinguishing zones off the Lageplan', () => {
    // A brigade arriving does not act on a detection zone boundary. Drawing it
    // there crowds out what they do act on.
    assert.ok(productDrawsTheme(brandschutz, 'fire-trigger'));
    assert.ok(productDrawsTheme(brandschutz, 'extinguishing'));
    assert.ok(!productDrawsTheme(lageplan, 'fire-trigger'));
    assert.ok(!productDrawsTheme(lageplan, 'extinguishing'));
  });

  it('shows fire compartments on both, because both drawings turn on them', () => {
    assert.ok(productDrawsTheme(brandschutz, 'fire-compartment'));
    assert.ok(productDrawsTheme(lageplan, 'fire-compartment'));
  });

  it('puts site-level classes only on the Lageplan', () => {
    // The key depot and the access route are what makes the Lageplan a site
    // drawing. A concept plan showing them would be drawing the wrong thing.
    assert.ok(productDrawsClass(lageplan, 'IfcGeographicElement'));
    assert.ok(!productDrawsClass(brandschutz, 'IfcGeographicElement'));
  });

  it('names zone themes that actually exist in themes.ts', async () => {
    // The one link this file cannot express in the type system: a theme id is
    // a string, and a typo silently produces a drawing missing a whole layer.
    const { ZONE_THEMES } = await import('@/lib/ifcZones/themes');
    const known = new Set(ZONE_THEMES.map((theme) => theme.id));

    for (const product of BUILT_IN_PRODUCTS) {
      for (const themeId of product.zoneThemes) {
        assert.ok(known.has(themeId), `${product.id} names unknown theme "${themeId}"`);
      }
    }
  });

  it('holds class names lower-cased, the way lookup expects', () => {
    // productDrawsClass lower-cases what it is asked about but NOT what it
    // holds — a capital in the table would never match anything.
    for (const product of BUILT_IN_PRODUCTS) {
      for (const entity of product.classes) {
        assert.equal(entity, entity.toLowerCase(), `${product.id}: "${entity}"`);
      }
    }
  });

  it('starts both products unturned, so neither guesses an angle', () => {
    // Approach direction is a fact about a plot; nothing in code can know it.
    assert.equal(brandschutz.rotation, null);
    assert.equal(lageplan.rotation, null);
  });
});

describe('productDrawsClass', () => {
  it('matches however the exporting tool spelled the entity', () => {
    assert.ok(productDrawsClass(brandschutz, 'IFCWALL'));
    assert.ok(productDrawsClass(brandschutz, 'IfcWall'));
    assert.ok(productDrawsClass(brandschutz, '  ifcwall  '));
  });

  it('says no to an empty name rather than matching everything', () => {
    assert.ok(!productDrawsClass(brandschutz, ''));
    assert.ok(!productDrawsClass(brandschutz, '   '));
  });
});

describe('copyProduct', () => {
  it('produces something that can never overwrite a shipped drawing', () => {
    const copy = copyProduct(lageplan, 'mein-lageplan', 'Mein Lageplan');
    assert.equal(copy.builtIn, false);
    assert.equal(copy.id, 'mein-lageplan');
    assert.deepEqual(copy.zoneThemes, lageplan.zoneThemes);
  });
});

describe('findProduct', () => {
  it('answers null for the ids that mean "nothing selected"', () => {
    assert.equal(findProduct(BUILT_IN_PRODUCTS, null), null);
    assert.equal(findProduct(BUILT_IN_PRODUCTS, undefined), null);
    assert.equal(findProduct(BUILT_IN_PRODUCTS, ''), null);
    assert.equal(findProduct(BUILT_IN_PRODUCTS, 'nichts-dergleichen'), null);
  });
});

describe('the Lageplan sheet', () => {
  it('carries two views at different scales — the reason viewports exist', () => {
    assert.equal(LAGEPLAN_SHEET.views.length, 2);
    const scales = LAGEPLAN_SHEET.views.map((view) => view.scaleDenominator);
    assert.notEqual(scales[0], scales[1]);
  });

  it('places its views without overlapping', () => {
    // Two drawings that touch read as one drawing with a line through it.
    const [first, second] = LAGEPLAN_SHEET.views;
    const firstRight = first.placement.x + first.placement.width;
    assert.ok(firstRight <= second.placement.x, 'views overlap on the sheet');
  });

  it('keeps every view inside the page', () => {
    for (const sheet of [BRANDSCHUTZ_SHEET, LAGEPLAN_SHEET]) {
      for (const view of sheet.views) {
        assert.ok(isPlacementValid(view.placement), `${view.id} falls off the sheet`);
      }
    }
  });

  it('gives every view an explicit scale, never a fit-to-frame', () => {
    // A fire drawing is measured off the paper. A view fitted to leftover
    // space is a view nobody may measure.
    for (const sheet of [BRANDSCHUTZ_SHEET, LAGEPLAN_SHEET]) {
      for (const view of sheet.views) {
        assert.ok(Number.isFinite(view.scaleDenominator) && view.scaleDenominator > 0);
      }
    }
  });
});

describe('effectiveViewRotation', () => {
  it('lets the view overrule the product, which overrules the project', () => {
    // The inset that stays north-up beside a site plan turned to the approach.
    assert.equal(effectiveViewRotation({ rotation: 0.5 }, 1.0, 2.0), 0.5);
    assert.equal(effectiveViewRotation({ rotation: null }, 1.0, 2.0), 1.0);
    assert.equal(effectiveViewRotation({ rotation: null }, null, 2.0), 2.0);
  });

  it('treats an explicit zero on the view as an opinion, not as absence', () => {
    // "North up, whatever the product says" has to be expressible. If zero
    // fell through to the product, an inset could not be pinned straight.
    assert.equal(effectiveViewRotation({ rotation: 0 }, 1.0, 2.0), 0);
  });

  it('falls all the way through to straight when nothing is set', () => {
    assert.equal(effectiveViewRotation({ rotation: null }, null, 0), 0);
  });

  it('refuses a NaN angle instead of blanking the drawing', () => {
    // A NaN turns every coordinate into NaN and the page comes up empty with
    // nothing on screen saying why.
    assert.equal(effectiveViewRotation({ rotation: NaN }, null, 0), 0);
    assert.equal(effectiveViewRotation({ rotation: null }, NaN, 1.5), 1.5);
    assert.equal(effectiveViewRotation({ rotation: null }, null, NaN), 0);
  });
});

describe('isPlacementValid', () => {
  it('rejects a view that runs off the page', () => {
    assert.ok(!isPlacementValid({ x: 0.7, y: 0, width: 0.5, height: 1 }));
    assert.ok(!isPlacementValid({ x: -0.1, y: 0, width: 0.5, height: 1 }));
  });

  it('rejects a view with no area, which would print nothing at all', () => {
    assert.ok(!isPlacementValid({ x: 0, y: 0, width: 0, height: 1 }));
    assert.ok(!isPlacementValid({ x: 0, y: 0, width: 0.5, height: -1 }));
  });

  it('accepts the whole page', () => {
    assert.ok(isPlacementValid({ x: 0, y: 0, width: 1, height: 1 }));
  });
});
