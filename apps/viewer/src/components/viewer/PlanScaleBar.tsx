/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * How long a metre is, in the corner the building's scale bar has (Marc,
 * 2026-08-13).
 *
 * # Why a bar and not a percentage
 * The tool strip says "142 %", which describes the window and not the drawing.
 * A plan is read at a scale, and until plan mode has a real one (#50, later
 * item) a bar is the honest stand-in: it makes no claim about paper, and it
 * stays true however the plan is zoomed, turned or exported.
 *
 * The bar stands for a round number — 1, 2, 5, 10 m and so on — and is drawn
 * however long that comes out. Fixing the bar and printing whatever odd length
 * it happened to represent would be a ruler with a label, not a scale bar.
 *
 * # Why it does not turn with the plan
 * A length is the same in every direction, so the bar has nothing to say about
 * orientation — that is the north arrow's job in the opposite corner. Turning
 * it would only make it harder to read.
 */

import React from 'react';
import { niceScaleBarLength, formatScaleBarLength } from '@/lib/plan/planChrome';

export interface PlanScaleBarProps {
  /** Screen pixels per drawing metre — the plan's zoom. */
  pixelsPerMetre: number;
}

/** The bar may grow to about this, matching the 3D viewport's `w-24` bar. */
const MAX_PIXELS = 120;

export function PlanScaleBar({ pixelsPerMetre }: PlanScaleBarProps): React.ReactElement | null {
  const bar = niceScaleBarLength(pixelsPerMetre, MAX_PIXELS);
  if (!bar) return null;

  // A bar that overflowed its corner would be worse than none; at that zoom
  // the label alone still answers the question.
  const width = Math.min(bar.pixels, MAX_PIXELS);

  return (
    <div className="absolute bottom-4 left-4 flex flex-col items-start gap-1 pointer-events-none"
         data-plan-scale-bar={bar.metres}>
      <div className="flex items-end gap-0" style={{ width }}>
        {/* End ticks and the run between them: the shape a scale bar has on
            every drawing, so it is recognised before it is read. */}
        <div className="h-2 w-px bg-foreground/80" />
        <div className="h-px flex-1 bg-foreground/80" />
        <div className="h-2 w-px bg-foreground/80" />
      </div>
      <span className="text-xs tabular-nums text-foreground/80">
        {formatScaleBarLength(bar.metres)}
      </span>
    </div>
  );
}

export default PlanScaleBar;
