/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * From a product's sheet SPECIFICATION to the sheet the canvas draws.
 *
 * The product says "an overview and a floor, side by side, at these scales";
 * the drawing package wants millimetres inside a particular page. This module
 * is the seam between them, and it is deliberately the only place that knows
 * both — `lib/planProducts` never learns about frames and title blocks, and
 * `@ifc-lite/drawing-2d` never learns that products exist.
 */

import {
  placeViewports, calculateViewportBounds,
  type DrawingSheet, type SheetViewport,
} from '@ifc-lite/drawing-2d';
import type { PlanProduct } from './planProducts.js';
import { effectiveViewRotation } from './productSheet.js';

/**
 * The viewports a product wants on a given sheet.
 *
 * Rotations are resolved HERE rather than left to the renderer, because the
 * three-level fall-through (view, then product, then project) is a rule about
 * products, and a renderer that re-derived it would be a second copy that can
 * disagree — a drawing that prints at a different angle than it displays.
 */
export function productViewports(
  product: PlanProduct,
  sheet: DrawingSheet,
  projectRotation: number,
): SheetViewport[] {
  return placeViewports(
    sheet.viewportBounds,
    product.sheet.views.map((view) => ({
      id: view.id,
      // A single view needs no caption: the title block already says what the
      // drawing is, and a lone "Grundriss" under it is noise.
      title: product.sheet.views.length > 1 ? view.title : '',
      x: view.placement.x,
      y: view.placement.y,
      width: view.placement.width,
      height: view.placement.height,
      scaleDenominator: view.scaleDenominator,
      rotation: effectiveViewRotation(view, product.rotation, projectRotation),
    })),
  );
}

/**
 * Apply a product to a sheet, returning a new one.
 *
 * The sheet keeps its paper, frame and title block — those are the office's,
 * not the product's, and a product that overwrote them would undo somebody's
 * title block every time they switched drawing. What the product supplies is
 * what is drawn and at what scale.
 *
 * The sheet's own `scale` is set from the FIRST view, so that everything
 * reading `sheet.scale` — the scale bar, the printed scale stamp, the title
 * block's scale field — states the scale of the principal drawing rather than
 * a leftover from whatever the sheet was before.
 */
export function applyProductToSheet(
  sheet: DrawingSheet,
  product: PlanProduct,
  projectRotation: number,
): DrawingSheet {
  const viewports = productViewports(product, sheet, projectRotation);
  // Every placement was rejected — a hand-edited product with nothing drawable
  // on it. Leaving the sheet alone shows the previous drawing, which is wrong
  // but visible; an empty sheet reads as a broken model.
  if (viewports.length === 0) return sheet;

  const principal = product.sheet.views[0];
  return {
    ...sheet,
    viewports,
    scale: { ...sheet.scale, factor: principal.scaleDenominator },
    northArrow: {
      ...sheet.northArrow,
      // The north arrow shows where north ENDED UP after the drawing was
      // turned, so it points against the rotation. On a Feuerwehrlageplan
      // turned to the approach direction this is what makes the arrow sit at
      // an angle — which is the convention, not a defect.
      rotation: northArrowDegrees(
        effectiveViewRotation(principal, product.rotation, projectRotation),
      ),
    },
  };
}

/**
 * The angle to draw the north arrow at, in degrees.
 *
 * Negated because the arrow shows where north ENDED UP after the drawing was
 * turned, not how far the drawing turned.
 *
 * The `+ 0` is not decoration: negating zero gives `-0`, which would be stored
 * on every unturned sheet and shows up as `-0` in a diff of saved templates.
 */
function northArrowDegrees(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  return -((radians * 180) / Math.PI) + 0;
}

/**
 * The drawable area of a sheet, recomputed from its own paper and frame.
 *
 * A sheet built before multi-view existed already carries this in
 * `viewportBounds`; this is for callers holding the parts but not yet a sheet.
 */
export function drawableArea(sheet: DrawingSheet) {
  return calculateViewportBounds(sheet.paper, sheet.frame, sheet.titleBlock);
}
