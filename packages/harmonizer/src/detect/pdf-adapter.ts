/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Counting what a pdf.js page draws.
 *
 * pdf.js is not a dependency of this package: the caller loads the document
 * with whichever pdf.js build suits it (browser worker, legacy Node build)
 * and hands in the page plus the `OPS` table. Only the structural shape used
 * here is typed, so the adapter compiles against any pdf.js from 5.x on.
 *
 * pdf.js >= 5 encodes a path as one flat array of draw ops
 * (0 moveTo x y, 1 lineTo x y, 2 curveTo x1 y1 x2 y2 x y,
 * 3 quadraticCurveTo cx cy x y, 4 closePath) in user space under the current
 * transformation matrix. Lengths on paper therefore need the CTM: `transform`
 * multiplies it, `save`/`restore` stack it, and a form XObject pushes its own
 * matrix. Images are painted into the unit square under the CTM, which is how
 * their share of the page is measured. A `constructPath` whose paint op is
 * `endPath` is a clipping path and is not drawn.
 */

import type { PdfBox, PdfDensityGrid, PdfPageStats, PdfTextItem } from './pdf-page.js';

export interface PdfOperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

/** pdf.js mixes text items with marked-content markers in one list; only items with a `str` count. */
export interface PdfTextContentLike {
  items: ArrayLike<unknown>;
}

/** The part of a pdf.js `PDFPageProxy` this adapter touches. */
export interface PdfPageLike {
  /**
   * `transform` maps user space to the viewport (top-left origin, y down)
   * and accounts for a MediaBox that does not start at 0,0 and for page
   * rotation. Without it the adapter assumes an origin at 0,0 and flips y.
   */
  getViewport(params: { scale: number }): { width: number; height: number; transform?: ArrayLike<number> };
  getOperatorList(): Promise<PdfOperatorList>;
  getTextContent(): Promise<PdfTextContentLike>;
}

/** The part of pdf.js `OPS` this adapter reads. Pass `OPS` itself. */
export interface PdfOpsTable {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  endPath: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
  paintImageXObjectRepeat: number;
  paintImageMaskXObjectRepeat: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
}

export interface CollectPdfPageStatsOptions {
  /** Straight segments shorter than this on paper count as micro-segments. Default 0.5 mm. */
  microThresholdPt?: number;
  /**
   * Columns of the density grid for the stage picture; rows follow the page
   * proportion. Omit for counts only. 48 is a good picture, 96 a fine one.
   */
  densityCols?: number;
  /**
   * Also keep the closed painted loops and the text items with positions, for
   * the interpretation stage. Loops are capped at `maxClosedPaths` (default
   * 5000) and only kept when they have at least three corners.
   */
  collectGeometry?: boolean;
  maxClosedPaths?: number;
}

type Matrix = [number, number, number, number, number, number];

const DEFAULT_MICRO_THRESHOLD_PT = (0.5 / 25.4) * 72;

const DRAW_MOVE = 0;
const DRAW_LINE = 1;
const DRAW_CURVE = 2;
const DRAW_QUAD = 3;
const DRAW_CLOSE = 4;

function multiply(ctm: Matrix, m: Matrix): Matrix {
  return [
    ctm[0] * m[0] + ctm[2] * m[1],
    ctm[1] * m[0] + ctm[3] * m[1],
    ctm[0] * m[2] + ctm[2] * m[3],
    ctm[1] * m[2] + ctm[3] * m[3],
    ctm[0] * m[4] + ctm[2] * m[5] + ctm[4],
    ctm[1] * m[4] + ctm[3] * m[5] + ctm[5],
  ];
}

