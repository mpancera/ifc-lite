/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Device marks, drawn over the plan.
 *
 * # Fixed on screen, like the labels and unlike the swings
 * A swing arc is real geometry and grows with the zoom, because it describes
 * the space a door needs. A device mark describes nothing about size — it is
 * there to be SEEN, and one that shrank with the zoom would vanish exactly
 * when the plan got busy enough to need it (#50). So it keeps a constant size
 * in pixels, as the text does.
 *
 * The mark turns with nothing: a circle has no orientation, and the two shapes
 * that do (the triangle, the terminal's diagonal) are read more easily upright
 * than laid over. Same rule as the labels.
 */

import React from 'react';
import {
  deviceMarkPaths, DEVICE_MARK_SCREEN_PX, type DeviceMark,
} from '@/lib/plan/deviceSymbols';

export interface PlanDeviceMarksProps {
  marks: readonly DeviceMark[];
  /** The transform the canvas paints with — the same one, or the marks drift. */
  transform: { x: number; y: number; scale: number; rotation: number };
}

export function PlanDeviceMarks({
  marks, transform,
}: PlanDeviceMarksProps): React.ReactElement | null {
  if (marks.length === 0) return null;

  const { x: tx, y: ty, scale, rotation } = transform;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const size = DEVICE_MARK_SCREEN_PX;

  return (
    <svg className="absolute inset-0 h-full w-full pointer-events-none" data-plan-device-marks>
      {marks.map((mark) => {
        const sx = mark.position.x * scale;
        const sy = mark.position.y * scale;
        const x = sx * cos - sy * sin + tx;
        const y = sx * sin + sy * cos + ty;

        let d = '';
        for (const path of deviceMarkPaths(mark.kind)) {
          path.forEach((p, i) => {
            const px = x + p.x * size;
            const py = y + p.y * size;
            d += `${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)} `;
          });
        }

        return (
          <path
            key={mark.key}
            data-plan-device-mark={mark.expressId}
            data-device-kind={mark.kind}
            d={d.trim()}
            // Filled white behind the stroke so a mark on a hatched wall or a
            // shaded room stays a mark rather than becoming part of it.
            className="fill-white dark:fill-zinc-950 stroke-zinc-800 dark:stroke-zinc-200"
            strokeWidth={1.2}
          >
            <title>
              {mark.name ? `${mark.name} — ${mark.ifcType}` : `${mark.ifcType} #${mark.expressId}`}
            </title>
          </path>
        );
      })}
    </svg>
  );
}

export default PlanDeviceMarks;
