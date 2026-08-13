/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Door swings and window sashes, drawn over the plan.
 *
 * Unlike the room labels these are real geometry at real size, so they turn
 * WITH the plan and grow with the zoom — a swing arc that stayed the same size
 * on screen would stop describing the space the door needs, which is the whole
 * reason to draw it.
 *
 * An overlay rather than part of the generated drawing, for one reason: the
 * drawing generator is shared with the 2D Section tool, and a swing arc is a
 * plan convention that means nothing on a vertical section. Keeping it here
 * means plan mode gains the symbols without teaching the shared renderer a
 * rule it would have to be talked out of again.
 */

import React from 'react';
import type { PlanOpeningSymbol } from '@/hooks/usePlanOpeningSymbols';

export interface PlanOpeningSymbolsProps {
  symbols: readonly PlanOpeningSymbol[];
  /** The transform the canvas paints with — the same one, or the symbols drift. */
  transform: { x: number; y: number; scale: number; rotation: number };
}

export function PlanOpeningSymbols({
  symbols, transform,
}: PlanOpeningSymbolsProps): React.ReactElement | null {
  if (symbols.length === 0) return null;

  const { x: tx, y: ty, scale, rotation } = transform;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const toScreen = (p: { x: number; y: number }) => {
    const sx = p.x * scale;
    const sy = p.y * scale;
    return { x: sx * cos - sy * sin + tx, y: sx * sin + sy * cos + ty };
  };

  return (
    <svg className="absolute inset-0 h-full w-full pointer-events-none" data-plan-opening-symbols>
      {symbols.map((symbol) => {
        let d = '';
        for (const line of symbol.lines) {
          const a = toScreen(line.start);
          const b = toScreen(line.end);
          d += `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)} `;
        }
        if (!d) return null;
        return (
          <path
            key={symbol.expressId}
            data-plan-opening-symbol={symbol.expressId}
            data-opening-kind={symbol.kind}
            d={d}
            fill="none"
            strokeWidth={1}
            // The 2D drafting look: thin, dark, no colour of its own. A symbol
            // in an accent colour reads as interface rather than as drawing.
            className="stroke-zinc-700 dark:stroke-zinc-300"
          >
            {/* What the model actually said — a swing that looks wrong should
                be checkable without opening the properties panel. */}
            <title>
              {symbol.kind === 'door'
                ? `Tür #${symbol.expressId} — ${symbol.operationType ?? 'ohne OperationType'}`
                : `Fenster #${symbol.expressId}`}
            </title>
          </path>
        );
      })}
    </svg>
  );
}

export default PlanOpeningSymbols;
