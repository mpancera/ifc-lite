/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drawing Sheet Types
 *
 * Complete drawing sheet configuration combining:
 * - Paper size
 * - Drawing frame
 * - Title block
 * - Scale bar
 * - North arrow
 */

import type { PaperSizeDefinition } from './paper-sizes.js';
import type { DrawingFrame } from './frame-types.js';
import type { TitleBlockConfig, RevisionEntry } from './title-block-types.js';
import type { ScaleBarConfig, NorthArrowConfig } from './scale-bar-types.js';
import type { DrawingScale } from '../styles.js';

/** Viewport bounds in sheet coordinates (mm from sheet origin) */
export interface ViewportBounds {
  /** X position from left edge of paper (mm) */
  x: number;
  /** Y position from top edge of paper (mm) */
  y: number;
  /** Viewport width (mm) */
  width: number;
  /** Viewport height (mm) */
  height: number;
}

/**
 * One view placed on a sheet, with its own scale and rotation.
 *
 * A sheet used to carry exactly one drawing, and for most sheets that is still
 * the truth: `viewportBounds` plus the sheet's `scale` describe it completely.
 * Some drawings are conventionally issued as SEVERAL views on one sheet — a
 * site overview at 1:500 beside a floor plan at 1:200 — and those two numbers
 * cannot express that, because there is only one of each.
 *
 * A view therefore carries its own scale, and its own rotation: on a fire
 * brigade site plan the overview is turned to the approach direction while an
 * inset stays north-up, so a single sheet-wide angle cannot hold both either.
 *
 * `null` for either means "take the sheet's" — which is what makes an ordinary
 * one-view sheet expressible without repeating itself.
 */
export interface SheetViewport {
  /** Stable key, unique within the sheet. */
  id: string;
  /** Caption drawn with the view. Empty for a sheet with only one. */
  title: string;
  /** Where the view sits, in mm from the sheet origin. */
  bounds: ViewportBounds;
  /** Scale denominator (`200` means 1:200), or `null` for the sheet's. */
  scaleDenominator: number | null;
  /** Rotation in radians, or `null` for the sheet's own. */
  rotation: number | null;
}

/** Complete drawing sheet configuration */
export interface DrawingSheet {
  /** Unique sheet identifier */
  id: string;
  /** Sheet name for display */
  name: string;
  /** Paper size configuration */
  paper: PaperSizeDefinition;
  /** Drawing frame configuration */
  frame: DrawingFrame;
  /** Title block configuration */
  titleBlock: TitleBlockConfig;
  /** Scale bar configuration */
  scaleBar: ScaleBarConfig;
  /** Drawing scale */
  scale: DrawingScale;
  /** North arrow configuration */
  northArrow: NorthArrowConfig;
  /**
   * Calculated viewport bounds (where drawing content goes).
   *
   * Stays the single-view answer, and stays correct for every sheet that has
   * one. With `viewports` set it describes the whole drawable area that those
   * views are placed inside, so anything measuring the available page still
   * reads the right number.
   */
  viewportBounds: ViewportBounds;
  /**
   * The views on this sheet, when there is more than one.
   *
   * Absent — not an empty array — for an ordinary single-view sheet, so that
   * every sheet written before this existed stays valid and reads identically.
   * Use {@link sheetViewports} rather than this field directly: it answers with
   * a list either way, so a caller never has to handle both shapes.
   */
  viewports?: SheetViewport[];
  /** Revision history */
  revisions: RevisionEntry[];
}

/** Sheet creation options */
export interface SheetCreationOptions {
  /** Paper size ID (e.g., 'A3_LANDSCAPE') */
  paperId?: string;
  /** Frame style */
  frameStyle?: string;
  /** Title block layout */
  titleBlockLayout?: string;
  /** Drawing scale */
  scale?: DrawingScale;
}

/**
 * Calculate viewport bounds given sheet configuration
 * The viewport is the area where the actual drawing content is placed
 */
