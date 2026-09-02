/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The adapter is exercised against hand-built operator lists in the exact
 * shape pdf.js 6 produces (checked against a real plot and a real scan), so
 * no PDF library is needed here and the CTM arithmetic is pinned down.
 */

import { describe, expect, it } from 'vitest';
import { collectPdfPageStats, type PdfOpsTable, type PdfPageLike } from './pdf-adapter.js';

/** The numeric codes of pdf.js 6.2; only the values matter, not that they are real. */
const OPS: PdfOpsTable = {
  save: 10,
  restore: 11,
  transform: 12,
  constructPath: 91,
  endPath: 28,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
};
const STROKE = 20;

type Op = [number, unknown];

function page(ops: Op[], texts: string[] = [], size = { width: 595, height: 842 }): PdfPageLike {
  return {
    getViewport: () => size,
    getOperatorList: async () => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) }),
    getTextContent: async () => ({ items: texts.map((str) => ({ str })) }),
  };
}

/** A pdf.js 6 path: [paintOp, [Float32Array of draw ops], minMax]. */
function path(paintOp: number, ...draw: number[]): Op {
  return [OPS.constructPath, [paintOp, [new Float32Array(draw)], new Float32Array(4)]];
}

describe('collectPdfPageStats', () => {
  it('counts a rectangle as four line segments, closePath included', async () => {
    const s = await collectPdfPageStats(page([path(STROKE, 0, 10, 10, 1, 110, 10, 1, 110, 60, 1, 10, 60, 4)]), OPS, 0);
    expect(s.drawnPaths).toBe(1);
    expect(s.drawnSegments).toBe(4);
    expect(s.lineSegments).toBe(4);
    expect(s.microSegments).toBe(0);
    expect(s.clipPaths).toBe(0);
  });

  it('does not count a clipping path as drawn', async () => {
    const s = await collectPdfPageStats(page([path(OPS.endPath, 0, 0, 0, 1, 595, 0, 1, 595, 842, 1, 0, 842, 4), [29, []]]), OPS, 0);
    expect(s.drawnPaths).toBe(0);
    expect(s.drawnSegments).toBe(0);
    expect(s.clipPaths).toBe(1);
  });

  it('measures segment length on paper through the CTM', async () => {
    // A CAD plot scales user space by 0.05: a 20-unit line is 1 pt on paper, under the 1.417 pt threshold.
    const s = await collectPdfPageStats(
      page([
        [OPS.save, null],
        [OPS.transform, [0.05, 0, 0, 0.05, 0, 0]],
        path(STROKE, 0, 0, 0, 1, 20, 0),
        path(STROKE, 0, 0, 0, 1, 2000, 0),
        [OPS.restore, null],
        path(STROKE, 0, 0, 0, 1, 20, 0),
      ]),
      OPS,
      0,
    );
    expect(s.lineSegments).toBe(3);
    expect(s.microSegments).toBe(1);
  });

  it('counts curves as segments but not as lines', async () => {
    const s = await collectPdfPageStats(page([path(STROKE, 0, 0, 0, 2, 10, 10, 20, 10, 30, 0, 3, 40, 10, 50, 0)]), OPS, 0);
    expect(s.drawnSegments).toBe(2);
    expect(s.lineSegments).toBe(0);
  });

  it('measures an image by the unit square under the CTM', async () => {
    const s = await collectPdfPageStats(
      page([
        [OPS.save, null],
        [OPS.transform, [595, 0, 0, 842, 0, 0]],
        [OPS.paintImageXObject, ['img_p0_1', 2480, 3484]],
        [OPS.restore, null],
        [OPS.save, null],
        [OPS.transform, [50, 0, 0, 50, 500, 780]],
        [OPS.paintImageXObject, ['img_p0_2', 289, 289]],
        [OPS.restore, null],
      ]),
      OPS,
      3,
    );
    expect(s.pageIndex).toBe(3);
    expect(s.images).toBe(2);
    expect(s.maxImageCoverage).toBeCloseTo(1, 5);
  });

  it('applies a form XObject matrix and pops it again', async () => {
    const s = await collectPdfPageStats(
      page([
        [OPS.paintFormXObjectBegin, [[2, 0, 0, 2, 0, 0], [0, 0, 100, 100]]],
        [OPS.transform, [297.5, 0, 0, 421, 0, 0]],
        [OPS.paintImageXObject, ['img', 10, 10]],
        [OPS.paintFormXObjectEnd, null],
        path(STROKE, 0, 0, 0, 1, 1, 0),
      ]),
      OPS,
      0,
    );
    expect(s.maxImageCoverage).toBeCloseTo(1, 5);
    // After the form ends, the CTM is identity again: a 1-unit line is 1 pt, a micro-segment.
    expect(s.microSegments).toBe(1);
  });

  it('counts text items and characters, ignoring whitespace-only items', async () => {
    const s = await collectPdfPageStats(page([], ['Office', ' ', '12.5 m2', '']), OPS, 0);
    expect(s.textItems).toBe(2);
    expect(s.textChars).toBe(6 + 7);
  });

  it('reports the page size in points', async () => {
    const s = await collectPdfPageStats(page([], [], { width: 1191, height: 842 }), OPS, 0);
    expect(s.widthPt).toBe(1191);
    expect(s.heightPt).toBe(842);
  });

  it('bins segments into a density grid and reports image boxes when asked', async () => {
    const s = await collectPdfPageStats(
      page([
        // A 100 pt line in the top-left corner and a micro-segment near the bottom-right.
        path(STROKE, 0, 10, 800, 1, 110, 800),
        path(STROKE, 0, 500, 20, 1, 500.5, 20),
        [OPS.save, null],
        [OPS.transform, [200, 0, 0, 100, 300, 700]],
        [OPS.paintImageXObject, ['img', 10, 10]],
        [OPS.restore, null],
      ]),
      OPS,
      0,
      { densityCols: 4 },
    );
    expect(s.density?.cols).toBe(4);
    expect(s.density?.rows).toBe(6); // 4 × 842 / 595, rounded
    expect(s.density?.segments[0]).toBe(1); // top-left cell
    expect(s.density?.segments[4 * 6 - 1]).toBe(1); // bottom-right cell
    expect(s.density?.micro[4 * 6 - 1]).toBe(1);
    expect(s.density?.max).toBe(1);
    // User-space box 300..500 × 700..800 (y up) lands at y = 842 - 800 = 42 on the displayed sheet.
    expect(s.imageBoxes).toEqual([{ x: 300, y: 42, w: 200, h: 100 }]);
  });

  it('starts from the viewport transform when the page provides one', async () => {
    // A MediaBox starting at (1000, 1000): without the transform every point would land off the sheet.
    const p = page([path(STROKE, 0, 1010, 1800, 1, 1110, 1800)]);
    p.getViewport = () => ({ width: 595, height: 842, transform: [1, 0, 0, -1, -1000, 1842] });
    const s = await collectPdfPageStats(p, OPS, 0, { densityCols: 4 });
    expect(s.density?.segments[0]).toBe(1);
    expect(s.lineSegments).toBe(1);
    expect(s.microSegments).toBe(0);
  });

  it('leaves the density out when not asked for it', async () => {
    const s = await collectPdfPageStats(page([path(STROKE, 0, 0, 0, 1, 10, 0)]), OPS, 0);
    expect(s.density).toBeUndefined();
    expect(s.imageBoxes).toEqual([]);
  });

  it('stops counting a path on an unknown draw op instead of reading coordinates as opcodes', async () => {
    const s = await collectPdfPageStats(page([path(STROKE, 0, 0, 0, 1, 10, 0, 9, 1, 50, 0)]), OPS, 0);
    expect(s.lineSegments).toBe(1);
  });
});
