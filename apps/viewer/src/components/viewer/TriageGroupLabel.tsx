/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A group's label, one coloured part per axis, each carrying its provenance.
 *
 * # Why colour
 * `IfcDistributionElement · Starkstrom · Motor` is three words with nothing to
 * say which is the class, which the system and which the author's own name for
 * the thing. In a list of sixty-three rows that has to be re-read every time.
 * Colouring each part to match its axis chip lets the eye do it (Marc,
 * 2026-08-15) — the chips above the list are the legend.
 *
 * # Why the hint
 * "Ich traue der Aussage 'Starkstrom' aber initial noch nicht." Fair: a value
 * is only worth what its source is worth. Hovering a part says which
 * relationship produced it, in the shape the Information panel already uses
 * for relationships — the relation on the left, the class it points at as a
 * badge on the right.
 *
 * The express id of the related entity is deliberately NOT shown. It is not
 * carried through the grouping (a group holds one value for many members, and
 * they can reach it through different `IfcRelAssignsToGroup` instances), and
 * inventing one member's id as if it were the group's would be worse than
 * showing none.
 */

import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AXIS_LABELS, describeAxisSource,
  type ProxyGroup, type ProxyGroupAxis,
} from '@/lib/proxyTriage/proxyGroups';

/**
 * One colour per axis, matching the chips above the list.
 *
 * Foreground only — a background on every part would turn each row into a
 * ransom note. Chosen to stay legible on both themes, so each is a `…-600`
 * with a lighter `dark:` partner rather than a single fixed hue.
 */
const AXIS_COLOUR: Readonly<Record<ProxyGroupAxis, string>> = {
  class: 'text-sky-700 dark:text-sky-400',
  type: 'text-violet-700 dark:text-violet-400',
  system: 'text-emerald-700 dark:text-emerald-400',
  description: 'text-amber-700 dark:text-amber-500',
  name: 'text-pink-700 dark:text-pink-400',
  layer: 'text-teal-700 dark:text-teal-400',
  geometry: 'text-slate-600 dark:text-slate-400',
};

/** The marker `groupProxies` writes where an axis had nothing to say. */
const ABSENT = '—';

export interface TriageGroupLabelProps {
  group: ProxyGroup;
  /** The axes the group was cut by, in the order its values are stored. */
  axes: readonly ProxyGroupAxis[];
}

export function TriageGroupLabel({
  group, axes,
}: TriageGroupLabelProps): React.ReactElement {
  const parts = group.values
    .map((value, index) => ({ value, axis: axes[index] }))
    .filter((part) => part.value !== ABSENT && part.axis !== undefined);

  if (parts.length === 0) {
    return <span className="truncate text-muted-foreground">Ohne Merkmal</span>;
  }

  return (
    <span className="truncate">
      {parts.map((part, index) => (
        <React.Fragment key={part.axis}>
          {index > 0 && <span className="text-muted-foreground"> · </span>}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={AXIS_COLOUR[part.axis]}>{part.value}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {/* The Information panel's relationship shape: what it came
                  through on the left, what it points at as a badge. */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{AXIS_LABELS[part.axis]}</span>
                <span className="font-mono">{describeAxisSource(part.axis)}</span>
                <span className="rounded-sm bg-muted px-1">{part.value}</span>
              </div>
            </TooltipContent>
          </Tooltip>
        </React.Fragment>
      ))}
    </span>
  );
}

export default TriageGroupLabel;
