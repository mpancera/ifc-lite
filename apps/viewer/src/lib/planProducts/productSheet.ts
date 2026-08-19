/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The sheet a product asks for — paper, and the views placed on it.
 *
 * This is the product's SPECIFICATION of a sheet, not the sheet itself.
 * `DrawingSheet` in `@ifc-lite/drawing-2d` is the real thing, with frame
 * geometry, title block fields and millimetre positions; it is built from one
 * of these when a product is activated. The split keeps a product small enough
 * to read, and keeps the drawing package free of any idea of "products".
 *
 * # Why a list of views rather than one
 * A Feuerwehrlageplan is conventionally issued as an overview of the site with
 * the storey beside it, on one sheet. That is two views at DIFFERENT SCALES —
 * an overview at 1:500 next to a floor at 1:200 — and on a Lageplan they are
 * also at different ROTATIONS, because the site plan is turned to the approach
 * direction while an inset may stay north-up for reference.
 *
 * A single scale per sheet cannot express that, and the honest consequence of
 * keeping it would be issuing two sheets where the convention is one.
 */

/** Where a view sits on the sheet, as a fraction of the drawable area. */
export interface ViewPlacement {
  /** 0 = left edge of the drawable area, 1 = right edge. */
  readonly x: number;
  /** 0 = top edge, 1 = bottom edge. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One view on a product's sheet.
 *
 * Fractions rather than millimetres so that a product works on A3 and A1
 * alike. A product that hard-codes "160 mm from the left" is a product that
 * silently falls off the page the first time somebody picks a smaller sheet.
 */
export interface ProductView {
  /** Stable key, unique within the sheet. */
  readonly id: string;
  /** Caption drawn under the view, e.g. `Übersicht` or `Erdgeschoss`. */
  readonly title: string;
  /**
   * Scale denominator: `200` means 1:200.
   *
   * Always explicit, never "fit to the frame". A fire drawing is measured off
   * the paper — a route length, a distance to a hydrant — and a view fitted to
   * whatever space was left is a view nobody may measure.
   */
  readonly scaleDenominator: number;
  /**
   * This view's own rotation in radians, or `null` to take the product's.
   *
   * The reason the whole list exists: an inset that stays north-up beside a
   * site plan turned to the approach direction.
   */
  readonly rotation: number | null;
  /** What the view shows. */
  readonly content: ProductViewContent;
  readonly placement: ViewPlacement;
}

/**
 * What a view draws.
 *
 * `storey` is the ordinary floor plan. `site` is the plot — everything under
 * `IfcSite` plus the building outline — which is what a Lageplan's overview
 * actually is, and which no storey cut can produce because the access route
 * and the key depot are not on any floor.
 */
export type ProductViewContent =
  | { readonly kind: 'storey'; }
  | { readonly kind: 'site'; };

/** A product's sheet specification. */
export interface ProductSheet {
  /** Paper size id from `PAPER_SIZE_REGISTRY`, e.g. `A3_LANDSCAPE`. */
  readonly paperId: string;
  /** The views, in drawing order. Never empty. */
  readonly views: readonly ProductView[];
}

/** The whole drawable area, for a sheet holding one view. */
const FULL: ViewPlacement = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Plan Brandschutzkonzept: one storey, filling the sheet, at 1:100.
 *
 * A concept plan is read at the same scale as the architectural drawings it
 * accompanies, and 1:100 is what those are issued at.
 */
export const BRANDSCHUTZ_SHEET: ProductSheet = {
  paperId: 'A3_LANDSCAPE',
  views: [
    {
      id: 'grundriss',
      title: 'Grundriss',
      scaleDenominator: 100,
      rotation: null,
      content: { kind: 'storey' },
      placement: FULL,
    },
  ],
};

/**
 * Feuerwehrlageplan: the site, with the storey beside it.
 *
 * The site view takes the larger share because it is the one somebody reads
 * standing at the kerb; the storey is the reference they turn to afterwards.
 * A small gutter is left between them — two drawings that touch read as one
 * drawing with a line through it.
 */
export const LAGEPLAN_SHEET: ProductSheet = {
  paperId: 'A3_LANDSCAPE',
  views: [
    {
      id: 'uebersicht',
      title: 'Übersicht Situation',
      scaleDenominator: 500,
      // Follows the product, which is turned to the approach direction.
      rotation: null,
      content: { kind: 'site' },
      placement: { x: 0, y: 0, width: 0.58, height: 1 },
    },
    {
      id: 'geschoss',
      title: 'Geschoss',
      scaleDenominator: 200,
      // Follows the product too. Kept as an explicit `null` rather than
      // omitted, so that setting it to a fixed angle later is an edit to a
      // value that already exists rather than a new concept.
      rotation: null,
      content: { kind: 'storey' },
      placement: { x: 0.62, y: 0, width: 0.38, height: 1 },
    },
  ],
};

/**
 * The rotation a view is actually drawn at.
 *
 * Three levels, each falling through to the next: the view's own angle, else
 * the product's, else the project's. Written once here so that the canvas, the
 * print path and the DXF export cannot disagree about it — a drawing that
 * prints at a different angle than it displays is the kind of bug that reaches
 * the client before anybody notices.
 */
export function effectiveViewRotation(
  view: Pick<ProductView, 'rotation'>,
  productRotation: number | null,
  projectRotation: number,
): number {
  if (view.rotation !== null && Number.isFinite(view.rotation)) return view.rotation;
  if (productRotation !== null && Number.isFinite(productRotation)) return productRotation;
  return Number.isFinite(projectRotation) ? projectRotation : 0;
}

/**
 * Whether a placement stays inside the drawable area.
 *
 * A view placed off the sheet does not fail loudly — it prints cropped, or
 * not at all, and only on paper. Checked when a product is loaded rather than
 * when it is drawn, so a hand-edited product is rejected at the door.
 */
export function isPlacementValid(placement: ViewPlacement): boolean {
  const values = [placement.x, placement.y, placement.width, placement.height];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
  if (placement.width <= 0 || placement.height <= 0) return false;
  return placement.x >= 0 && placement.y >= 0
    && placement.x + placement.width <= 1
    && placement.y + placement.height <= 1;
}
