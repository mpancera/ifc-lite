/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { classifyPdfPage, routeForPages, type PdfPageStats } from './pdf-page.js';
import { MessageCodes } from '../messages.js';

const A4 = { widthPt: 595, heightPt: 842, microThresholdPt: 1.417 };

function stats(over: Partial<PdfPageStats>): PdfPageStats {
  return {
    pageIndex: 0,
    ...A4,
    drawnPaths: 0,
    drawnSegments: 0,
    lineSegments: 0,
    microSegments: 0,
    clipPaths: 0,
    images: 0,
    maxImageCoverage: 0,
    textItems: 0,
    textChars: 0,
    ...over,
  };
}

describe('classifyPdfPage', () => {
  it('calls a CAD plot with text a vector page', () => {
    const c = classifyPdfPage(stats({ drawnPaths: 6000, drawnSegments: 7400, lineSegments: 7200, microSegments: 1400, textItems: 320, textChars: 2100 }));
    expect(c.kind).toBe('vector');
    expect(c.route).toBe('vector');
    expect(c.messages).toEqual([]);
    expect(c.factors.text).toBe(1);
  });

  it('calls a full-page image with nothing else a scan', () => {
    const c = classifyPdfPage(stats({ images: 1, maxImageCoverage: 0.99 }));
    expect(c.kind).toBe('raster');
    expect(c.route).toBe('raster');
    expect(c.messages.map((m) => m.code)).toEqual([MessageCodes.RASTER_NOT_SUPPORTED]);
  });

  it('calls a scan with vector lines traced over it a hybrid, still on the raster route', () => {
    const c = classifyPdfPage(stats({ images: 1, maxImageCoverage: 1.09, drawnPaths: 1600, drawnSegments: 2200, lineSegments: 1950, textChars: 1400 }));
    expect(c.kind).toBe('hybrid');
    expect(c.route).toBe('raster');
    expect(c.messages[0].code).toBe(MessageCodes.PDF_HYBRID);
    expect(c.messages[0].text).toContain('2200 vector segments');
    expect(c.messages[0].text).toContain('109 %');
  });

  it('does not let a logo turn a drawing into a scan', () => {
    const c = classifyPdfPage(stats({ images: 1, maxImageCoverage: 0.002, drawnSegments: 20000, lineSegments: 19000, textChars: 3000 }));
    expect(c.kind).toBe('vector');
  });

  it('reports vector geometry without any text', () => {
    const c = classifyPdfPage(stats({ drawnSegments: 5000, lineSegments: 5000 }));
    expect(c.kind).toBe('vector');
    expect(c.messages.map((m) => m.code)).toEqual([MessageCodes.PDF_NO_TEXT]);
  });

  it('reports hatching exported as micro-segments with the threshold in mm', () => {
    const c = classifyPdfPage(stats({ drawnSegments: 90000, lineSegments: 89000, microSegments: 63000, textChars: 500 }));
    expect(c.kind).toBe('vector');
    const m = c.messages.find((x) => x.code === MessageCodes.MICRO_SEGMENTS);
    expect(m).toBeDefined();
    expect(m?.text).toContain('71 %');
    expect(m?.text).toContain('0.5 mm');
  });

  it('calls a page with a handful of paths a title block, not a plan', () => {
    const c = classifyPdfPage(stats({ drawnSegments: 40, lineSegments: 40, textChars: 200 }));
    expect(c.kind).toBe('vector');
    expect(c.messages.map((m) => m.code)).toEqual([MessageCodes.PDF_FEW_PATHS]);
  });

  it('calls a page with nothing on it empty', () => {
    const c = classifyPdfPage(stats({}));
    expect(c.kind).toBe('empty');
    expect(c.route).toBe('unavailable');
  });

  it('honours custom thresholds', () => {
    const c = classifyPdfPage(stats({ images: 1, maxImageCoverage: 0.6 }), { rasterCoverage: 0.5, minPlanSegments: 10, microFractionWarn: 0.5 });
    expect(c.kind).toBe('raster');
  });
});

describe('routeForPages', () => {
  it('prefers vector, then raster, then unavailable', () => {
    const vector = classifyPdfPage(stats({ drawnSegments: 500, lineSegments: 500, textChars: 10 }));
    const raster = classifyPdfPage(stats({ pageIndex: 1, images: 1, maxImageCoverage: 1 }));
    const empty = classifyPdfPage(stats({ pageIndex: 2 }));
    expect(routeForPages([raster, vector])).toBe('vector');
    expect(routeForPages([empty, raster])).toBe('raster');
    expect(routeForPages([empty])).toBe('unavailable');
    expect(routeForPages([])).toBe('unavailable');
  });
});
