/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The cable being drawn, in the plan.
 *
 * # Why this is not the 3D overlay
 * `WiringOverlay` projects world points through the scene camera. The plan is
 * a different canvas with its own pan, zoom and rotation, and nothing in the
 * 3D camera knows about it — the same run drawn through both would appear in
 * two unrelated places. Here the positions come from the device marks, which
 * already carry the plan's own coordinates, and the same transform the marks
 * are painted with is applied. One source, one frame, no drift.
 *
 * The path shape is shared with the 3D overlay (`wiringPath`), so a run looks
 * like the same run in either view.
 */

import React, { useMemo } from 'react';
import type { DeviceMark } from '@/lib/plan/deviceSymbols';
import { wiringPath, type ScreenPoint } from './tools/wiringPath';

export interface PlanWiringCableProps {
  marks: readonly DeviceMark[];
  transform: { x: number; y: number; scale: number; rotation: number };
  /** Devices in the order they were clicked, controller first. */
  sequence: readonly number[];
  /** True when the run closes back on its start. */
  ring: boolean;
  /** The device under the cursor, drawn as the step being considered. */
  hover: number | null;
}

const CABLE = '#f59e0b';

export function PlanWiringCable({
  marks, transform, sequence, ring, hover,
}: PlanWiringCableProps): React.ReactElement | null {
  const { x: tx, y: ty, scale, rotation } = transform;

  const screenOf = useMemo(() => {
    const byId = new Map(marks.map((mark) => [mark.expressId, mark.position]));
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return (expressId: number): ScreenPoint | null => {
      const p = byId.get(expressId);
      if (!p) return null;
      const sx = p.x * scale;
      const sy = p.y * scale;
      return { x: sx * cos - sy * sin + tx, y: sx * sin + sy * cos + ty };
    };
  }, [marks, scale, rotation, tx, ty]);

  const points: ScreenPoint[] = [];
  for (const expressId of sequence) {
    const point = screenOf(expressId);
    // A device on another storey has no mark here. Skipping it leaves a gap
    // rather than a line to nowhere — and a run that crosses storeys is a real
    // thing the plan simply cannot show all of.
    if (point) points.push(point);
  }
  if (ring && points.length > 1) points.push(points[0]);

  const previewTo = hover !== null && !sequence.includes(hover) ? screenOf(hover) : null;
  const previewFrom = points[points.length - 1] ?? null;

  if (points.length < 2 && !(previewFrom && previewTo)) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      {points.length >= 2 && (
        <path
          d={wiringPath(points)}
          fill="none"
          stroke={CABLE}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      )}
      {previewFrom && previewTo && (
        <path
          d={wiringPath([previewFrom, previewTo])}
          fill="none"
          stroke={CABLE}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          opacity={0.7}
        />
      )}
    </svg>
  );
}

export default PlanWiringCable;
