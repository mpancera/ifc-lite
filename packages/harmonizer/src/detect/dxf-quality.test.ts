/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { parseDxf } from '@ifc-lite/drawing-2d';
import { analyzeDxf } from './dxf-quality.js';
import { suggestLayerRoles } from './layer-roles.js';
import { MessageCodes } from '../messages.js';

type Pair = [number | string, number | string];

function pairs(...p: Pair[]): string {
  return p.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
}

function line(layer: string, x1: number, y1: number, x2: number, y2: number): Pair[] {
  return [[0, 'LINE'], [8, layer], [10, x1], [20, y1], [11, x2], [21, y2]];
}

function text(layer: string, x: number, y: number, value: string): Pair[] {
  return [[0, 'TEXT'], [8, layer], [10, x], [20, y], [40, 0.2], [1, value]];
}

function insert(layer: string, block: string, x: number, y: number): Pair[] {
  return [[0, 'INSERT'], [8, layer], [2, block], [10, x], [20, y]];
}

function polyline(layer: string, closed: boolean, ...pts: Array<[number, number]>): Pair[] {
  const p: Pair[] = [[0, 'LWPOLYLINE'], [8, layer], [90, pts.length], [70, closed ? 1 : 0]];
  for (const [x, y] of pts) p.push([10, x], [20, y]);
  return p;
}

function dxf(options: { insunits?: number; blocks?: string[]; entities: Pair[] }): string {
  const header = options.insunits === undefined ? [] : pairs([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, options.insunits], [0, 'ENDSEC']);
  const blocks =
    options.blocks && options.blocks.length > 0
      ? pairs(
          [0, 'SECTION'],
          [2, 'BLOCKS'],
          ...options.blocks.flatMap((name): Pair[] => [
            [0, 'BLOCK'],
            [2, name],
            [10, 0],
            [20, 0],
            [0, 'CIRCLE'],
            [8, '0'],
            [10, 0],
            [20, 0],
            [40, 0.1],
            [0, 'ENDBLK'],
          ]),
          [0, 'ENDSEC'],
        )
      : '';
  const entities = pairs([0, 'SECTION'], [2, 'ENTITIES'], ...options.entities, [0, 'ENDSEC'], [0, 'EOF']);
  return header + blocks + entities;
}

/** A small "storey": a wall grid with enough segments to count as a plan. */
function wallGrid(layer: string, n: number, unit = 1): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i <= n; i++) {
    out.push(...line(layer, 0, i * 3 * unit, n * 3 * unit, i * 3 * unit));
    out.push(...line(layer, i * 3 * unit, 0, i * 3 * unit, n * 3 * unit));
  }
  return out;
}

