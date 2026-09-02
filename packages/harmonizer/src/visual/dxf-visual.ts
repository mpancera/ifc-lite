/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage picture for a DXF: the drawing in miniature, one group per layer,
 * coloured by the role that was suggested for it, next to the counts the
 * suggestion rests on. Wall layers are drawn in ink, outline layers in blue,
 * text as green dots, block references as violet squares, and layers marked
 * for exclusion in a faint grey, so what would go into the room finder and
 * what would be left out are both visible before anyone decides.
 *
 * Each layer sits in its own `<g data-layer="…" data-role="…">`, so a host
 * that lets the person toggle layers can hide and show groups without
 * redrawing.
 */

import type { DxfDocument, DxfEntity } from '@ifc-lite/drawing-2d';
import { dxfBounds, type DxfLayerStats, type DxfQuality } from '../detect/dxf-quality.js';
import type { LayerRoleSuggestion } from '../detect/layer-roles.js';
import { insunitsName } from '../detect/dxf-quality.js';
import type { StageVisual } from './stage-visual.js';
import { LINE, MUTED, PANEL, ROLE_COLORS, ROUTE_COLORS, SYMBOL, badge, bar, clip, el, fmt, root, text } from './svg.js';

export interface DxfVisualOptions {
  /** Longer side of the miniature in px. Default 380. */
  size?: number;
  /** Segments drawn per layer at most; beyond that every k-th is drawn. Default 2500. */
  maxSegmentsPerLayer?: number;
  /** Layer rows listed at most. Default 24. */
  maxLayerRows?: number;
}

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function segmentsOf(e: DxfEntity, into: Seg[]): void {
  switch (e.kind) {
    case 'line':
      into.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 });
      break;
    case 'polyline': {
      const v = e.vertices;
      const n = e.closed ? v.length : v.length - 1;
      for (let i = 0; i < n; i++) {
        const a = v[i];
        const b = v[(i + 1) % v.length];
        into.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
      break;
    }
    case 'arc':
    case 'circle': {
      const start = e.kind === 'arc' ? (e.startDeg * Math.PI) / 180 : 0;
      let end = e.kind === 'arc' ? (e.endDeg * Math.PI) / 180 : Math.PI * 2;
      if (end <= start) end += Math.PI * 2;
      const steps = 12;
      for (let i = 0; i < steps; i++) {
        const a0 = start + ((end - start) * i) / steps;
        const a1 = start + ((end - start) * (i + 1)) / steps;
        into.push({ x1: e.cx + e.r * Math.cos(a0), y1: e.cy + e.r * Math.sin(a0), x2: e.cx + e.r * Math.cos(a1), y2: e.cy + e.r * Math.sin(a1) });
      }
      break;
    }
    case 'solid': {
      const c = e.corners;
      for (let i = 0; i < c.length; i++) {
        const a = c[i];
        const b = c[(i + 1) % c.length];
        into.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
      break;
    }
    default:
      break;
  }
}

