/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which drawing the plan on screen is — the plan product, picked in the strip.
 *
 * # Why this had to exist
 * Plan products already decided what a drawing shows: which zone themes, which
 * classes, and since the association symbols arrived, which SYMBOL SET. But
 * nothing on the plan let you choose one. The only way in was the export
 * batch, so the choice took effect on the exported sheet and the screen kept
 * showing something else — the drawing you were working on was never the
 * drawing you were producing.
 *
 * # Why it is a product and not a set of switches
 * The strip is full of switches: room labels, device marks, zone outlines. A
 * product is the thing ABOVE them — one named intent that settles a dozen
 * questions at once, including ones no switch offers (which of two prescribed
 * symbol sets is correct here). Two drawings of one model, not one drawing with
 * remembered toggles; `planProducts.ts` argues that at length.
 *
 * # Why "no product" stays available
 * It is the state every plan was in before products existed, and it still means
 * something: show what the model has, unfiltered by anyone's document. Removing
 * it would force a person opening a file to first declare what they are
 * drawing, which is backwards — you look first.
 */

import React from 'react';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { findProduct } from '@/lib/planProducts/planProducts';

export function PlanProductMenu(): React.ReactElement {
  const products = useViewerStore((s) => s.planProducts);
  const activeId = useViewerStore((s) => s.activePlanProductId);
  const setActive = useViewerStore((s) => s.setActivePlanProduct);
  const active = findProduct(products, activeId);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 max-w-[11rem] gap-1 px-1.5 text-[11px] font-normal"
            >
              <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className={`truncate ${active ? '' : 'text-muted-foreground'}`}>
                {active ? active.name : 'Ohne Planprodukt'}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {active
            ? `${active.purpose} Bestimmt, welche Zonen und Bauteile gezeichnet werden — und welchen Symbolsatz sie tragen.`
            : 'Welche Zeichnung dieser Plan ist. Ein Planprodukt bestimmt, welche Zonen und '
              + 'Bauteile gezeichnet werden und welchen Symbolsatz sie tragen — auf dem Werkplan '
              + 'die Zeichen des Verbands, auf dem Behördenplan die der VKF.'}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-w-xs">
        {products.map((product) => (
          <DropdownMenuItem
            key={product.id}
            onClick={() => setActive(product.id)}
            className="flex-col items-start gap-0 text-xs"
          >
            <span className={product.id === activeId ? 'font-medium' : ''}>{product.name}</span>
            {/* The purpose line, not just the name: two Werkpläne differ by
                what they are for, and the name alone does not say it. */}
            <span className="text-[10px] text-muted-foreground">{product.purpose}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setActive(null)} className="text-xs">
          <span className={activeId === null ? 'font-medium' : ''}>Ohne Planprodukt</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default PlanProductMenu;
