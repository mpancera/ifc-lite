/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage picture for topology: the rooms the stroke network closed, the
 * faces it threw away, and the ends where a loop leaked. The contract: a
 * stage that filters shows what it discarded. A wall cavity is drawn
 * hatched in amber, a fragment hatched in grey, a leak as a red dot — so a
 * room that is missing can be traced to the gap that opened it.
 */

import type { TopologyResult } from '../topology/enclosed-areas.js';
import { bounds } from '../interpret/geometry.js';
import type { StageVisual } from './stage-visual.js';
import { LINE, MUTED, PANEL, ROUTE_COLORS, badge, clip, el, fmt, root, text } from './svg.js';
import type { SegmentLike } from '../topology/spatial-hash.js';

export function renderTopologyVisual(result: TopologyResult, segments: readonly SegmentLike[], fileName = '', size = 420): StageVisual {
  const pts = segments.flatMap((s) => [s.a, s.b]);
  const b = pts.length > 0 ? bounds(pts) : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
  const pad = 12;
  const scale = (size - 2 * pad) / extent;
  const mx = (x: number) => 16 + pad + (x - b.minX) * scale;
  const my = (y: number) => 40 + pad + (b.maxY - y) * scale;
  const path = (pl: readonly { x: number; y: number }[]) => pl.map((p, i) => `${i === 0 ? 'M' : 'L'}${mx(p.x).toFixed(1)} ${my(p.y).toFixed(1)}`).join('') + 'Z';

  let drawing =
    el('defs', {}, el('pattern', { id: 'hz-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#9ca3af', 'stroke-width': 2 }))) +
    el('rect', { x: 16, y: 40, width: size, height: size, fill: PANEL, stroke: LINE });
  // Strokes, thinned to what fits.
  const step = segments.length > 4000 ? segments.length / 4000 : 1;
  let d = '';
  for (let i = 0; i < segments.length; i += step) {
    const s = segments[Math.floor(i)];
    d += `M${mx(s.a.x).toFixed(1)} ${my(s.a.y).toFixed(1)}L${mx(s.b.x).toFixed(1)} ${my(s.b.y).toFixed(1)}`;
  }
  if (d) drawing += el('path', { d, fill: 'none', stroke: '#c9ced6', 'stroke-width': 0.5 });
  for (const f of result.rejected) {
    drawing += el('path', { d: path(f.outline), fill: f.reason === 'narrow' ? ROUTE_COLORS.raster : '#9ca3af', 'fill-opacity': 0.35, stroke: 'none' });
    drawing += el('path', { d: path(f.outline), fill: 'url(#hz-hatch)', stroke: 'none' });
  }
  for (const f of result.faces) {
    drawing += el('path', { d: path(f.outline), fill: '#059669', 'fill-opacity': 0.25, stroke: '#059669', 'stroke-width': 1 });
  }
  for (const p of result.dangling) {
    drawing += el('circle', { cx: mx(p.x), cy: my(p.y), r: 2.5, fill: ROUTE_COLORS.unavailable });
  }

  const tx = 16 + size + 24;
  const width = tx + 300;
  const height = 40 + size + 40;
  const s = result.stats;
  let panel = text(16, 26, clip(fileName || 'Topology', 60), { size: 13, weight: 'bold' });
  const rows: Array<[string, string]> = [
    ['strokes in', fmt(s.inputSegments)],
    ['hatching dropped', fmt(s.droppedShort)],
    ['vertices', fmt(s.vertices)],
    ['edges after split', fmt(s.edgesAfterSplit)],
    ['faces walked', fmt(s.faces)],
    ['rooms kept', fmt(result.faces.length)],
    ['narrow (wall cavities)', fmt(result.rejected.filter((f) => f.reason === 'narrow').length)],
    ['small (fragments)', fmt(result.rejected.filter((f) => f.reason === 'small').length)],
    ['leaks (dangling ends)', fmt(result.dangling.length)],
    ['time', `${fmt(s.timeMs)} ms`],
  ];
  rows.forEach(([label, v], i) => {
    panel += text(tx, 60 + i * 18, label, { size: 11, fill: MUTED });
    panel += text(tx + 170, 60 + i * 18, v, { size: 11 });
  });
  if (s.truncated) panel += badge(tx, 60 + rows.length * 18, 'truncated', ROUTE_COLORS.unavailable, 10).svg;

  return {
    stage: 'topology',
    title: 'Which strokes close into rooms?',
    caption: 'Green faces are rooms the stroke network closed. Amber hatched faces are wall cavities the width filter removed, grey hatched ones fragments below the minimum area. Red dots are stroke ends that meet nothing: that is where a room leaked.',
    svg: root(width, height, panel + drawing, `Topology of ${fileName}`),
    width,
    height,
    facts: rows.map(([label, value]) => ({ label, value })),
  };
}
