/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The text on the plan — room names and areas, door marks and sizes.
 *
 * An overlay rather than part of the drawing, for the same reason the model
 * origins and the placement preview are: it is text at a fixed size on screen,
 * so it changes on every zoom while the drawing underneath does not. Putting
 * it in the canvas would mean regenerating the drawing to read a label.
 *
 * # Upright, always
 * The plan can be turned (`planRotation`) and the geometry turns with it, but
 * the text does NOT — a room name at 37° is not a plan, it is a puzzle. This
 * is the same rule the origin markers already follow: the axes turn, the label
 * stays readable.
 *
 * # Fixed on screen, not in the model
 * A label is sized in screen pixels, so it stays legible at every zoom. That
 * is the right behaviour until plan mode has a real scale (#50, later item) —
 * text sized in metres would be a smear at 1:500 and fill a room at 1:20.
 */

import React from 'react';
import { labelFits, type PlanLabel } from '@/lib/plan/roomLabels';

export interface PlanLabelsProps {
  labels: readonly PlanLabel[];
  /** The transform the canvas paints with — the same one, or the text drifts. */
  transform: { x: number; y: number; scale: number; rotation: number };
}

/** Screen pixels. The mark leads, so it is the one that carries weight. */
const NAME_SIZE = 11;
const DETAIL_SIZE = 10;
const LINE_HEIGHT = 12;

export function PlanLabels({ labels, transform }: PlanLabelsProps): React.ReactElement | null {
  if (labels.length === 0) return null;

  const { x: tx, y: ty, scale, rotation } = transform;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const drawn = labels.map((label) => {
    const { lines } = label;
    if (!labelFits(lines, label, scale, NAME_SIZE, LINE_HEIGHT)) return null;

    const sx = label.anchor.x * scale;
    const sy = label.anchor.y * scale;
    const x = sx * cos - sy * sin + tx;
    const y = sx * sin + sy * cos + ty;

    // Centred on the anchor: the block grows up and down from the middle of
    // the room rather than hanging off it.
    const top = y - ((lines.length - 1) * LINE_HEIGHT) / 2;

    return (
      <g key={label.key} data-plan-label={label.expressId} data-plan-label-kind={label.kind}>
        {label.title && <title>{label.title}</title>}
        {lines.map((line, i) => (
          <text
            key={i}
            x={x}
            y={top + i * LINE_HEIGHT}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={i === 0 ? NAME_SIZE : DETAIL_SIZE}
            fontWeight={i === 0 ? 600 : 400}
            className="fill-zinc-700 dark:fill-zinc-300"
          >
            {line}
          </text>
        ))}
      </g>
    );
  });

  return (
    <svg className="absolute inset-0 h-full w-full pointer-events-none" data-plan-labels>
      {drawn}
    </svg>
  );
}

export default PlanLabels;
