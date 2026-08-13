/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * North, and the tool that turns the plan — in the corner the ViewCube has in
 * 3D (Marc, 2026-08-13).
 *
 * The same corner and the same 60 px box, because it answers the same question
 * in the same place: which way am I looking. A plan has no cube to turn, so
 * the box holds the one orientation a plan has instead, and the controls that
 * set it.
 *
 * # Why the arrow is also the tool
 * The angle and the thing the angle describes belong together. Kept apart —
 * the arrow here, the number in the tool strip — you set a rotation in one
 * corner and check it in another. It also frees the strip, which was carrying
 * three controls for one idea.
 */

import React, { useState } from 'react';
import { Compass, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { northBearingDeg } from '@/lib/plan/planChrome';

export interface PlanNorthArrowProps {
  /** The plan's display angle, in radians. */
  rotation: number;
  /** True while the two-click alignment gesture is armed. */
  picking: boolean;
  onTogglePicking: () => void;
  onSetRotationDeg: (deg: number) => void;
}

/** The ViewCube's box, to the pixel — same corner, same size. */
const BOX = 60;

export function PlanNorthArrow({
  rotation, picking, onTogglePicking, onSetRotationDeg,
}: PlanNorthArrowProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const bearing = northBearingDeg(rotation);
  const turned = Math.abs(bearing) > 0.001 && Math.abs(bearing - 360) > 0.001;

  return (
    <div className="absolute top-6 right-6 flex flex-col items-end gap-1.5" data-plan-north>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`Nordpfeil — Plan um ${bearing.toFixed(1)}° gedreht`}
            className="rounded-md border bg-background/95 backdrop-blur-sm shadow-sm hover:bg-accent/50 transition-colors"
            style={{ width: BOX, height: BOX }}
          >
            <svg viewBox="0 0 60 60" width={BOX} height={BOX} aria-hidden>
              {/* The arrow turns WITH the plan: north was up on an unturned
                  plan, so after turning by θ it sits at bearing θ. SVG rotates
                  clockwise for positive angles, which is the same direction a
                  bearing grows — no sign to get wrong here, only one to state. */}
              <g transform={`rotate(${bearing} 30 30)`}>
                <path d="M30 9 L37 40 L30 35 L23 40 Z"
                      className="fill-zinc-800 dark:fill-zinc-100" />
                <path d="M30 9 L23 40 L30 35 Z"
                      className="fill-zinc-400 dark:fill-zinc-500" />
              </g>
              {/* "N" stays upright while the arrow turns — the same rule the
                  room labels follow. A letter lying on its side is a puzzle. */}
              <text x="30" y="53" textAnchor="middle" fontSize="11" fontWeight="600"
                    className="fill-zinc-700 dark:fill-zinc-300">N</text>
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          {turned ? `Plan um ${bearing.toFixed(1)}° gedreht — zum Einstellen klicken`
            : 'Norden ist oben — zum Drehen klicken'}
        </TooltipContent>
      </Tooltip>

      {open && (
        <div className="rounded-md border bg-background/95 backdrop-blur-sm px-2 py-1.5 shadow-lg flex flex-col gap-1.5 w-44">
          <div className="flex items-center gap-1">
            <input
              type="number"
              step={0.5}
              value={Number.isFinite(bearing) ? Math.round(bearing * 100) / 100 : 0}
              onChange={(e) => {
                const v = Number.parseFloat(e.target.value);
                if (Number.isFinite(v)) onSetRotationDeg(v);
              }}
              className="h-7 w-20 rounded-sm border bg-transparent px-1 text-[11px] tabular-nums"
              aria-label="Drehwinkel der Plandarstellung, in Grad"
            />
            <span className="text-[10px] text-muted-foreground">°</span>
            {turned && (
              // Labelled, not an icon. A counter-clockwise arrow beside a
              // rotation tool reads as another way to rotate, not as the way
              // to stop.
              <Button variant="ghost" size="sm" className="h-7 px-1.5 text-[10px] ml-auto"
                      onClick={() => onSetRotationDeg(0)}>
                0°
              </Button>
            )}
          </div>
          <Button
            variant={picking ? 'default' : 'outline'}
            size="sm"
            className="h-7 justify-start px-2 text-[11px]"
            onClick={onTogglePicking}
          >
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            {picking ? 'Ausrichtlinie ziehen…' : 'An Bauteil ausrichten'}
          </Button>
          <p className="text-[10px] leading-tight text-muted-foreground">
            Eine Linie entlang einem Bauteil ziehen — sie rastet auf die nächste Achse.
          </p>
        </div>
      )}
    </div>
  );
}

export default PlanNorthArrow;
