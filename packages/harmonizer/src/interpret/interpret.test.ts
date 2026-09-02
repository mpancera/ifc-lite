/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { parseDxf } from '@ifc-lite/drawing-2d';
import { confidenceBand, interpretDxf, interpretPdfPage } from './interpret.js';
import { area, pointInPolygon, regionWidth } from './geometry.js';
import { parseLabel } from './labels.js';
import { classifyBlock } from './symbols.js';
import type { PdfPageStats } from '../detect/pdf-page.js';
import { renderCandidatesVisual } from '../visual/candidates-visual.js';

type Pair = [number | string, number | string];
const pairs = (...p: Pair[]) => p.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
const poly = (layer: string, closed: boolean, ...pts: Array<[number, number]>): Pair[] => {
  const p: Pair[] = [[0, 'LWPOLYLINE'], [8, layer], [90, pts.length], [70, closed ? 1 : 0]];
  for (const [x, y] of pts) p.push([10, x], [20, y]);
  return p;
};
const text = (layer: string, x: number, y: number, value: string): Pair[] => [[0, 'TEXT'], [8, layer], [10, x], [20, y], [40, 0.2], [1, value]];
const insert = (layer: string, block: string, x: number, y: number): Pair[] => [[0, 'INSERT'], [8, layer], [2, block], [10, x], [20, y]];
const arc = (layer: string, cx: number, cy: number, r: number, a0: number, a1: number): Pair[] => [[0, 'ARC'], [8, layer], [10, cx], [20, cy], [40, r], [50, a0], [51, a1]];
const circle = (layer: string, cx: number, cy: number, r: number): Pair[] => [[0, 'CIRCLE'], [8, layer], [10, cx], [20, cy], [40, r]];

const dxf = parseDxf(
  pairs([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 6], [0, 'ENDSEC']) +
    pairs([0, 'SECTION'], [2, 'BLOCKS'], [0, 'BLOCK'], [2, 'RM_OPTISCH'], [10, 0], [20, 0], [0, 'CIRCLE'], [8, '0'], [10, 0], [20, 0], [40, 0.1], [0, 'ENDBLK'], [0, 'ENDSEC']) +
    pairs(
      [0, 'SECTION'],
      [2, 'ENTITIES'],
      ...poly('ROOMS', true, [0, 0], [5, 0], [5, 4], [0, 4]),
      ...text('TEXT', 1, 1, '1.02'),
      ...text('TEXT', 1, 2, 'Büro'),
      ...text('TEXT', 1, 3, '20.0 m2'),
      ...poly('ROOMS', true, [5, 0], [11, 0], [11, 4], [5, 4]),
      ...text('TEXT', 6, 2, 'Korridor'),
      // A wall cavity: 6 m long, 0.2 m wide, closed.
      ...poly('WALLS', true, [0, 4], [6, 4], [6, 4.2], [0, 4.2]),
      // Too small to be a room.
      ...poly('ROOMS', true, [20, 20], [20.5, 20], [20.5, 20.5], [20, 20.5]),
      ...insert('E-DEV', 'RM_OPTISCH', 2, 2),
      ...insert('E-DEV', 'STUHL_1', 3, 1),
      ...insert('E-DEV', '*U12', 4, 1),
      ...arc('WALLS', 5, 1, 0.9, 0, 90),
      ...arc('WALLS', 8, 1, 3, 0, 90),
      ...circle('WALLS', 9, 3, 0.2),
      ...text('TEXT', 30, 30, 'Legende'),
      [0, 'ENDSEC'],
      [0, 'EOF'],
    ),
);

const roles = { ROOMS: 'outline', WALLS: 'wall', TEXT: 'text', 'E-DEV': 'unknown' } as const;

describe('geometry', () => {
  it('measures a rectangle and its width', () => {
    const r = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 0.2 }, { x: 0, y: 0.2 }];
    expect(area(r)).toBeCloseTo(1.2, 9);
    expect(regionWidth(r)).toBeCloseTo(0.194, 3);
    expect(pointInPolygon({ x: 3, y: 0.1 }, r)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 1 }, r)).toBe(false);
  });
});

describe('parseLabel', () => {
  it('tells numbers, names and areas apart', () => {
    expect(parseLabel('1.02').kind).toBe('number');
    expect(parseLabel('EG.12').kind).toBe('number');
    expect(parseLabel('Büro').kind).toBe('name');
    expect(parseLabel('20.0 m2')).toMatchObject({ kind: 'area', areaM2: 20 });
    expect(parseLabel('12,5 m²').areaM2).toBe(12.5);
    expect(parseLabel('+++').kind).toBe('other');
  });
});

describe('classifyBlock', () => {
  it('reads device classes from block names', () => {
    expect(classifyBlock('RM_OPTISCH').class).toBe('detector');
    expect(classifyBlock('HANDFEUERMELDER_1').class).toBe('callpoint');
    expect(classifyBlock('CARD-READER').class).toBe('reader');
    expect(classifyBlock('XYZ').class).toBe('unknown');
  });
});

