/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DrawingSheet } from '@ifc-lite/drawing-2d';
import { productViewports, applyProductToSheet } from './productToSheet.js';
import {
  BUILT_IN_PRODUCTS, BRANDSCHUTZKONZEPT_ID, FEUERWEHRLAGEPLAN_ID,
} from './planProducts.js';

const brandschutz = BUILT_IN_PRODUCTS.find((p) => p.id === BRANDSCHUTZKONZEPT_ID)!;
const lageplan = BUILT_IN_PRODUCTS.find((p) => p.id === FEUERWEHRLAGEPLAN_ID)!;

/** Only the fields these functions read. */
const sheet = (): DrawingSheet => ({
  id: 's', name: 'Blatt',
  viewportBounds: { x: 20, y: 10, width: 380, height: 250 },
  scale: { factor: 50 },
  northArrow: { style: 'simple', rotation: 0, positionMm: { x: 30, y: 30 }, sizeMm: 15 },
} as DrawingSheet);

describe('productViewports', () => {
  it('places the Lageplan’s two views side by side', () => {
    const views = productViewports(lageplan, sheet(), 0);
    assert.equal(views.length, 2);
    assert.ok(views[0].bounds.x + views[0].bounds.width <= views[1].bounds.x);
  });

  it('keeps each view at its own scale', () => {
    const views = productViewports(lageplan, sheet(), 0);
    assert.equal(views[0].scaleDenominator, 500);
    assert.equal(views[1].scaleDenominator, 200);
  });

  it('captions views only when there is more than one', () => {
    // A lone "Grundriss" under a single drawing is noise — the title block
    // already says what the sheet is.
    assert.equal(productViewports(brandschutz, sheet(), 0)[0].title, '');
    assert.equal(productViewports(lageplan, sheet(), 0)[0].title, 'Übersicht Situation');
  });

  it('hands the product’s rotation down to views that have none', () => {
    const turned = { ...lageplan, rotation: 1.2 };
    for (const view of productViewports(turned, sheet(), 0)) {
      assert.equal(view.rotation, 1.2);
    }
  });

  it('lets a view pin itself straight beside a turned one', () => {
    // The inset case, resolved here rather than in the renderer.
    const withInset = {
      ...lageplan,
      rotation: 1.2,
      sheet: {
        ...lageplan.sheet,
        views: [
          lageplan.sheet.views[0],
          { ...lageplan.sheet.views[1], rotation: 0 },
        ],
      },
    };
    const views = productViewports(withInset, sheet(), 0);
    assert.equal(views[0].rotation, 1.2);
    assert.equal(views[1].rotation, 0);
  });

  it('falls through to the project when the product has no angle', () => {
    assert.equal(productViewports(brandschutz, sheet(), 0.7)[0].rotation, 0.7);
  });
});

describe('applyProductToSheet', () => {
  it('states the principal view’s scale on the sheet', () => {
    // The scale bar, the scale stamp and the title block all read this. Left
    // at the sheet's previous 1:50 they would all state a scale nothing is
    // drawn at.
    const applied = applyProductToSheet(sheet(), lageplan, 0);
    assert.equal(applied.scale.factor, 500);
    assert.equal(applyProductToSheet(sheet(), brandschutz, 0).scale.factor, 100);
  });

  it('leaves the paper, frame and title block alone', () => {
    // They are the office's, not the product's. Overwriting them would undo
    // somebody's title block on every switch.
    const before = sheet();
    const applied = applyProductToSheet(before, lageplan, 0);
    assert.equal(applied.paper, before.paper);
    assert.equal(applied.frame, before.frame);
    assert.equal(applied.titleBlock, before.titleBlock);
  });

  it('points the north arrow against the rotation', () => {
    // Turned 90° anticlockwise, north ends up pointing to the right of the
    // sheet, so the arrow is drawn at -90°.
    const turned = { ...lageplan, rotation: Math.PI / 2 };
    const applied = applyProductToSheet(sheet(), turned, 0);
    assert.ok(Math.abs(applied.northArrow.rotation - -90) < 1e-9);
  });

  it('leaves the north arrow up for an unturned drawing', () => {
    assert.equal(applyProductToSheet(sheet(), brandschutz, 0).northArrow.rotation, 0);
  });

  it('does not touch the sheet when nothing could be placed', () => {
    // An empty sheet reads as a broken model; the previous drawing is wrong
    // but visible.
    const broken = {
      ...brandschutz,
      sheet: {
        ...brandschutz.sheet,
        views: [{
          ...brandschutz.sheet.views[0],
          placement: { x: 0.9, y: 0, width: 0.5, height: 1 },
        }],
      },
    };
    const before = sheet();
    assert.equal(applyProductToSheet(before, broken, 0), before);
  });

  it('produces a sheet whose views a renderer can just iterate', () => {
    const applied = applyProductToSheet(sheet(), lageplan, 0);
    assert.ok(Array.isArray(applied.viewports));
    assert.equal(applied.viewports?.length, 2);
  });
});