export function renderDxfVisual(doc: DxfDocument, quality: DxfQuality, roles: readonly LayerRoleSuggestion[], fileName = '', options: DxfVisualOptions = {}): StageVisual {
  const size = options.size ?? 380;
  const maxSeg = options.maxSegmentsPerLayer ?? 2500;
  const maxRows = options.maxLayerRows ?? 24;
  const roleOf = new Map(roles.map((r) => [r.layer, r.role]));
  const bounds = dxfBounds(doc);
  const pad = 12;
  const extent = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-9) : 1;
  const scale = (size - 2 * pad) / extent;
  const mx = (x: number) => 16 + pad + (x - (bounds?.minX ?? 0)) * scale;
  const my = (y: number) => 40 + pad + ((bounds?.maxY ?? 0) - y) * scale;

  // Group entities per layer.
  const byLayer = new Map<string, DxfEntity[]>();
  for (const e of doc.entities) {
    let list = byLayer.get(e.layer);
    if (!list) byLayer.set(e.layer, (list = []));
    list.push(e);
  }

  let drawing = el('rect', { x: 16, y: 40, width: size, height: size, fill: PANEL, stroke: LINE });
  // Excluded layers first so everything else draws over them.
  const order = [...byLayer.keys()].sort((a, b) => Number(roleOf.get(b) === 'exclude') - Number(roleOf.get(a) === 'exclude'));
  for (const layer of order) {
    const role = roleOf.get(layer) ?? 'unknown';
    const color = ROLE_COLORS[role] ?? ROLE_COLORS.unknown;
    const segs: Seg[] = [];
    let dots = '';
    let squares = '';
    for (const e of byLayer.get(layer) ?? []) {
      if (e.kind === 'text') dots += el('circle', { cx: mx(e.x), cy: my(e.y), r: 1.6, fill: ROLE_COLORS.text });
      else if (e.kind === 'insert') squares += el('rect', { x: mx(e.x) - 2, y: my(e.y) - 2, width: 4, height: 4, fill: SYMBOL });
      else segmentsOf(e, segs);
    }
    const step = segs.length > maxSeg ? segs.length / maxSeg : 1;
    let d = '';
    for (let i = 0; i < segs.length; i += step) {
      const s = segs[Math.floor(i)];
      d += `M${mx(s.x1).toFixed(1)} ${my(s.y1).toFixed(1)}L${mx(s.x2).toFixed(1)} ${my(s.y2).toFixed(1)}`;
    }
    const strokeWidth = role === 'exclude' ? 0.4 : role === 'wall' ? 0.7 : 0.6;
    drawing += el(
      'g',
      { 'data-layer': layer, 'data-role': role },
      (d ? el('path', { d, fill: 'none', stroke: color, 'stroke-width': strokeWidth, 'stroke-linecap': 'round' }) : '') + dots + squares,
    );
  }

  // Layer table.
  const tx = 16 + size + 28;
  const tableWidth = 470;
  const width = tx + tableWidth;
  const layers = quality.layers.slice(0, maxRows);
  const maxSegments = Math.max(1, ...quality.layers.map((l) => l.segments));
  let table = text(tx, 52, 'Layer', { size: 11, fill: MUTED, weight: 'bold' });
  table += text(tx + 150, 52, 'role', { size: 11, fill: MUTED, weight: 'bold' });
  table += text(tx + 230, 52, 'segments', { size: 11, fill: MUTED, weight: 'bold' });
  table += text(tx + 340, 52, 'texts · arcs · blocks · hatch', { size: 11, fill: MUTED, weight: 'bold' });
  layers.forEach((l: DxfLayerStats, i) => {
    const y = 66 + i * 20;
    const role = roleOf.get(l.name) ?? 'unknown';
    table += text(tx, y + 10, clip(l.name, 24), { size: 11, weight: role === 'exclude' ? undefined : 'bold' });
    table += badge(tx + 150, y - 1, role, ROLE_COLORS[role] ?? ROLE_COLORS.unknown, 9).svg;
    table += bar(tx + 230, y + 2, 60, 8, l.segments / maxSegments, l.microSegments * 2 > l.segments ? ROUTE_COLORS.raster : ROLE_COLORS.wall);
    table += text(tx + 296, y + 10, fmt(l.segments), { size: 11 });
    table += text(tx + 340, y + 10, `${fmt(l.texts)} · ${fmt(l.arcs)} · ${fmt(l.inserts)} · ${fmt(l.hatches)}`, { size: 11, fill: MUTED });
  });
  const more = quality.layers.length - layers.length;
  if (more > 0) table += text(tx, 66 + layers.length * 20 + 10, `and ${more} more layer(s)`, { size: 11, fill: MUTED });

  // Footer.
  const tableBottom = 66 + (layers.length + (more > 0 ? 1 : 0)) * 20 + 16;
  const height = Math.max(40 + size + 64, tableBottom + 60);
  const fy = height - 40;
  const unitLine =
    quality.units.source === 'insunits'
      ? `$INSUNITS ${quality.insunits} (${insunitsName(quality.insunits)})`
      : `no $INSUNITS, unit estimated from extent as ${fmt(quality.units.metresPerUnit, 3)} m per unit`;
  let footer = text(16, 26, clip(fileName || 'DXF', 60), { size: 13, weight: 'bold' });
  footer += text(16, fy, `${unitLine} · extent ${fmt(quality.extent * quality.units.metresPerUnit, 1)} m · ${fmt(quality.entities)} entities`, { size: 11, fill: MUTED });
  const conf = badge(16, fy + 8, `confidence: ${quality.confidence}`, quality.confidence === 'high' ? '#059669' : quality.confidence === 'review' ? ROUTE_COLORS.raster : ROUTE_COLORS.unavailable, 11);
  footer += conf.svg;
  if (quality.unresolvedBlocks.length > 0) {
    footer += text(16 + conf.width + 12, fy + 22, `${quality.unresolvedBlocks.length} block reference(s) without a block: ${clip(quality.unresolvedBlocks.join(', '), 50)}`, { size: 11, fill: ROUTE_COLORS.unavailable });
  }
  // Legend.
  let lx = tx;
  for (const [role, color] of Object.entries(ROLE_COLORS)) {
    footer += el('rect', { x: lx, y: fy - 9, width: 10, height: 10, fill: color });
    footer += text(lx + 14, fy, role, { size: 10, fill: MUTED });
    lx += role.length * 6.5 + 30;
  }
  footer += el('rect', { x: lx, y: fy - 9, width: 10, height: 10, fill: SYMBOL });
  footer += text(lx + 14, fy, 'block reference', { size: 10, fill: MUTED });

  return {
    stage: 'dxf-layers',
    title: 'What is on which layer?',
    caption: 'The drawing with every layer in the colour of its suggested role. Ink goes into the room finder, faint grey is left out, green dots are texts, violet squares are block references. The suggestion is a proposal; the person picks.',
    svg: root(width, height, footer + drawing + table, `DXF layers of ${fileName || 'drawing'}`),
    width,
    height,
    facts: [
      { label: 'Layers', value: String(quality.layers.length) },
      { label: 'Entities', value: fmt(quality.entities) },
      { label: 'Unit', value: unitLine },
      { label: 'Confidence', value: quality.confidence },
    ],
  };
}
