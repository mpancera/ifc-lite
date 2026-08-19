/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The tool strip that sits along the top edge of a viewport.
 *
 * One home for the chrome, because there are now two of these — the plan's and
 * the building's — and they have to stay identical. The mode switch lives at
 * the left end of both, so that moving between plan and building does not move
 * the control you use to move between plan and building.
 *
 * `pointer-events-none` on the host and `auto` on the strip: the host spans the
 * viewport so the strip can grow along it, and without that split the empty
 * space beside the strip would swallow clicks meant for the model underneath.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface ViewportToolStripProps {
  children: React.ReactNode;
  /**
   * Tailwind inset for the host's right edge.
   *
   * The 3D viewport needs the strip to stop short of the ViewCube, which keeps
   * its corner; the plan has nothing up there to avoid.
   */
  rightInset?: string;
  /** Marks the strip for tests and for the tour anchors. */
  testId?: string;
}

export function ViewportToolStrip({
  children, rightInset = 'right-2', testId,
}: ViewportToolStripProps): React.ReactElement {
  return (
    <div className={`absolute top-2 left-2 ${rightInset} flex items-start gap-2 pointer-events-none`}>
      <div
        className="pointer-events-auto flex flex-wrap items-center gap-0.5 rounded-md border bg-background/95 backdrop-blur-sm px-1.5 py-1 shadow-sm"
        data-viewport-toolstrip={testId}
      >
        {children}
      </div>
    </div>
  );
}

/** The hairline between groups of tools. */
export function ToolStripDivider(): React.ReactElement {
  return <div className="mx-0.5 h-4 w-px bg-border" />;
}

export default ViewportToolStrip;

/**
 * One icon button of a viewport tool strip.
 *
 * Lived privately inside `PlanToolbar` until a second surface — the 2D layer
 * menu — needed its trigger to look like every other button in the strip. Two
 * copies of a button are two buttons that stop matching, so it moved here,
 * where the strip and its divider already live.
 */
export function ToolStripButton({
  active, onClick, title, children, disabled, ...rest
}: {
  active?: boolean;
  onClick?: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
} & React.ComponentPropsWithoutRef<'button'>): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'default' : 'ghost'}
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          aria-pressed={active}
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{title}</TooltipContent>
    </Tooltip>
  );
}
