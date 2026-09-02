/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage picture for interpretation: the candidates, each in the colour of
 * its confidence band. Green is what can be confirmed in one go, amber what
 * needs a look, red what is a guess. Rooms are filled, doors are their swing,
 * columns are circles, symbols are squares with the first letter of their
 * class, labels are dots. The contract: a stage that draws candidates colours
 * them by confidence.
 */

import type { InterpretResult } from '../interpret/interpret.js';
import { confidenceBand } from '../interpret/interpret.js';
import { bounds } from '../interpret/geometry.js';
import type { Candidate } from '../types.js';
import type { StageVisual } from './stage-visual.js';
import { LINE, MUTED, PANEL, badge, clip, el, fmt, root, text } from './svg.js';

export const BAND_COLORS: Record<'high' | 'review' | 'low', string> = {
  high: '#059669',
  review: '#f59e0b',
  low: '#dc2626',
};

export function renderCandidatesVisual(result: InterpretResult, fileName = '', size = 420): StageVisual {
  const cands = result.candidates;
  const all = cands.flatMap((c) => c.geometry);
  const b = all.length > 0 ? bounds(all) : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
  const pad = 12;
  const scale = (size - 2 * pad) / extent;
  const mx = (x: number) => 16 + pad + (x - b.minX) * scale;
  const my = (y: number) => 40 + pad + (b.maxY - y) * scale;

  let drawing = el('rect', { x: 16, y: 40, width: size, height: size, fill: PANEL, stroke: LINE });
  const byBand = { high: 0, review: 0, low: 0 };
  const draw = (c: Candidate) => {
    const band = confidenceBand(c.confidence);
    byBand[band] += 1;
    const color = BAND_COLORS[band];
    switch (c.type) {
      case 'space': {
        const d = c.geometry.map((p, i) => `${i === 0 ? 'M' : 'L'}${mx(p.x).toFixed(1)} ${my(p.y).toFixed(1)}`).join('') + 'Z';
        drawing += el('path', { d, fill: color, 'fill-opacity': 0.25, stroke: color, 'stroke-width': 1 });
        if (c.text) {
          const cx = c.geometry.reduce((s, p) => s + p.x, 0) / c.geometry.length;
          const cy = c.geometry.reduce((s, p) => s + p.y, 0) / c.geometry.length;
          drawing += text(mx(cx), my(cy), clip(c.text, 18), { size: 9, anchor: 'middle' });
        }
        break;
      }
      case 'door': {
        const d = c.geometry.slice(1).map((p, i) => `${i === 0 ? 'M' : 'L'}${mx(p.x).toFixed(1)} ${my(p.y).toFixed(1)}`).join('');
        drawing += el('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.5 });
        break;
      }
      case 'column': {
        const d = c.geometry.map((p, i) => `${i === 0 ? 'M' : 'L'}${mx(p.x).toFixed(1)} ${my(p.y).toFixed(1)}`).join('') + 'Z';
        drawing += el('path', { d, fill: color, 'fill-opacity': 0.6, stroke: color });
        break;
      }
      case 'symbol': {
        const p = c.geometry[0];
        drawing += el('rect', { x: mx(p.x) - 4, y: my(p.y) - 4, width: 8, height: 8, fill: color });
        drawing += text(mx(p.x) + 6, my(p.y) + 3, (c.symbol?.classified ?? '?').slice(0, 1).toUpperCase(), { size: 8, fill: color });
        break;
      }
      default: {
        const p = c.geometry[0];
        drawing += el('circle', { cx: mx(p.x), cy: my(p.y), r: 1.8, fill: color });
      }
    }
  };
  // Spaces first so everything else draws over them.
  for (const c of cands.filter((x) => x.type === 'space')) draw(c);
  for (const c of cands.filter((x) => x.type !== 'space')) draw(c);

  const tx = 16 + size + 24;
  const width = tx + 300;
  const height = 40 + size + 40;
  let panel = text(16, 26, clip(fileName || 'Candidates', 60), { size: 13, weight: 'bold' });
  const rows: Array<[string, number]> = [
    ['rooms', result.stats.spaces],
    ['named rooms', result.stats.named],
    ['doors', result.stats.doors],
    ['columns', result.stats.columns],
    ['symbols', result.stats.symbols],
    ['loose labels', result.stats.labels],
    ['rejected loops', result.stats.rejected.length],
  ];
  rows.forEach(([label, n], i) => {
    panel += text(tx, 60 + i * 18, label, { size: 11, fill: MUTED });
    panel += text(tx + 150, 60 + i * 18, fmt(n), { size: 11 });
  });
  let y = 60 + rows.length * 18 + 16;
  for (const band of ['high', 'review', 'low'] as const) {
    const label = band === 'high' ? '≥ 0.8 confirmable' : band === 'review' ? '0.5–0.8 review' : '< 0.5 guess';
    const bd = badge(tx, y - 12, `${fmt(byBand[band])} ${label}`, BAND_COLORS[band], 10);
    panel += bd.svg;
    y += 24;
  }

  return {
    stage: 'candidates',
    title: 'What the strokes are taken for',
    caption: 'Every candidate in the colour of its confidence: green can be confirmed in one go, amber needs a look, red is a guess. Rooms are filled, doors are swings, columns circles, symbols squares, loose labels dots.',
    svg: root(width, height, panel + drawing, `Candidates of ${fileName}`),
    width,
    height,
    facts: rows.map(([label, n]) => ({ label, value: String(n) })),
  };
}
