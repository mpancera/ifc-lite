/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Zone boundaries, drawn over the plan the way a fire plan draws them.
 *
 * A heavy line around each Auslösezone, interrupted at every door and passage.
 * Deliberately the heaviest thing on the drawing: it is the line the plan is
 * read for, and a fire officer finding it has to be able to follow it across a
 * page without tracing it with a finger.
 *
 * # Thick in PAPER terms, not screen terms
 * Unlike the labels and the device marks, this one scales with the zoom. It
 * describes a boundary in the building, and its weight is a drawing convention
 * measured on the sheet — a line that stayed 4 px wide while the plan zoomed
 * out would swallow the rooms it encloses.
 */

import React from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import type { PlanZoneOutline } from '@/hooks/usePlanZoneOutlines';

export interface PlanZoneOutlinesProps {
  outlines: readonly PlanZoneOutline[];
  /** The transform the canvas paints with — the same one, or the line drifts. */
  transform: { x: number; y: number; scale: number; rotation: number };
}

/**
 * Metres. The drawn weight of a zone boundary, before the zoom is applied.
 *
 * Exported because the GEOMETRY depends on it: the line is drawn inside the
 * compartment it encloses, so the outline is offset inward by half of this and
 * the two numbers have to be the same one.
 */
export const ZONE_LINE_WEIGHT_M = 0.18;
/** Screen pixels the line never goes below, so it survives a zoomed-out plan. */
const MIN_PX = 3;
/** What a zone with no colour of its own is drawn in. */
const FALLBACK = '#dc2626';

function project(
  p: Point2D,
  t: PlanZoneOutlinesProps['transform'],
): { x: number; y: number } {
  const sx = p.x * t.scale;
  const sy = p.y * t.scale;
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  return { x: sx * c - sy * s + t.x, y: sx * s + sy * c + t.y };
}

export function PlanZoneOutlines({
  outlines, transform,
}: PlanZoneOutlinesProps): React.ReactElement | null {
  if (outlines.length === 0) return null;
  const weight = Math.max(MIN_PX, ZONE_LINE_WEIGHT_M * transform.scale);

  return (
    <svg className="absolute inset-0 h-full w-full pointer-events-none" data-plan-zone-outlines>
      {outlines.map((zone) => {
        const colour = zone.colour ?? FALLBACK;
        // One path per zone rather than one per segment: a boundary is one
        // thing, and the DOM ends up with tens of nodes instead of thousands.
        const d = zone.segments.map((seg) => {
          const a = project(seg.a, transform);
          const b = project(seg.b, transform);
          return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
        }).join(' ');

        return (
          <path
            key={zone.zoneId}
            data-zone-outline={zone.zoneId}
            d={d}
            fill="none"
            stroke={colour}
            strokeWidth={weight}
            strokeLinecap="butt"
            opacity={0.85}
          >
            <title>{zone.name || `Zone #${zone.zoneId}`}</title>
          </path>
        );
      })}
    </svg>
  );
}

export default PlanZoneOutlines;
