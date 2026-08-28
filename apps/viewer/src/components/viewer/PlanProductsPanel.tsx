/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What each plan product means — the reference, not the editor.
 *
 * Read-only on purpose, and the same shape as `RelationKindsPanel`: a table one
 * consults once to answer "what does this product actually decide", away from
 * the drawing.
 *
 * # Why the editing is NOT here
 * Everything in this table that shows on the drawing gets set ON the drawing,
 * and saved into the product from there. A second place to set the same switch
 * is a second truth, and the first question it produces has no good answer:
 * you turn the room numbers off in the strip while a product is active — did
 * you change the product, or only this session, and what does the export do?
 *
 * That confusion already cost a day: the product was reachable only from the
 * export batch, so the sheet that came out and the plan on screen disagreed.
 * This panel is the cure for the other half of it — being able to SEE what a
 * product settles, without having to read the source.
 *
 * # What this table cannot show yet
 * The classes column lists what the product WOULD draw. `productDrawsClass()`
 * exists, is tested, and is called by nobody: the 2D derivation still draws
 * whatever the storey holds. So the column is an announcement, and it says so
 * rather than implying a filter that is not running.
 */

import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useViewerStore } from '@/store';
import { ZONE_THEMES } from '@/lib/ifcZones/themes';

interface PlanProductsPanelProps {
  trigger?: React.ReactNode;
}

/** Theme ids are internal; the table shows what a reader would call them. */
function themeLabels(ids: readonly string[]): string {
  if (ids.length === 0) return '—';
  return ids
    .map((id) => ZONE_THEMES.find((theme) => theme.id === id)?.label ?? id)
    .join(', ');
}

/** The products carry the EXPRESS spelling, so this only has to join them. */
function entityLabels(names: readonly string[]): string {
  return names.length === 0 ? '—' : names.join(', ');
}

export function PlanProductsPanel({ trigger }: PlanProductsPanelProps) {
  const [open, setOpen] = useState(false);
  const products = useViewerStore((s) => s.planProducts);
  const activeId = useViewerStore((s) => s.activePlanProductId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <ClipboardList className="h-4 w-4 mr-2" />
            Planprodukte
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Planprodukte</DialogTitle>
          <DialogDescription>
            Ein Planprodukt ist <strong>eine Zeichnung</strong> — nicht eine Einstellung der
            immer gleichen. Aus einem Modell entstehen mehrere Dokumente, die ein Leser als
            verschiedene Unterlagen erkennt, und das Produkt hält fest, was jedes zeigt und
            mit welchen Zeichen. Gewählt wird es oben in der 2D-Leiste; hier steht nur, was
            die Wahl bedeutet.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Produkt</th>
                <th className="py-1.5 pr-3 font-medium">Symbolsatz</th>
                <th className="py-1.5 pr-3 font-medium">Zonen</th>
                <th className="py-1.5 font-medium">Bauteile</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-border/50 align-top">
                  <td className="py-2 pr-3">
                    <div className={product.id === activeId ? 'font-medium' : ''}>
                      {product.name}
                      {product.id === activeId && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">(aktiv)</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{product.purpose}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {product.builtIn ? 'mitgeliefert' : 'eigenes Produkt'}
                    </div>
                  </td>
                  {/* The one column no switch on the drawing can set: which
                      body's symbols are the correct ones for this document. */}
                  <td className="py-2 pr-3">{product.symbolSet ?? '—'}</td>
                  <td className="py-2 pr-3">{themeLabels(product.zoneThemes)}</td>
                  <td className="py-2">{entityLabels(product.classes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          <strong>Bauteile wirken noch nicht.</strong> Die Spalte sagt, was das Produkt zeichnen
          soll; die 2D-Ableitung zeichnet zurzeit noch alles, was im Geschoss steht. Zonen und
          Symbolsatz wirken bereits.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default PlanProductsPanel;
