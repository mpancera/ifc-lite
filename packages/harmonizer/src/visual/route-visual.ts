/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage picture for routing: the file on the left, the three possible routes
 * on the right, the one taken filled in. The messages that came with the
 * decision are printed underneath, because a refusal that cannot be seen next
 * to the picture of the fork is a refusal nobody reads.
 */

import type { InputRouting } from '../detect/input-kind.js';
import type { Route } from '../types.js';
import type { StageVisual } from './stage-visual.js';
import { INK, LINE, MUTED, PANEL, PAPER, ROUTE_COLORS, clip, el, root, text, wrap } from './svg.js';

const ROUTES: Array<{ route: Route; title: string; detail: string }> = [
  { route: 'vector', title: 'Vector', detail: 'read as geometry' },
  { route: 'raster', title: 'Raster', detail: 'a picture of a drawing' },
  { route: 'unavailable', title: 'Unavailable', detail: 'cannot be read here' },
];

const KIND_LABELS: Record<string, string> = {
  dxf: 'DXF drawing',
  dwg: 'DWG drawing',
  pdf: 'PDF document',
  image: 'Image',
  unknown: 'Unknown type',
};

export function renderRouteVisual(fileName: string, routing: InputRouting): StageVisual {
  const width = 640;
  const messageLines = routing.messages.flatMap((m) => wrap(m.text, 92));
  const height = 212 + (messageLines.length > 0 ? messageLines.length * 16 + 12 : 0);
  let body = '';

  // File card.
  body += el('rect', { x: 16, y: 72, width: 220, height: 72, rx: 8, fill: PANEL, stroke: LINE });
  body += text(28, 98, clip(fileName, 28), { size: 13, weight: 'bold' });
  body += text(28, 120, KIND_LABELS[routing.kind] ?? routing.kind, { size: 12, fill: MUTED });
  body += text(28, 136, `.${fileName.split('.').pop() ?? ''}`, { size: 11, fill: MUTED, mono: true });

  // The fork.
  ROUTES.forEach((r, i) => {
    const y = 24 + i * 64;
    const chosen = routing.route === r.route;
    const color = ROUTE_COLORS[r.route];
    body += el('path', { d: `M236 108 C 300 108, 300 ${y + 24}, 360 ${y + 24}`, fill: 'none', stroke: chosen ? color : LINE, 'stroke-width': chosen ? 3 : 1.5 });
    body += el('rect', { x: 360, y, width: 260, height: 48, rx: 8, fill: chosen ? color : PAPER, stroke: chosen ? color : LINE, 'stroke-width': 1.5 });
    body += text(376, y + 21, r.title, { size: 13, weight: 'bold', fill: chosen ? PAPER : INK });
    body += text(376, y + 38, r.detail, { size: 11, fill: chosen ? PAPER : MUTED });
    if (chosen) body += text(608, y + 30, '✓', { size: 16, weight: 'bold', fill: PAPER, anchor: 'end' });
  });

  messageLines.forEach((line, i) => {
    body += text(16, 228 + i * 16, line, { size: 12, fill: i === 0 ? INK : MUTED });
  });

  return {
    stage: 'route',
    title: 'Which way can this file go?',
    caption:
      routing.route === 'vector'
        ? 'The file can be read as geometry. The pages or layers are checked next.'
        : routing.route === 'raster'
          ? 'The file is a picture. It can be traced over, not read automatically.'
          : 'The file cannot be read here. The message says what to ask for instead.',
    svg: root(width, height, body, `Routing of ${fileName}: ${routing.route}`),
    width,
    height,
    facts: [
      { label: 'File', value: fileName },
      { label: 'Kind', value: routing.kind },
      { label: 'Route', value: routing.route },
    ],
  };
}
