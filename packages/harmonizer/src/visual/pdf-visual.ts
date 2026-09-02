/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage pictures for PDF pages.
 *
 * A page is drawn as a sheet in proportion, with the images it paints as
 * shaded boxes and the density of its vector segments as a grid of cells.
 * That is the picture the classifier decided on, and it makes the four hard
 * cases visible at a glance: a scan is one big box and no cells, a hybrid is
 * a big box with cells on top, hatching is a patch of amber cells, and a
 * title-block page is a few cells in one corner.
 */

import type { PdfPageClassification, PdfPageStats } from '../detect/pdf-page.js';
import type { StageVisual } from './stage-visual.js';
import { INK, LINE, MICRO, MUTED, PAPER, ROUTE_COLORS, badge, bar, clip, el, fmt, pct, root, text, wrap } from './svg.js';

export interface PdfPageVisualInput {
  stats: PdfPageStats;
  classification: PdfPageClassification;
}

/** Draw one page as a thumbnail of `size` px on its longer side. Returns the drawn width and height. */
export function drawPageThumb(stats: PdfPageStats, x: number, y: number, size: number): { svg: string; w: number; h: number } {
  const scale = size / Math.max(stats.widthPt, stats.heightPt);
  const w = stats.widthPt * scale;
  const h = stats.heightPt * scale;
  let svg = el('rect', { x, y, width: w, height: h, fill: PAPER, stroke: LINE });

  for (const b of stats.imageBoxes ?? []) {
    // Boxes are on the sheet as displayed, top-left origin, like the picture.
    const bx = x + Math.max(0, b.x) * scale;
    const by = y + Math.max(0, b.y) * scale;
    const bw = Math.min(b.w, stats.widthPt) * scale;
    const bh = Math.min(b.h, stats.heightPt) * scale;
    svg += el('rect', { x: bx, y: by, width: Math.max(1, bw), height: Math.max(1, bh), fill: ROUTE_COLORS.raster, 'fill-opacity': 0.22 });
  }

  const d = stats.density;
  if (d && d.max > 0) {
    const cw = w / d.cols;
    const ch = h / d.rows;
    const logMax = Math.log1p(d.max);
    for (let r = 0; r < d.rows; r++) {
      for (let c = 0; c < d.cols; c++) {
        const i = r * d.cols + c;
        const n = d.segments[i];
        if (n === 0) continue;
        const opacity = 0.12 + 0.88 * (Math.log1p(n) / logMax);
        const microShare = d.micro[i] / n;
        const fill = microShare >= 0.5 ? MICRO : ROUTE_COLORS.vector;
        svg += el('rect', { x: x + c * cw, y: y + r * ch, width: cw, height: ch, fill, 'fill-opacity': opacity });
      }
    }
  }
  return { svg, w, h };
}

const KIND_TITLES: Record<string, string> = {
  vector: 'Vector drawing',
  raster: 'Scan',
  hybrid: 'Scan with vector lines over it',
  empty: 'Empty page',
};

