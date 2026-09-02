/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage picture for the space graph: the walls in grey with their corners,
 * spaces as amber nodes, doors as blue, assets as magenta, in the manner of
 * Archilogic's illustration. Adjacency is a dashed grey line between spaces,
 * a connection a solid line through its door; a space no door reaches from
 * the outside gets a red ring.
 */

import type { PlanarGraph } from '../topology/enclosed-areas.js';
import type { SpaceGraph } from '../topology/space-graph.js';
import { OUTSIDE_ID } from '../topology/space-graph.js';
import { bounds } from '../interpret/geometry.js';
import type { StageVisual } from './stage-visual.js';
import { LINE, MUTED, PANEL, badge, clip, el, fmt, root, text } from './svg.js';

export const GRAPH_COLORS = { space: '#f59e0b', door: '#2563eb', asset: '#c026d3', wall: '#9ca3af', unreachable: '#dc2626' };

export function renderSpaceGraphVisual(graph: SpaceGraph, planar: PlanarGraph, fileName = '', size = 440): StageVisual {
  const pts = planar.vertices.length > 0 ? planar.vertices : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const b = bounds(pts);
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
  const pad = 16;
  const scale = (size - 2 * pad) / extent;
  const mx = (x: number) => 16 + pad + (x - b.minX) * scale;
  const my = (y: number) => 40 + pad + (b.maxY - y) * scale;
  const pos = new Map(graph.nodes.map((n) => [n.id, n.position]));

  let drawing = el('rect', { x: 16, y: 40, width: size, height: size, fill: PANEL, stroke: LINE });
  // Walls and corners.
  let d = '';
  for (const e of planar.edges) {
    const a = planar.vertices[e.a];
    const c = planar.vertices[e.b];
    d += `M${mx(a.x).toFixed(1)} ${my(a.y).toFixed(1)}L${mx(c.x).toFixed(1)} ${my(c.y).toFixed(1)}`;
  }
  if (d) drawing += el('path', { d, fill: 'none', stroke: GRAPH_COLORS.wall, 'stroke-width': 1, 'stroke-dasharray': undefined });
  if (planar.vertices.length <= 400) {
    for (const v of planar.vertices) drawing += el('circle', { cx: mx(v.x), cy: my(v.y), r: 2, fill: GRAPH_COLORS.wall });
  }
  // Relations.
  for (const e of graph.edges) {
    if (e.a === OUTSIDE_ID || e.b === OUTSIDE_ID) continue;
    const pa = pos.get(e.a);
    const pb = pos.get(e.b);
    if (!pa || !pb) continue;
    if (e.kind === 'adjacent') {
      drawing += el('line', { x1: mx(pa.x), y1: my(pa.y), x2: mx(pb.x), y2: my(pb.y), stroke: GRAPH_COLORS.wall, 'stroke-width': 1, 'stroke-dasharray': '3 3' });
    } else if (e.kind === 'connected') {
      const via = e.via ? pos.get(e.via) : undefined;
      if (via) {
        drawing += el('path', { d: `M${mx(pa.x)} ${my(pa.y)}L${mx(via.x)} ${my(via.y)}L${mx(pb.x)} ${my(pb.y)}`, fill: 'none', stroke: '#6b7280', 'stroke-width': 1.5 });
      } else {
        drawing += el('line', { x1: mx(pa.x), y1: my(pa.y), x2: mx(pb.x), y2: my(pb.y), stroke: '#6b7280', 'stroke-width': 1.5 });
      }
    } else {
      drawing += el('line', { x1: mx(pa.x), y1: my(pa.y), x2: mx(pb.x), y2: my(pb.y), stroke: GRAPH_COLORS.asset, 'stroke-width': 1, 'stroke-opacity': 0.6 });
    }
  }
  // Exits: a stub from the door outwards.
  for (const e of graph.edges) {
    if (e.kind !== 'connected' || !e.via || (e.a !== OUTSIDE_ID && e.b !== OUTSIDE_ID)) continue;
    const inside = pos.get(e.a === OUTSIDE_ID ? e.b : e.a);
    const via = pos.get(e.via);
    if (!inside || !via) continue;
    drawing += el('line', { x1: mx(inside.x), y1: my(inside.y), x2: mx(via.x), y2: my(via.y), stroke: '#6b7280', 'stroke-width': 1.5 });
  }
  // Nodes over everything.
  const unreachable = new Set(graph.unreachable);
  for (const n of graph.nodes) {
    if (n.kind === 'outside') continue;
    const r = n.kind === 'space' ? 7 : n.kind === 'door' ? 5 : 5;
    const fill = n.kind === 'space' ? GRAPH_COLORS.space : n.kind === 'door' ? GRAPH_COLORS.door : GRAPH_COLORS.asset;
    if (unreachable.has(n.id)) drawing += el('circle', { cx: mx(n.position.x), cy: my(n.position.y), r: r + 4, fill: 'none', stroke: GRAPH_COLORS.unreachable, 'stroke-width': 2 });
    drawing += el('circle', { cx: mx(n.position.x), cy: my(n.position.y), r, fill, 'fill-opacity': 0.85, stroke: '#ffffff', 'stroke-width': 1.5 });
    if (n.kind === 'space' && n.label) drawing += text(mx(n.position.x) + 9, my(n.position.y) + 4, clip(n.label, 16), { size: 9 });
  }

  const tx = 16 + size + 24;
  const width = tx + 280;
  const height = 40 + size + 40;
  const s = graph.stats;
  let panel = text(16, 26, clip(fileName || 'Space graph', 60), { size: 13, weight: 'bold' });
  const rows: Array<[string, string]> = [
    ['spaces', fmt(s.spaces)],
    ['adjacencies (shared walls)', fmt(s.adjacencies)],
    ['connections (doors, dividers)', fmt(s.connections)],
    ['doors placed in a wall', `${fmt(s.doorsPlaced)} of ${fmt(s.doors)}`],
    ['assets in rooms', fmt(s.assets)],
    ['unreachable from outside', fmt(s.unreachable)],
  ];
  rows.forEach(([label, v], i) => {
    panel += text(tx, 60 + i * 18, label, { size: 11, fill: MUTED });
    panel += text(tx + 190, 60 + i * 18, v, { size: 11 });
  });
  let y = 60 + rows.length * 18 + 14;
  for (const [label, color] of [
    ['space', GRAPH_COLORS.space],
    ['door', GRAPH_COLORS.door],
    ['asset', GRAPH_COLORS.asset],
    ['wall', GRAPH_COLORS.wall],
  ] as const) {
    panel += badge(tx, y - 12, label, color, 10).svg;
    y += 22;
  }

  return {
    stage: 'space-graph',
    title: 'How the spaces hang together',
    caption: 'Amber nodes are spaces, blue doors, magenta assets, grey the walls and their corners. A dashed line is a shared wall (adjacency), a solid line through a door is a way through (connectivity). A red ring marks a space no door reaches from outside.',
    svg: root(width, height, panel + drawing, `Space graph of ${fileName}`),
    width,
    height,
    facts: rows.map(([label, value]) => ({ label, value })),
  };
}