describe('interpretDxf', () => {
  const result = interpretDxf(dxf, roles, 1, { sourceFile: 'plan.dxf', storeyGlobalId: 'S1' });
  const spaces = result.candidates.filter((c) => c.type === 'space');

  it('turns closed outlines into rooms and names them from the texts inside', () => {
    expect(spaces).toHaveLength(2);
    const buero = spaces.find((s) => s.text?.includes('Büro'));
    expect(buero?.text).toBe('1.02 Büro');
    expect(buero?.confidenceReasons['area-label']).toBe(1);
    expect(confidenceBand(buero!.confidence)).toBe('high');
    expect(spaces.find((s) => s.text === 'Korridor')).toBeDefined();
  });

  it('rejects the wall cavity as narrow and the tiny loop as small', () => {
    expect(result.stats.rejected.map((r) => r.reason).sort()).toEqual(['narrow', 'small']);
  });

  it('classifies block references and skips anonymous blocks', () => {
    const symbols = result.candidates.filter((c) => c.type === 'symbol');
    expect(symbols.map((s) => s.symbol?.blockName).sort()).toEqual(['RM_OPTISCH', 'STUHL_1']);
    const detector = symbols.find((s) => s.symbol?.blockName === 'RM_OPTISCH');
    expect(detector?.symbol?.classified).toBe('detector');
    expect(detector?.confidenceReasons['block-defined']).toBe(1);
    expect(symbols.find((s) => s.symbol?.blockName === 'STUHL_1')?.confidenceReasons['block-defined']).toBe(0.5);
  });

  it('takes a quarter-circle arc of door size for a door and a small circle for a column', () => {
    const doors = result.candidates.filter((c) => c.type === 'door');
    expect(doors).toHaveLength(1);
    expect(doors[0].thickness).toBeCloseTo(0.9, 9);
    expect(result.candidates.filter((c) => c.type === 'column')).toHaveLength(1);
  });

  it('keeps a text outside every room as a loose label', () => {
    const labels = result.candidates.filter((c) => c.type === 'label');
    expect(labels.map((l) => l.text)).toEqual(['Legende']);
    expect(confidenceBand(labels[0].confidence)).toBe('low');
  });

  it('gives the same ids on a second run and different ones for another storey', () => {
    const again = interpretDxf(dxf, roles, 1, { sourceFile: 'plan.dxf', storeyGlobalId: 'S1' });
    expect(again.candidates.map((c) => c.id)).toEqual(result.candidates.map((c) => c.id));
    const other = interpretDxf(dxf, roles, 1, { sourceFile: 'plan.dxf', storeyGlobalId: 'S2' });
    expect(other.candidates[0].id).not.toBe(result.candidates[0].id);
  });

  it('leaves excluded layers out entirely', () => {
    const r = interpretDxf(dxf, { ...roles, ROOMS: 'exclude' }, 1, { sourceFile: 'plan.dxf' });
    expect(r.candidates.filter((c) => c.type === 'space')).toHaveLength(0);
  });
});

describe('interpretPdfPage', () => {
  const stats: PdfPageStats = {
    pageIndex: 0,
    widthPt: 842,
    heightPt: 595,
    microThresholdPt: 1.4,
    drawnPaths: 2,
    drawnSegments: 8,
    lineSegments: 8,
    microSegments: 0,
    clipPaths: 0,
    images: 0,
    maxImageCoverage: 0,
    textItems: 1,
    textChars: 6,
    closedPaths: [
      [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }, { x: 100, y: 250 }],
      [{ x: 400, y: 100 }, { x: 410, y: 100 }, { x: 410, y: 500 }, { x: 400, y: 500 }],
    ],
    texts: [{ text: 'Büro 1', x: 120, y: 130 }],
  };

  it('makes rooms from closed loops at the sheet scale and names them', () => {
    const r = interpretPdfPage(stats, 0.035278, { sourceFile: 'a.pdf' });
    const spaces = r.candidates.filter((c) => c.type === 'space');
    expect(spaces).toHaveLength(1);
    expect(spaces[0].text).toBe('Büro 1');
    // y is flipped: the sheet's top-left loop lies high in plan coordinates.
    expect(spaces[0].geometry[0].y).toBeCloseTo((595 - 100) * 0.035278, 6);
    expect(r.stats.rejected[0].reason).toBe('narrow');
  });

  it('marks every room down when the scale is unknown', () => {
    const r = interpretPdfPage(stats, 0, { sourceFile: 'a.pdf' });
    expect(r.candidates.find((c) => c.type === 'space')?.confidenceReasons.units).toBe(0.3);
  });
});

describe('renderCandidatesVisual', () => {
  it('draws rooms, symbols and the band counts', () => {
    const result = interpretDxf(dxf, roles, 1, { sourceFile: 'plan.dxf' });
    const v = renderCandidatesVisual(result, 'plan.dxf');
    expect(v.svg.startsWith('<svg')).toBe(true);
    expect(v.svg).toContain('1.02 Büro');
    expect(v.svg).toContain('confirmable');
    expect(v.facts).toContainEqual({ label: 'rooms', value: '2' });
  });
});
