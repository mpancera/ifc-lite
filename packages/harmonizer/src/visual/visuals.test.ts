/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The pictures are SVG text, so the tests assert what a person would look
 * for in them (the verdict, the layer groups, the counts, the messages) and
 * that they are well-formed and self-contained, not their exact bytes.
 */

import { describe, expect, it } from 'vitest';
import { parseDxf } from '@ifc-lite/drawing-2d';
import { analyzeDxf } from '../detect/dxf-quality.js';
import { suggestLayerRoles } from '../detect/layer-roles.js';
import { routeByKind } from '../detect/input-kind.js';
import { classifyPdfPage, type PdfPageStats } from '../detect/pdf-page.js';
import { renderRouteVisual } from './route-visual.js';
import { renderPdfDocumentVisual, renderPdfPageVisual } from './pdf-visual.js';
import { renderDxfVisual } from './dxf-visual.js';
import { renderScaleVisual } from './scale-visual.js';
import { renderIdVisual } from './id-visual.js';
import { renderStoryboard } from './storyboard.js';
import { esc, fmt, wrap } from './svg.js';

function wellFormed(svg: string): void {
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  expect(svg).not.toMatch(/<script|href=|url\(/);
  // Every opened <g>/<svg> is closed.
  const open = (svg.match(/<g[\s>]/g) ?? []).length;
  const close = (svg.match(/<\/g>/g) ?? []).length;
  expect(open).toBe(close);
}

function stats(over: Partial<PdfPageStats>): PdfPageStats {
  return {
    pageIndex: 0,
    widthPt: 595,
    heightPt: 842,
    microThresholdPt: 1.417,
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

describe('svg helpers', () => {
  it('escapes markup and groups thousands', () => {
    expect(esc('A <b> & "c"')).toBe('A &lt;b&gt; &amp; &quot;c&quot;');
    expect(fmt(1234567)).toBe('1,234,567');
    expect(fmt(3.14159, 2)).toBe('3.14');
  });

  it('wraps on word boundaries', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });
});

describe('renderRouteVisual', () => {
  it('marks the route taken and prints the message', () => {
    const v = renderRouteVisual('plan.dwg', routeByKind('plan.dwg'));
    wellFormed(v.svg);
    expect(v.stage).toBe('route');
    expect(v.svg).toContain('Unavailable');
    expect(v.svg).toContain('✓');
    expect(v.svg).toContain('Export the same drawing as DXF');
    expect(v.facts).toContainEqual({ label: 'Route', value: 'unavailable' });
  });

  it('escapes a hostile file name', () => {
    const v = renderRouteVisual('<img src=x>.pdf', routeByKind('<img src=x>.pdf'));
    expect(v.svg).not.toContain('<img');
    expect(v.svg).toContain('&lt;img');
  });
});

describe('renderPdfPageVisual', () => {
  it('draws the image box and the density cells of a hybrid page', () => {
    const s = stats({
      images: 1,
      maxImageCoverage: 0.99,
      imageBoxes: [{ x: 0, y: 0, w: 595, h: 842 }],
      drawnSegments: 400,
      lineSegments: 400,
      density: { cols: 2, rows: 3, segments: [0, 0, 100, 0, 0, 300], micro: [0, 0, 0, 0, 0, 290], max: 300 },
      textChars: 50,
    });
    const v = renderPdfPageVisual({ stats: s, classification: classifyPdfPage(s) }, 'a.pdf');
    wellFormed(v.svg);
    expect(v.svg).toContain('Scan with vector lines over it');
    // The full-page image box, shaded amber.
    expect(v.svg).toContain('fill-opacity="0.22"');
    // Two non-empty cells: one blue, one amber because most of it is micro-segments.
    expect((v.svg.match(/#2563eb" fill-opacity=/g) ?? []).length).toBe(1);
    expect((v.svg.match(/#f59e0b" fill-opacity=/g) ?? []).length).toBe(1);
    expect(v.svg).toContain('210 × 297 mm');
    expect(v.svg).toContain('vector segments drawn over it');
  });

  it('draws a plain scan without any cells', () => {
    const s = stats({ images: 1, maxImageCoverage: 0.99, imageBoxes: [{ x: 0, y: 0, w: 595, h: 842 }], density: { cols: 2, rows: 3, segments: [0, 0, 0, 0, 0, 0], micro: [0, 0, 0, 0, 0, 0], max: 0 } });
    const v = renderPdfPageVisual({ stats: s, classification: classifyPdfPage(s) });
    expect(v.svg).toContain('Scan');
    expect(v.svg).not.toContain('#2563eb" fill-opacity=');
  });
});

describe('renderPdfDocumentVisual', () => {
  it('shows one thumbnail per page with its verdict and the document route', () => {
    const pages = [stats({ drawnSegments: 500, lineSegments: 500, textChars: 10 }), stats({ pageIndex: 1, images: 1, maxImageCoverage: 1 })].map((s) => ({ stats: s, classification: classifyPdfPage(s) }));
    const v = renderPdfDocumentVisual(pages, 'doc.pdf', 'vector');
    wellFormed(v.svg);
    expect(v.svg).toContain('p1 vector');
    expect(v.svg).toContain('p2 raster');
    expect(v.svg).toContain('2 page(s): 1 vector, 1 raster');
    expect(v.height).toBeGreaterThan(150);
  });
});

describe('renderDxfVisual', () => {
  const dxf = [
    '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC',
    '0\nSECTION\n2\nENTITIES',
    ...Array.from({ length: 30 }, (_, i) => `0\nLINE\n8\nA-WALL\n10\n0\n20\n${i}\n11\n20\n21\n${i}`),
    '0\nTEXT\n8\nA-TEXT\n10\n5\n20\n5\n40\n0.2\n1\nOffice',
    '0\nINSERT\n8\nE-DEV\n2\nMISSING\n10\n2\n20\n2',
    '0\nLINE\n8\nSCHRAFFUR\n10\n0\n20\n0\n11\n1\n21\n1',
    '0\nENDSEC\n0\nEOF\n',
  ].join('\n');

  it('draws one group per layer with its role, and lists the counts', () => {
    const doc = parseDxf(dxf);
    const q = analyzeDxf(doc);
    const v = renderDxfVisual(doc, q, suggestLayerRoles(q.layers), 'plan.dxf');
    wellFormed(v.svg);
    expect(v.svg).toContain('data-layer="A-WALL" data-role="wall"');
    expect(v.svg).toContain('data-layer="SCHRAFFUR" data-role="exclude"');
    expect(v.svg).toContain('data-layer="A-TEXT" data-role="text"');
    expect(v.svg).toContain('<circle'); // the text dot
    expect(v.svg).toContain('fill="#7c3aed"'); // the block-reference square
    expect(v.svg).toContain('$INSUNITS 6 (metres)');
    expect(v.svg).toContain('1 block reference(s) without a block: MISSING');
    expect(v.svg).toContain('confidence: review');
    expect(v.facts).toContainEqual({ label: 'Layers', value: '4' });
  });

  it('thins a dense layer to the requested number of segments', () => {
    const doc = parseDxf(dxf);
    const q = analyzeDxf(doc);
    const v = renderDxfVisual(doc, q, suggestLayerRoles(q.layers), 'plan.dxf', { maxSegmentsPerLayer: 10 });
    const wallPath = v.svg.match(/data-layer="A-WALL"[^>]*><path d="([^"]*)"/)?.[1] ?? '';
    expect((wallPath.match(/M/g) ?? []).length).toBe(10);
  });
});

describe('renderScaleVisual', () => {
  it('shows the paper scale and its source', () => {
    const v = renderScaleVisual({ source: 'filename', metresPerUnit: 0.035278, scaleDenominator: 100 }, 'a 1_100.pdf');
    wellFormed(v.svg);
    expect(v.svg).toContain('1:100');
    expect(v.svg).toContain('read from the file name');
    expect(v.svg).toContain('= 10.0 m in the building');
  });

  it('shows a drawing unit for a DXF', () => {
    const v = renderScaleVisual({ source: 'insunits', metresPerUnit: 0.001 });
    expect(v.svg).toContain('1 drawing unit = 1 mm');
    expect(v.svg).toContain('10,000 drawing units');
    expect(v.svg).toContain('= 10 m in the building');
    expect(renderScaleVisual({ source: 'insunits', metresPerUnit: 1 }).svg).toContain('1 drawing unit = 1 m');
  });

  it('asks for calibration when nothing is known', () => {
    const v = renderScaleVisual({ source: 'unknown', metresPerUnit: 0 });
    expect(v.title).toBe('Scale: unknown');
    expect(v.svg).toContain('Calibrate with two points');
  });
});

describe('renderIdVisual', () => {
  it('shows the chain from the parts to the id', () => {
    const v = renderIdVisual({ sourceFile: 'plan.dxf', storeyGlobalId: '2i3pUSiAHCw9Qs0Wec0t2n', handles: ['2F', '1A'], id: '0abcdefghijklmnopqrstu' });
    wellFormed(v.svg);
    expect(v.svg).toContain('0abcdefghijklmnopqrstu');
    expect(v.svg).toContain('Handles (2)');
    expect(v.svg).toContain('1A 2F');
  });
});

describe('renderStoryboard', () => {
  it('nests every visual in order with a number and its caption', () => {
    const a = renderScaleVisual({ source: 'unknown', metresPerUnit: 0 });
    const b = renderRouteVisual('x.pdf', routeByKind('x.pdf'));
    const v = renderStoryboard([a, b], { title: 'Run' });
    wellFormed(v.svg);
    expect(v.svg.indexOf('Scale: unknown')).toBeLessThan(v.svg.indexOf('Which way can this file go?'));
    expect((v.svg.match(/<g transform="translate\(16 /g) ?? []).length).toBe(2);
    // The nested pictures lost their outer <svg>: exactly one root remains.
    expect((v.svg.match(/<svg /g) ?? []).length).toBe(1);
    expect(v.height).toBeGreaterThan(a.height + b.height);
    expect(v.facts[1]).toEqual({ label: '2. route', value: 'Which way can this file go?' });
  });
});
