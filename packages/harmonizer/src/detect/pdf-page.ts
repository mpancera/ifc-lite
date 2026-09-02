/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Is a PDF page a drawing or a picture of one?
 *
 * The decision is made on counts, not on the PDF itself, so it can be tested
 * without a PDF library and reused for whatever produced the counts. Four
 * cases that a naive "paths versus images" count gets wrong are handled
 * explicitly: a scan with a few vector lines traced over it (hybrid), text
 * that was outlined into paths (no text), hatching exported as thousands of
 * micro-segments, and a page that is a title block rather than a plan.
 */

import { MessageCodes, message } from '../messages.js';
import type { HarmonizerMessage, Route } from '../types.js';

/** Where the vector segments of a page are: counts per cell of a grid laid over the sheet. */
export interface PdfDensityGrid {
  cols: number;
  rows: number;
  /** Segments whose midpoint fell into the cell, row-major from the top-left. */
  segments: number[];
  /** Of those, the micro-segments. */
  micro: number[];
  max: number;
}

/** An axis-aligned box in points on the sheet as displayed: origin top-left, y down. */
export interface PdfBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A text item with its anchor on the sheet, top-left origin, y down, in points. */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
}

/** What was counted on one page. Lengths are in PDF points on paper. */
export interface PdfPageStats {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  /** Paths that are painted (stroked or filled); clipping paths are not drawn. */
  drawnPaths: number;
  /** Straight and curved segments of the painted paths. */
  drawnSegments: number;
  /** Straight segments only. */
  lineSegments: number;
  /** Straight segments shorter than the micro threshold on paper. */
  microSegments: number;
  /** Threshold used for `microSegments`, in points. */
  microThresholdPt: number;
  clipPaths: number;
  images: number;
  /** Largest image, as a fraction of the page area (can exceed 1 when it bleeds). */
  maxImageCoverage: number;
  textItems: number;
  textChars: number;
  /** Present when the adapter was asked for a density grid; the stage picture is drawn from it. */
  density?: PdfDensityGrid;
  /** Bounding boxes of the painted images, for the stage picture. */
  imageBoxes?: PdfBox[];
  /** Present when the adapter was asked for geometry: closed painted loops, sheet points, top-left origin. */
  closedPaths?: Array<Array<{ x: number; y: number }>>;
  /** Present when the adapter was asked for geometry: text items with their anchors. */
  texts?: PdfTextItem[];
}

export type PdfPageKind = 'vector' | 'raster' | 'hybrid' | 'empty';

export interface PdfPageThresholds {
  /** An image covering at least this share of the page is a scan background. */
  rasterCoverage: number;
  /** Fewer painted segments than this is not a floor plan. */
  minPlanSegments: number;
  /** Share of micro-segments above which hatching is reported. */
  microFractionWarn: number;
}

export const DEFAULT_PDF_PAGE_THRESHOLDS: PdfPageThresholds = {
  rasterCoverage: 0.8,
  minPlanSegments: 200,
  microFractionWarn: 0.3,
};

export interface PdfPageClassification {
  pageIndex: number;
  kind: PdfPageKind;
  route: Route;
  /** Named factors a reviewer can read, each in 0-1. */
  factors: Record<string, number>;
  messages: HarmonizerMessage[];
}

export function classifyPdfPage(
  stats: PdfPageStats,
  thresholds: PdfPageThresholds = DEFAULT_PDF_PAGE_THRESHOLDS,
): PdfPageClassification {
  const messages: HarmonizerMessage[] = [];
  const microFraction = stats.lineSegments > 0 ? stats.microSegments / stats.lineSegments : 0;
  const factors: Record<string, number> = {
    imageCoverage: clamp01(stats.maxImageCoverage),
    segments: clamp01(stats.drawnSegments / thresholds.minPlanSegments),
    text: stats.textChars > 0 ? 1 : 0,
    microFraction: clamp01(microFraction),
  };

  const scanBackground = stats.images > 0 && stats.maxImageCoverage >= thresholds.rasterCoverage;
  const enoughVector = stats.drawnSegments >= thresholds.minPlanSegments;

  let kind: PdfPageKind;
  let route: Route;
  if (scanBackground && !enoughVector) {
    kind = 'raster';
    route = 'raster';
    messages.push(message(MessageCodes.RASTER_NOT_SUPPORTED, 'warning', { page: stats.pageIndex }));
  } else if (scanBackground) {
    kind = 'hybrid';
    route = 'raster';
    messages.push(
      message(MessageCodes.PDF_HYBRID, 'warning', {
        page: stats.pageIndex,
        coverage: stats.maxImageCoverage,
        segments: stats.drawnSegments,
      }),
    );
  } else if (stats.drawnSegments === 0 && stats.images === 0 && stats.textChars === 0) {
    kind = 'empty';
    route = 'unavailable';
    messages.push(message(MessageCodes.PDF_EMPTY_PAGE, 'info', { page: stats.pageIndex }));
  } else {
    kind = 'vector';
    route = 'vector';
    if (!enoughVector) {
      messages.push(message(MessageCodes.PDF_FEW_PATHS, 'info', { page: stats.pageIndex, segments: stats.drawnSegments }));
    }
  }

  if (kind === 'vector' && stats.textChars === 0) {
    messages.push(message(MessageCodes.PDF_NO_TEXT, 'warning', { page: stats.pageIndex }));
  }
  if (kind !== 'raster' && kind !== 'empty' && microFraction >= thresholds.microFractionWarn) {
    messages.push(
      message(MessageCodes.MICRO_SEGMENTS, 'info', {
        page: stats.pageIndex,
        fraction: microFraction,
        thresholdMm: Math.round(((stats.microThresholdPt * 25.4) / 72) * 100) / 100,
      }),
    );
  }

  return { pageIndex: stats.pageIndex, kind, route, factors, messages };
}

/** The route of a whole document: vector if any page is, else raster if any page is, else unavailable. */
export function routeForPages(pages: readonly PdfPageClassification[]): Route {
  if (pages.some((p) => p.route === 'vector')) return 'vector';
  if (pages.some((p) => p.route === 'raster')) return 'raster';
  return 'unavailable';
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
