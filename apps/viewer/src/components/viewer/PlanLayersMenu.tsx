/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One menu for everything the plan DRAWS on top of the cut.
 *
 * # Why a menu and not six buttons
 * Each layer had its own icon in the strip, and the strip is also where the
 * mode switch, the drawing settings, the DXF underlays and every annotation
 * tool live. Six pictograms in a row say nothing about what they are until
 * each is hovered, and the row grows with every layer the plan learns to
 * derive. A list says the names out loud, and an eye is the one symbol
 * everybody already reads as "shown / hidden".
 *
 * # Counts belong on the rows
 * "Türnummern" tells you what it is; "Türnummern 34" tells you whether turning
 * it on will do anything. A layer with nothing to show is disabled and says so
 * rather than silently doing nothing when clicked — "no rooms on this floor"
 * is itself an answer somebody is looking for.
 */

import React from 'react';
import { Eye, EyeOff, Layers } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToolStripButton } from './ViewportToolStrip';

export interface PlanLayer {
  id: string;
  /** What it is called on the drawing, in the reader's words. */
  label: string;
  /** How many of them the current storey has. `null` when counting makes no sense. */
  count: number | null;
  visible: boolean;
  onToggle: () => void;
  /** Why it cannot be shown, when it cannot. */
  unavailable?: string;
}

export interface PlanLayersMenuProps {
  layers: readonly PlanLayer[];
  /** Rendered under the list — the assumptions a layer had to make. */
  notes?: React.ReactNode;
}

export function PlanLayersMenu({ layers, notes }: PlanLayersMenuProps): React.ReactElement {
  const hidden = layers.filter((l) => !l.visible && !l.unavailable).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolStripButton
          active={hidden > 0}
          title={
            hidden === 0
              ? '2D-Elemente — Beschriftungen und Symbole ein- und ausblenden'
              : `2D-Elemente — ${hidden} ${hidden === 1 ? 'Ebene ist' : 'Ebenen sind'} ausgeblendet`
          }
          data-testid="plan-layers-menu"
        >
          <Layers className="h-4 w-4" />
        </ToolStripButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs">Abgeleitete 2D-Elemente</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {layers.map((layer) => (
          <DropdownMenuItem
            key={layer.id}
            disabled={!!layer.unavailable}
            // The menu stays open: turning three layers off is one trip, not
            // three, and the drawing behind it updates as each one flips.
            onSelect={(event) => { event.preventDefault(); layer.onToggle(); }}
            className="gap-2 text-xs"
            title={layer.unavailable}
          >
            {layer.visible && !layer.unavailable
              ? <Eye className="h-3.5 w-3.5 shrink-0" />
              : <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className={`flex-1 truncate ${layer.visible && !layer.unavailable ? '' : 'text-muted-foreground'}`}>
              {layer.label}
            </span>
            {layer.count !== null && (
              <span className="tabular-nums text-[11px] text-muted-foreground">{layer.count}</span>
            )}
          </DropdownMenuItem>
        ))}
        {notes && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">{notes}</div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
