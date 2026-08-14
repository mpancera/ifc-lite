/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Doors whose `OperationType` disagrees with their own drawn leaf.
 *
 * The plan already ignores the attribute where a leaf was drawn, so the
 * drawing is right either way. This is not about the drawing — it is about the
 * MODEL. Measured over one real project model, twenty doors marked
 * `SINGLE_SWING_LEFT` were hung eleven one way and nine the other: the
 * attribute is noise, and anything downstream that believes it (a schedule, an
 * escape-route check, another viewer) gets it wrong.
 *
 * # Why this can be corrected here at all
 * Marc's framing: the right fix is the model author's. Where that is no longer
 * possible — a delivered model, a closed project — being able to correct the
 * attribute in place is the difference between knowing it is wrong and having
 * it be right. The correction goes into the authoring overlay as an attribute
 * change, so it survives export.
 *
 * # Why it is a badge and not a panel
 * A data-quality finding that nobody asked for should be visible and quiet. It
 * appears only when there IS a disagreement, states the count, and opens on a
 * click.
 */

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PlanOpeningSymbol } from '@/hooks/usePlanOpeningSymbols';

export interface PlanOperationTypeReportProps {
  /** Every door on the storey, agreeing or not. */
  symbols: readonly PlanOpeningSymbol[];
  /** Write the corrected enum onto one door. */
  onCorrect: (expressId: number, operationType: string) => void;
}

export function PlanOperationTypeReport({
  symbols, onCorrect,
}: PlanOperationTypeReportProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);

  const wrong = symbols.filter((s) => s.attributeAgrees === false && s.correctedOperationType);
  const compared = symbols.filter((s) => s.attributeAgrees !== null);
  if (wrong.length === 0) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="h-6 gap-1 px-1.5 text-[10px] tabular-nums border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          >
            <AlertTriangle className="h-3 w-3" />
            {wrong.length}/{compared.length}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {wrong.length} von {compared.length} vergleichbaren Türen tragen einen
          OperationType, der nicht zu ihrem eigenen gezeichneten Türblatt passt.
          Der Plan folgt der Geometrie — das Modell bleibt falsch, bis es
          korrigiert wird.
        </TooltipContent>
      </Tooltip>

      {open && (
        <div className="absolute left-2 top-12 z-50 w-80 rounded-md border bg-background/95 px-2 py-2 shadow-lg backdrop-blur-sm">
          <p className="mb-1.5 text-[11px] leading-tight text-muted-foreground">
            Der <strong>OperationType</strong> widerspricht dem gezeichneten
            Türblatt. Übernehmen schreibt den Wert, den die Geometrie zeigt —
            die Darstellung ändert sich dadurch nicht, das Modell schon.
          </p>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {wrong.map((door) => (
              <li key={door.key} className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-[11px] hover:bg-muted/60">
                <span className="min-w-0 flex-1 truncate" title={door.name || `#${door.expressId}`}>
                  {door.name || `#${door.expressId}`}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {shortEnum(door.operationType)} → {shortEnum(door.correctedOperationType)}
                </span>
                <Button
                  variant="outline" size="sm" className="h-5 shrink-0 px-1.5 text-[10px]"
                  onClick={() => onCorrect(door.expressId, door.correctedOperationType!)}
                >
                  übernehmen
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex justify-end">
            <Button
              variant="default" size="sm" className="h-6 px-2 text-[10px]"
              onClick={() => {
                for (const door of wrong) onCorrect(door.expressId, door.correctedOperationType!);
              }}
            >
              Alle {wrong.length} übernehmen
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** `SINGLE_SWING_LEFT` → `LEFT`. The prefix is the same on every row. */
function shortEnum(value: string | null): string {
  if (!value) return '—';
  return value.replace(/^SINGLE_SWING_/, '').replace(/^DOUBLE_DOOR_/, '2×');
}

export default PlanOperationTypeReport;