describe('analyzeDxf', () => {
  it('reads the unit from $INSUNITS and counts per layer', () => {
    const doc = parseDxf(
      dxf({
        insunits: 6,
        entities: [...wallGrid('A-WALL', 12), ...text('A-TEXT', 1, 1, 'Office'), ...text('A-TEXT', 4, 1, 'Corridor')],
      }),
    );
    const q = analyzeDxf(doc);
    expect(q.units).toEqual({ source: 'insunits', metresPerUnit: 1 });
    expect(q.confidence).toBe('high');
    expect(q.messages).toEqual([]);
    const wall = q.layers.find((l) => l.name === 'A-WALL');
    const label = q.layers.find((l) => l.name === 'A-TEXT');
    expect(wall?.segments).toBe(26);
    expect(wall?.texts).toBe(0);
    expect(label?.texts).toBe(2);
    expect(label?.segments).toBe(0);
    expect(q.extent).toBe(36);
  });

  it('estimates millimetres for a unitless drawing with a large extent, and says so', () => {
    const doc = parseDxf(dxf({ entities: wallGrid('WAND', 12, 1000) }));
    const q = analyzeDxf(doc);
    expect(q.units).toEqual({ source: 'estimated', metresPerUnit: 0.001 });
    expect(q.confidence).toBe('review');
    expect(q.messages[0].code).toBe(MessageCodes.DXF_NO_UNITS);
    expect(q.messages[0].text).toContain('millimetres');
  });

  it('flags block references whose block is not in the file', () => {
    const doc = parseDxf(
      dxf({
        insunits: 6,
        blocks: ['DETECTOR'],
        entities: [...wallGrid('A-WALL', 12), ...insert('E-DEV', 'DETECTOR', 1, 1), ...insert('E-DEV', 'detector', 2, 2), ...insert('E-DEV', 'SITE|TREE', 3, 3)],
      }),
    );
    const q = analyzeDxf(doc);
    expect(q.unresolvedBlocks).toEqual(['SITE|TREE']);
    expect(q.confidence).toBe('review');
    const m = q.messages.find((x) => x.code === MessageCodes.DXF_UNRESOLVED_BLOCKS);
    expect(m?.text).toContain('SITE|TREE');
    expect(q.layers.find((l) => l.name === 'E-DEV')?.inserts).toBe(3);
  });

  it('counts micro-segments in metres regardless of the drawing unit', () => {
    // 30 mm strokes in a millimetre drawing: under 50 mm, so micro.
    const hatch: Pair[] = [];
    for (let i = 0; i < 40; i++) hatch.push(...line('HATCH', i * 100, 0, i * 100 + 30, 30));
    const doc = parseDxf(dxf({ insunits: 4, entities: [...wallGrid('A-WALL', 12, 1000), ...hatch] }));
    const q = analyzeDxf(doc);
    expect(q.layers.find((l) => l.name === 'HATCH')?.microSegments).toBe(40);
    expect(q.messages.find((x) => x.code === MessageCodes.MICRO_SEGMENTS)?.text).toContain('50 mm');
    expect(q.confidence).toBe('review');
  });

  it('counts closed polylines separately, as room outline candidates', () => {
    const doc = parseDxf(
      dxf({
        insunits: 6,
        entities: [
          ...wallGrid('A-WALL', 12),
          ...polyline('ROOMS', true, [0, 0], [3, 0], [3, 3], [0, 3]),
          ...polyline('ROOMS', false, [10, 10], [12, 10]),
        ],
      }),
    );
    const rooms = analyzeDxf(doc).layers.find((l) => l.name === 'ROOMS');
    expect(rooms?.polylines).toBe(2);
    expect(rooms?.closedPolylines).toBe(1);
    expect(rooms?.segments).toBe(4 + 1);
  });

  it('calls a near-empty file poor', () => {
    const doc = parseDxf(dxf({ insunits: 6, entities: line('A-WALL', 0, 0, 1, 0) }));
    expect(analyzeDxf(doc).confidence).toBe('poor');
  });
});

describe('suggestLayerRoles', () => {
  it('suggests from counts first and names second, and never decides', () => {
    const doc = parseDxf(
      dxf({
        insunits: 6,
        entities: [
          ...wallGrid('01_Waende', 12),
          ...text('Beschriftung', 1, 1, 'Office'),
          ...line('Beschriftung', 0, 0, 0.5, 0),
          ...polyline('POLYGON', true, [0, 0], [3, 0], [3, 3], [0, 3]),
          ...wallGrid('SCHRAFFUR', 3),
          ...wallGrid('L7', 50),
          ...line('misc', 0, 0, 1, 1),
        ],
      }),
    );
    const suggestions = suggestLayerRoles(analyzeDxf(doc).layers);
    const roles = Object.fromEntries(suggestions.map((s) => [s.layer, s.role]));
    const codes = Object.fromEntries(suggestions.map((s) => [s.layer, s.reasonCode]));
    expect(codes).toEqual({
      '01_Waende': 'name-wall',
      Beschriftung: 'text-count',
      POLYGON: 'name-outline',
      SCHRAFFUR: 'name-exclude',
      L7: 'segment-count',
      misc: 'inconclusive',
    });
    expect(suggestions.find((s) => s.layer === 'L7')?.reasonData.segments).toBe(102);
    expect(roles).toEqual({
      '01_Waende': 'wall',
      Beschriftung: 'text',
      POLYGON: 'outline',
      SCHRAFFUR: 'exclude',
      L7: 'wall',
      misc: 'unknown',
    });
  });
});