export function calculateViewportBounds(
  paper: PaperSizeDefinition,
  frame: DrawingFrame,
  titleBlock: TitleBlockConfig
): ViewportBounds {
  // Frame inner edges
  const frameInnerLeft =
    frame.margins.left + frame.margins.bindingMargin + frame.border.borderGap;
  const frameInnerRight =
    paper.widthMm - frame.margins.right - frame.border.borderGap;
  const frameInnerTop = frame.margins.top + frame.border.borderGap;
  const frameInnerBottom =
    paper.heightMm - frame.margins.bottom - frame.border.borderGap;

  let viewportX = frameInnerLeft;
  let viewportY = frameInnerTop;
  let viewportWidth = frameInnerRight - frameInnerLeft;
  let viewportHeight = frameInnerBottom - frameInnerTop;

  // Adjust for title block position
  const padding = 5; // Gap between viewport and title block

  switch (titleBlock.position) {
    case 'bottom-right':
      // Title block takes bottom-right corner
      // Viewport can use full width, but may need to avoid title block area
      viewportHeight = frameInnerBottom - frameInnerTop - titleBlock.heightMm - padding;
      break;

    case 'bottom-full':
      // Title block spans full width at bottom
      viewportHeight =
        frameInnerBottom - frameInnerTop - titleBlock.heightMm - padding;
      break;

    case 'right-strip':
      // Title block is a vertical strip on right
      viewportWidth =
        frameInnerRight - frameInnerLeft - titleBlock.widthMm - padding;
      break;
  }

  return {
    x: viewportX,
    y: viewportY,
    width: viewportWidth,
    height: viewportHeight,
  };
}

/**
 * Calculate the transform needed to fit drawing content into viewport
 *
 * @param drawingBounds - Bounds of the 2D drawing in model units (meters)
 * @param viewportBounds - Available viewport in mm
 * @param scale - Drawing scale
 * @returns Transform parameters for SVG
 */
export function calculateDrawingTransform(
  drawingBounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewportBounds: ViewportBounds,
  scale: DrawingScale
): {
  translateX: number;
  translateY: number;
  scaleFactor: number;
} {
  const drawingWidth = drawingBounds.maxX - drawingBounds.minX;
  const drawingHeight = drawingBounds.maxY - drawingBounds.minY;

  // Convert drawing size to paper mm at given scale
  // At 1:100, 1 meter = 10mm on paper
  const paperScale = 1000 / scale.factor;
  const drawingWidthMm = drawingWidth * paperScale;
  const drawingHeightMm = drawingHeight * paperScale;

  // Calculate scale to fit in viewport (with some padding)
  const paddingFactor = 0.95;
  const scaleX = (viewportBounds.width * paddingFactor) / drawingWidthMm;
  const scaleY = (viewportBounds.height * paddingFactor) / drawingHeightMm;
  const fitScale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 1:1

  const scaleFactor = paperScale * fitScale;

  // Center the drawing in viewport
  const finalWidthMm = drawingWidth * scaleFactor;
  const finalHeightMm = drawingHeight * scaleFactor;

  const translateX =
    viewportBounds.x +
    (viewportBounds.width - finalWidthMm) / 2 -
    drawingBounds.minX * scaleFactor;
  const translateY =
    viewportBounds.y +
    (viewportBounds.height - finalHeightMm) / 2 +
    drawingBounds.maxY * scaleFactor; // Flip Y

  return { translateX, translateY, scaleFactor };
}

/**
 * The views on a sheet, always as a list.
 *
 * The point of this function is that no caller has to know whether a sheet was
 * built before or after multi-view sheets existed. A single-view sheet answers
 * with one viewport derived from `viewportBounds`, which is exactly what it
 * always drew; a multi-view sheet answers with its own.
 *
 * Reading `sheet.viewports` directly is the mistake this exists to prevent: it
 * is `undefined` on most sheets, and code that iterates it without a fallback
 * silently draws nothing at all.
 */
