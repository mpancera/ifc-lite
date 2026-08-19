/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Says that the model is NOT showing all storeys — and says only that.
 *
 * # A readout, not a control
 * This began as a chip floating in the viewport's top-left corner, with an X
 * to return to Stacked. Two problems, and the second is the reason it moved:
 * it covered the toolbar band underneath it, and it was a second place to
 * switch the level display. The switch belongs to the hierarchy panel, which
 * owns Stacked / Solo / Exploded and is where somebody looking for it goes.
 * Two controls for one state drift; a readout beside the other always-on
 * chrome cannot.
 *
 * # Silent in the normal case
 * Stacked is what a model looks like unless somebody said otherwise, so the
 * indicator renders nothing there. It appears exactly when the view is doing
 * something the user could otherwise forget about — that is the whole job.
 */

import { ChevronsUpDown, SquareStack } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { useFloorplanView } from '@/hooks/useFloorplanView';

export function LevelDisplayIndicator() {
  const mode = useViewerStore((s) => s.levelDisplayMode);
  const explodedGap = useViewerStore((s) => s.explodedGap);
  const activeStorey = useViewerStore((s) => s.activeStorey);
  const { availableStoreys } = useFloorplanView();

  if (mode === 'stacked') return null;

  const Icon = mode === 'exploded' ? ChevronsUpDown : SquareStack;
  const soloName = activeStorey
    ? availableStoreys.find(
      (s) => s.modelId === activeStorey.modelId && s.expressId === activeStorey.expressId,
    )?.name
    : undefined;
  const label = mode === 'exploded'
    ? `Exploded · ${explodedGap} m`
    : `Solo · ${soloName ?? 'Geschoss'}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-level-display-indicator
          className="mr-2 flex items-center gap-1.5 rounded-md border border-purple-300/60 bg-purple-50/60 px-2 py-1 text-xs font-medium text-foreground dark:border-purple-500/40 dark:bg-purple-950/30"
        >
          <Icon className="h-3.5 w-3.5 text-purple-500" />
          <span className="tabular-nums">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Die Darstellung wird links in der Hierarchie umgeschaltet (Stacked / Solo / Exploded).
      </TooltipContent>
    </Tooltip>
  );
}
