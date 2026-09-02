/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * All stage pictures of a run, one under the other, numbered and captioned:
 * the walk from the file to the result. A host that has a stepper of its own
 * shows the visuals one at a time; this is for the protocol, a report, or a
 * person who wants the whole story on one page.
 */

import type { StageVisual } from './stage-visual.js';
import { LINE, MUTED, PAPER, ROUTE_COLORS, el, inner, root, text, wrap } from './svg.js';

export interface StoryboardOptions {
  /** Heading printed at the top. */
  title?: string;
}

export function renderStoryboard(visuals: readonly StageVisual[], options: StoryboardOptions = {}): StageVisual {
  const width = Math.max(640, ...visuals.map((v) => v.width + 32));
  let y = options.title ? 44 : 16;
  let body = options.title ? text(16, 30, options.title, { size: 16, weight: 'bold' }) : '';

  visuals.forEach((v, i) => {
    const captionLines = wrap(v.caption, Math.floor((width - 64) / 6.2));
    body += el('circle', { cx: 28, cy: y + 12, r: 12, fill: ROUTE_COLORS.vector });
    body += text(28, y + 16, String(i + 1), { size: 12, weight: 'bold', fill: PAPER, anchor: 'middle' });
    body += text(48, y + 16, v.title, { size: 14, weight: 'bold' });
    y += 30;
    captionLines.forEach((line) => {
      body += text(48, y + 10, line, { size: 11, fill: MUTED });
      y += 15;
    });
    y += 6;
    // A translated group rather than a nested <svg x y>: every renderer honours
    // the transform, while some (MuPDF among them) ignore the offset of a nested svg.
    body += `<g transform="translate(16 ${y})">${inner(v.svg)}</g>`;
    body += el('rect', { x: 16, y, width: v.width, height: v.height, fill: 'none', stroke: LINE });
    y += v.height + 28;
  });
  const height = y;

  return {
    stage: 'storyboard',
    title: options.title ?? 'Pipeline',
    caption: `${visuals.length} step(s), in the order they ran.`,
    svg: root(width, height, body, options.title ?? 'Pipeline storyboard'),
    width,
    height,
    facts: visuals.map((v, i) => ({ label: `${i + 1}. ${v.stage}`, value: v.title })),
  };
}