export function sheetViewports(sheet: DrawingSheet): SheetViewport[] {
  const declared = sheet.viewports;
  if (declared && declared.length > 0) return declared;

  return [{
    id: 'main',
    title: '',
    bounds: sheet.viewportBounds,
    // Null rather than the sheet's own values: the caller resolves both
    // through `viewportScale` / `viewportRotation`, and duplicating them here
    // would be a second copy that can fall out of step with the sheet.
    scaleDenominator: null,
    rotation: null,
  }];
}

/** Whether a sheet actually carries more than one view. */
export function hasMultipleViews(sheet: DrawingSheet): boolean {
  return (sheet.viewports?.length ?? 0) > 1;
}

/**
 * The scale denominator a view is drawn at.
 *
 * `DrawingScale.factor` is already the denominator (100 for 1:100), so the
 * sheet's own scale is the fallback rather than a separate concept.
 */
export function viewportScale(viewport: SheetViewport, sheet: DrawingSheet): number {
  const own = viewport.scaleDenominator;
  if (typeof own === 'number' && Number.isFinite(own) && own > 0) return own;
  return sheet.scale.factor;
}

/**
 * The angle a view is drawn at, in radians.
 *
 * Falls back to zero rather than to the north arrow's rotation: the north
 * arrow says where north ENDS UP once the drawing is turned, so feeding it
 * back in as the drawing's own angle would turn the plan twice.
 */
export function viewportRotation(viewport: SheetViewport, fallback = 0): number {
  const own = viewport.rotation;
  if (typeof own === 'number' && Number.isFinite(own)) return own;
  return Number.isFinite(fallback) ? fallback : 0;
}

/**
 * Place fractional view positions inside a sheet's drawable area.
 *
 * A product describes where its views go as fractions of the page, so that one
 * definition works on A3 and A1 alike; a sheet needs millimetres. This is the
 * one place that conversion happens.
 *
 * A placement that falls outside the unit square is dropped rather than
 * clamped: clamping would silently overlap it with its neighbour and produce a
 * drawing that looks deliberate.
 */
export function placeViewports(
  area: ViewportBounds,
  placements: readonly {
    id: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    scaleDenominator: number | null;
    rotation: number | null;
  }[],
): SheetViewport[] {
  const placed: SheetViewport[] = [];

  for (const placement of placements) {
    const { x, y, width, height } = placement;
    const finite = [x, y, width, height].every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    );
    if (!finite || width <= 0 || height <= 0) continue;
    if (x < 0 || y < 0 || x + width > 1 || y + height > 1) continue;

    placed.push({
      id: placement.id,
      title: placement.title,
      bounds: {
        x: area.x + x * area.width,
        y: area.y + y * area.height,
        width: width * area.width,
        height: height * area.height,
      },
      scaleDenominator: placement.scaleDenominator,
      rotation: placement.rotation,
    });
  }

  return placed;
}

/**
 * The transform that fits a drawing into ONE view of a sheet.
 *
 * `calculateDrawingTransform` answers the same question for a whole sheet, and
 * this delegates to it — the point is not a different calculation, it is that
 * the view's own scale and bounds are used instead of the sheet's. Two views
 * at 1:500 and 1:200 therefore get two different transforms from one drawing,
 * which is the entire behaviour multi-view sheets exist for.
 *
 * Kept here rather than in each consumer because the canvas and the export
 * path both need it, and a drawing that prints at a different size than it
 * displays is the bug that reaches the client before anybody notices.
 */
export function calculateViewportTransform(
  drawingBounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewport: SheetViewport,
  sheet: DrawingSheet,
): { translateX: number; translateY: number; scaleFactor: number } {
  return calculateDrawingTransform(
    drawingBounds,
    viewport.bounds,
    { ...sheet.scale, factor: viewportScale(viewport, sheet) },
  );
}
