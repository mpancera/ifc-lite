/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Zone boundaries, drawn over the plan the way a fire plan draws them.
 *
 * A heavy line around each zone, interrupted at every door and passage.
 * Deliberately the heaviest thing on the drawing: it is the line the plan is
 * read for, and a fire officer finding it has to be able to follow it across a
 * page without tracing it with a finger.
 *
 * Several layers at once — Brandabschnitt and Meldezone are different lines
 * and both belong on the sheet. Each carries its own weight and sits at its
 * own inset (`lib/zoneOutline/zoneLayers.ts`), so they touch rather than
 * overlap and a compartment that coincides with a detection zone still reads
 * as two boundaries.
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
import {
  trianglesToPathData, ZONE_FILL_OPACITY, ZONE_FILL_RULE,
} from '@/lib/zoneOutline/zoneFill';
import {
  fallbackColourFor, ZONE_FALLBACK_COLOUR, ZONE_LINE_WEIGHT_M,
} from '@/lib/zoneOutline/zoneLayers';

export interface PlanZoneOutlinesProps {
  outlines: readonly PlanZoneOutline[];
  /** The transform the canvas paints with — the same one, or the line drifts. */
  transform: { x: number; y: number; scale: number; rotation: number };
}

/** Screen pixels the line never goes below, so it survives a zoomed-out plan. */
const MIN_PX = 3;

// Re-exported at their old names so the sheet export and everything else that
// already imports them from here keeps working; they live in
// `lib/zoneOutline/zoneLayers.ts` now, beside the stacking rule that depends
// on them.
export { ZONE_LINE_WEIGHT_M, ZONE_FALLBACK_COLOUR };

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

  return (
    <svg className="absolute inset-0 h-full w-full pointer-events-none" data-plan-zone-outlines>
      {outlines.map((zone) => {
        const colour = zone.colour ?? fallbackColourFor(zone.themeId);
        const weight = Math.max(MIN_PX, zone.weightM * transform.scale);
        // One path per zone rather than one per segment: a boundary is one
        // thing, and the DOM ends up with tens of nodes instead of thousands.
        const d = zone.segments.map((seg) => {
          const a = project(seg.a, transform);
          const b = project(seg.b, transform);
          return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
        }).join(' ');

        // The tint first, so the line lies on top of its own zone rather than
        // being half swallowed by it.
        const fill = zone.fills
          .map((triangles) => trianglesToPathData(triangles, (x, y) => {
            const p = project({ x, y }, transform);
            return p;
          }, 1))
          .filter((d) => d.length > 0)
          .join(' ');

        return (
          // Keyed by LAYER as well as zone: the same room grouping can be
          // drawn on two layers, and a bare zone id would collide.
          <React.Fragment key={`${zone.themeId}:${zone.zoneId}`}>
          {fill.length > 0 && (
            <path
              data-zone-fill={zone.zoneId}
              d={fill}
              fill={colour}
              fillOpacity={ZONE_FILL_OPACITY}
              fillRule={ZONE_FILL_RULE}
              stroke="none"
            />
          )}
          <path
            data-zone-outline={zone.zoneId}
            data-zone-theme={zone.themeId}
            d={d}
            fill="none"
            stroke={colour}
            strokeWidth={weight}
            strokeLinecap="butt"
            opacity={0.85}
          >
            <title>{zone.name || `Zone #${zone.zoneId}`}</title>
          </path>
          </React.Fragment>
        );
      })}
    </svg>
  );
}

export default PlanZoneOutlines;
