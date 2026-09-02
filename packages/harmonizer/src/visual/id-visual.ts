/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage picture for identity: the chain from what produced an element to
 * its GlobalId. It is the picture to show when someone asks why a corrected
 * room is still the same room after the plan was re-imported: because its
 * id is made from the file, the storey and the strokes, not drawn at random.
 */

import type { StageVisual } from './stage-visual.js';
import { INK, LINE, MUTED, PANEL, ROUTE_COLORS, clip, el, root, text } from './svg.js';

export interface IdVisualInput {
  sourceFile: string;
  storeyGlobalId?: string;
  handles: readonly string[];
  /** The id these parts produced. */
  id: string;
}

export function renderIdVisual(input: IdVisualInput): StageVisual {
  const width = 680;
  const height = 150;
  const boxes: Array<{ title: string; value: string }> = [
    { title: 'File', value: clip(input.sourceFile, 22) },
    { title: 'Storey', value: input.storeyGlobalId ? clip(input.storeyGlobalId, 22) : '(none)' },
    { title: `Handles (${input.handles.length})`, value: clip([...input.handles].sort().join(' '), 22) || '(none)' },
    { title: 'Hash', value: 'FNV-1a, 128 bit' },
  ];
  let body = text(16, 26, 'Where the id comes from', { size: 13, weight: 'bold' });
  const bw = 140;
  boxes.forEach((b, i) => {
    const x = 16 + i * (bw + 20);
    body += el('rect', { x, y: 44, width: bw, height: 52, rx: 6, fill: PANEL, stroke: LINE });
    body += text(x + 10, 62, b.title, { size: 10, fill: MUTED });
    body += text(x + 10, 84, b.value, { size: 11, mono: true, fill: INK });
    if (i < boxes.length - 1) body += text(x + bw + 5, 74, '→', { size: 14, fill: MUTED });
  });
  body += text(16, 128, 'GlobalId', { size: 10, fill: MUTED });
  body += text(76, 128, input.id, { size: 15, mono: true, weight: 'bold', fill: ROUTE_COLORS.vector });
  body += text(width - 16, 128, 'same input, same id, every run', { size: 11, fill: MUTED, anchor: 'end' });

  return {
    stage: 'ids',
    title: 'Why an element keeps its id',
    caption: 'The id is a hash of the source file, the storey and the drawing handles. A re-import of the same plan finds the same element, so a correction made in the viewer is not lost.',
    svg: root(width, height, body, `GlobalId ${input.id} derived from ${input.sourceFile}`),
    width,
    height,
    facts: [
      { label: 'GlobalId', value: input.id },
      { label: 'File', value: input.sourceFile },
      { label: 'Handles', value: String(input.handles.length) },
    ],
  };
}