function apply(ctm: Matrix, x: number, y: number): [number, number] {
  return [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
}

function isMatrix(v: unknown): v is Matrix {
  return Array.isArray(v) && v.length === 6 && v.every((n) => typeof n === 'number');
}

function isNumberList(v: unknown): v is ArrayLike<number> {
  return v !== null && typeof v === 'object' && typeof (v as ArrayLike<number>).length === 'number';
}

/** Area of the unit square under the CTM, as a fraction of the page. */
function unitSquareCoverage(ctm: Matrix, pageArea: number): number {
  const det = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
  return pageArea > 0 ? det / pageArea : 0;
}

interface Grid extends PdfDensityGrid {
  cellW: number;
  cellH: number;
  pageH: number;
}

interface PathCounts {
  segments: number;
  lines: number;
  micro: number;
  grid?: Grid;
  /** Closed loops in sheet coordinates, when geometry is collected. */
  loops?: Array<Array<{ x: number; y: number }>>;
  maxLoops: number;
}

function makeGrid(cols: number, widthPt: number, heightPt: number): Grid {
  const rows = Math.max(1, Math.round((cols * heightPt) / Math.max(widthPt, 1e-9)));
  return {
    cols,
    rows,
    segments: new Array<number>(cols * rows).fill(0),
    micro: new Array<number>(cols * rows).fill(0),
    max: 0,
    cellW: widthPt / cols,
    cellH: heightPt / rows,
    pageH: heightPt,
  };
}

function bin(grid: Grid, x: number, y: number, micro: boolean): void {
  // Coordinates are already in viewport space: top-left origin, y down.
  const c = Math.floor(x / grid.cellW);
  const r = Math.floor(y / grid.cellH);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return;
  const i = r * grid.cols + c;
  grid.segments[i] += 1;
  if (micro) grid.micro[i] += 1;
  if (grid.segments[i] > grid.max) grid.max = grid.segments[i];
}

function line(x1: number, y1: number, x2: number, y2: number, ctm: Matrix, microThresholdPt: number, into: PathCounts): void {
  const [ax, ay] = apply(ctm, x1, y1);
  const [bx, by] = apply(ctm, x2, y2);
  const len = Math.hypot(bx - ax, by - ay);
  const micro = len < microThresholdPt;
  into.segments += 1;
  into.lines += 1;
  if (micro) into.micro += 1;
  if (into.grid) bin(into.grid, (ax + bx) / 2, (ay + by) / 2, micro);
}

/** Bounding box of the unit square under the CTM: where an image lands on the page. */
function unitSquareBox(ctm: Matrix): PdfBox {
  const corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function countPath(data: ArrayLike<number>, ctm: Matrix, microThresholdPt: number, into: PathCounts): void {
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const n = data.length;
  // The current subpath, in sheet coordinates, when loops are collected.
  let sub: Array<{ x: number; y: number }> | null = null;
  const keep = (x: number, y: number) => {
    if (!sub) return;
    const [px, py] = apply(ctm, x, y);
    sub.push({ x: px, y: py });
  };
  const closeSub = () => {
    if (sub && into.loops && sub.length >= 3 && into.loops.length < into.maxLoops) into.loops.push(sub);
    sub = null;
  };
  while (i < n) {
    const op = data[i++];
    switch (op) {
      case DRAW_MOVE: {
        closeSubIfReturned();
        cx = sx = data[i++];
        cy = sy = data[i++];
        if (into.loops) {
          sub = [];
          keep(cx, cy);
        }
        break;
      }
      case DRAW_LINE: {
        const x = data[i++];
        const y = data[i++];
        line(cx, cy, x, y, ctm, microThresholdPt, into);
        cx = x;
        cy = y;
        keep(x, y);
        break;
      }
      case DRAW_CURVE: {
        i += 4;
        cx = data[i++];
        cy = data[i++];
        into.segments += 1;
        keep(cx, cy);
        break;
      }
      case DRAW_QUAD: {
        i += 2;
        cx = data[i++];
        cy = data[i++];
        into.segments += 1;
        keep(cx, cy);
        break;
      }
      case DRAW_CLOSE: {
        if (cx !== sx || cy !== sy) line(cx, cy, sx, sy, ctm, microThresholdPt, into);
        cx = sx;
        cy = sy;
        closeSub();
        break;
      }
      default:
        // Unknown draw op: the encoding changed under us. Stop counting this
        // path rather than reading coordinates as opcodes.
        return;
    }
  }
  closeSubIfReturned();

  // A subpath that ends where it began is closed even without an explicit closePath.
  function closeSubIfReturned(): void {
    if (!sub) return;
    if (sub.length >= 4 && Math.abs(cx - sx) < 1e-6 && Math.abs(cy - sy) < 1e-6) {
      sub.pop();
      closeSub();
    } else {
      sub = null;
    }
  }
}

/**
 * Walk a page's operator list and text content and return the counts the
 * classifier decides on.
 */
export async function collectPdfPageStats(
  page: PdfPageLike,
  ops: PdfOpsTable,
  pageIndex: number,
  options: CollectPdfPageStatsOptions = {},
): Promise<PdfPageStats> {
  const microThresholdPt = options.microThresholdPt ?? DEFAULT_MICRO_THRESHOLD_PT;
  const viewport = page.getViewport({ scale: 1 });
  const pageArea = viewport.width * viewport.height;

  const [opList, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);

  // Start from the viewport transform so every length and position below is
  // on the sheet as it is displayed: top-left origin, points, y down.
  const vt = viewport.transform;
  const base: Matrix = vt && vt.length === 6 ? [vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]] : [1, 0, 0, -1, 0, viewport.height];
  const stack: Matrix[] = [];
  let ctm: Matrix = base;
  let drawnPaths = 0;
  let clipPaths = 0;
  let images = 0;
  let maxImageCoverage = 0;
  const imageBoxes: PdfBox[] = [];
  const counts: PathCounts = {
    segments: 0,
    lines: 0,
    micro: 0,
    grid: options.densityCols && options.densityCols > 0 ? makeGrid(Math.floor(options.densityCols), viewport.width, viewport.height) : undefined,
    loops: options.collectGeometry ? [] : undefined,
    maxLoops: options.maxClosedPaths ?? 5000,
  };

  const fns = opList.fnArray;
  const args = opList.argsArray;
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i];
    const arg = args[i];
    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? base;
    } else if (fn === ops.transform) {
      if (isMatrix(arg)) ctm = multiply(ctm, arg);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = Array.isArray(arg) ? arg[0] : undefined;
      if (isMatrix(m)) ctm = multiply(ctm, m);
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? base;
    } else if (
      fn === ops.paintImageXObject ||
      fn === ops.paintInlineImageXObject ||
      fn === ops.paintImageMaskXObject ||
      fn === ops.paintImageXObjectRepeat ||
      fn === ops.paintImageMaskXObjectRepeat
    ) {
      images += 1;
      maxImageCoverage = Math.max(maxImageCoverage, unitSquareCoverage(ctm, pageArea));
      imageBoxes.push(unitSquareBox(ctm));
    } else if (fn === ops.constructPath) {
      if (!Array.isArray(arg) || arg.length < 2) continue;
      const paintOp = arg[0];
      const paths: unknown = arg[1];
      if (paintOp === ops.endPath) {
        clipPaths += 1;
        continue;
      }
      drawnPaths += 1;
      if (Array.isArray(paths)) {
        for (const p of paths) {
          if (isNumberList(p)) countPath(p, ctm, microThresholdPt, counts);
        }
      } else if (isNumberList(paths)) {
        countPath(paths, ctm, microThresholdPt, counts);
      }
    }
  }

  let textItems = 0;
  let textChars = 0;
  const texts: PdfTextItem[] | undefined = options.collectGeometry ? [] : undefined;
  for (let i = 0; i < text.items.length; i++) {
    const item = text.items[i];
    const str = item !== null && typeof item === 'object' && 'str' in item ? (item as { str?: unknown }).str : undefined;
    const s = typeof str === 'string' ? str.trim() : '';
    if (s.length === 0) continue;
    textItems += 1;
    textChars += s.length;
    if (texts) {
      // A text item's transform carries its anchor in user space; through the
      // base matrix it lands on the sheet like everything else.
      const tr = (item as { transform?: unknown }).transform;
      if (isMatrix(tr)) {
        const [x, y] = apply(base, tr[4], tr[5]);
        texts.push({ text: s, x, y });
      }
    }
  }

  return {
    pageIndex,
    widthPt: viewport.width,
    heightPt: viewport.height,
    drawnPaths,
    drawnSegments: counts.segments,
    lineSegments: counts.lines,
    microSegments: counts.micro,
    microThresholdPt,
    clipPaths,
    images,
    maxImageCoverage,
    textItems,
    textChars,
    imageBoxes,
    ...(counts.loops ? { closedPaths: counts.loops } : {}),
    ...(texts ? { texts } : {}),
    ...(counts.grid
      ? { density: { cols: counts.grid.cols, rows: counts.grid.rows, segments: counts.grid.segments, micro: counts.grid.micro, max: counts.grid.max } }
      : {}),
  };
}