export function renderPdfPageVisual(input: PdfPageVisualInput, fileName = ''): StageVisual {
  const { stats, classification } = input;
  const width = 600;
  const thumb = drawPageThumb(stats, 16, 40, 240);
  const messageLines = classification.messages.flatMap((m) => wrap(m.text, 46));
  const rightTop = 40;
  const rightHeight = 24 + 4 * 24 + 3 * 16 + 8 + messageLines.length * 15;
  const height = Math.max(thumb.h + 80, rightTop + rightHeight + 16);
  let body = '';

  body += text(16, 26, `Page ${stats.pageIndex + 1}${fileName ? ` of ${clip(fileName, 40)}` : ''}`, { size: 13, weight: 'bold' });
  body += thumb.svg;
  body += text(16, 40 + thumb.h + 18, `${fmt((stats.widthPt * 25.4) / 72)} × ${fmt((stats.heightPt * 25.4) / 72)} mm`, { size: 11, fill: MUTED });

  const rx = 280;
  const b = badge(rx, rightTop, KIND_TITLES[classification.kind] ?? classification.kind, ROUTE_COLORS[classification.kind] ?? MUTED, 12);
  body += b.svg;
  body += text(rx + b.width + 10, rightTop + 15, `route: ${classification.route}`, { size: 11, fill: MUTED });

  const rows: Array<{ label: string; fraction: number; value: string; color: string }> = [
    { label: 'Image coverage', fraction: stats.maxImageCoverage, value: pct(stats.maxImageCoverage), color: ROUTE_COLORS.raster },
    { label: 'Vector segments', fraction: classification.factors.segments ?? 0, value: fmt(stats.drawnSegments), color: ROUTE_COLORS.vector },
    { label: 'Text', fraction: stats.textChars > 0 ? 1 : 0, value: `${fmt(stats.textChars)} chars`, color: ROLE_TEXT },
    { label: 'Micro-segments', fraction: classification.factors.microFraction ?? 0, value: pct(classification.factors.microFraction ?? 0), color: MICRO },
  ];
  rows.forEach((r, i) => {
    const y = rightTop + 36 + i * 24;
    body += text(rx, y + 10, r.label, { size: 11, fill: MUTED });
    body += bar(rx + 110, y + 2, 120, 10, r.fraction, r.color);
    body += text(rx + 238, y + 10, r.value, { size: 11 });
  });

  const cy = rightTop + 36 + 4 * 24 + 6;
  body += text(rx, cy, `${fmt(stats.drawnPaths)} painted paths · ${fmt(stats.clipPaths)} clip paths · ${fmt(stats.images)} image(s)`, { size: 11, fill: MUTED });
  body += text(rx, cy + 16, `${fmt(stats.textItems)} text items`, { size: 11, fill: MUTED });
  messageLines.forEach((line, i) => {
    body += text(rx, cy + 40 + i * 15, line, { size: 11, fill: INK });
  });

  return {
    stage: 'pdf-page',
    title: `Page ${stats.pageIndex + 1}: ${KIND_TITLES[classification.kind] ?? classification.kind}`,
    caption: 'Blue cells are where vector lines are, amber cells where most of them are shorter than a hatch stroke, the shaded box is an image. Check that the picture matches the sheet.',
    svg: root(width, height, body, `PDF page ${stats.pageIndex + 1}: ${classification.kind}`),
    width,
    height,
    facts: [
      { label: 'Kind', value: classification.kind },
      { label: 'Segments', value: fmt(stats.drawnSegments) },
      { label: 'Image coverage', value: pct(stats.maxImageCoverage) },
      { label: 'Text', value: `${fmt(stats.textChars)} characters` },
    ],
  };
}

const ROLE_TEXT = '#059669';

/** All pages of a document as a strip of thumbnails, each with its verdict. */
export function renderPdfDocumentVisual(pages: readonly PdfPageVisualInput[], fileName: string, route: string): StageVisual {
  const perRow = 5;
  const cell = 132;
  const rows = Math.max(1, Math.ceil(pages.length / perRow));
  const width = 16 + perRow * cell;
  const height = 48 + rows * (cell + 34);
  const counts = new Map<string, number>();
  for (const p of pages) counts.set(p.classification.kind, (counts.get(p.classification.kind) ?? 0) + 1);
  const summary = [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(', ');
  let body = '';
  body += text(16, 26, clip(fileName, 60), { size: 13, weight: 'bold' });
  const b = badge(width - 16 - (route.length * 12 * 0.62 + 14), 12, route, ROUTE_COLORS[route] ?? MUTED, 12);
  body += b.svg;
  body += text(16, 42, `${pages.length} page(s): ${summary}`, { size: 11, fill: MUTED });

  pages.forEach((p, i) => {
    const x = 16 + (i % perRow) * cell;
    const y = 56 + Math.floor(i / perRow) * (cell + 34);
    const thumb = drawPageThumb(p.stats, x + (cell - 12 - 100) / 2, y, 100);
    body += thumb.svg;
    const kb = badge(x, y + 110, `p${p.stats.pageIndex + 1} ${p.classification.kind}`, ROUTE_COLORS[p.classification.kind] ?? MUTED, 10);
    body += kb.svg;
  });

  return {
    stage: 'pdf-pages',
    title: 'What is on each page?',
    caption: 'One thumbnail per page with its verdict. A scan is a shaded box without cells, a drawing is cells without a box, a hybrid is both.',
    svg: root(width, height, body, `Pages of ${fileName}: ${summary}`),
    width,
    height,
    facts: [
      { label: 'Pages', value: String(pages.length) },
      { label: 'Verdicts', value: summary },
      { label: 'Route', value: route },
    ],
  };
}
