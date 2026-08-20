/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Exportprodukte — the list of deliverables, and the button that issues them.
 *
 * The panel is deliberately thin: every rule about what a product may be lives
 * in `lib/exportProducts`, and the run itself is driven by `useExportBatch`.
 * What is here is the list, the ordering, and the per-product settings.
 *
 * # Why the order is editable
 * Batch order is issuing order. Somebody who arranged their deliverables the
 * way the submission expects should get that order in the folder, so the list
 * is hand-ordered rather than sorted — sorting would quietly undo that every
 * time a product was renamed.
 */

import { useCallback, useEffect } from 'react';
import {
  PackageCheck, Plus, Trash2, ChevronUp, ChevronDown, Play, AlertTriangle, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { runExportBatch } from '@/lib/exportProducts/runExportBatch';
import {
  FORMATS_BY_KIND, KIND_LABELS, batchProducts, productBlocker, productFilename,
  type ExportFormat, type ExportProduct,
} from '@/lib/exportProducts/exportProducts';

interface ExportProductsPanelProps {
  onClose?: () => void;
}

export function ExportProductsPanel({ onClose }: ExportProductsPanelProps) {
  const products = useViewerStore((s) => s.exportProducts);
  const planProducts = useViewerStore((s) => s.planProducts);
  const run = useViewerStore((s) => s.exportRun);

  const restore = useViewerStore((s) => s.restoreExportProductsForProject);
  const restorePlans = useViewerStore((s) => s.restorePlanProductsForProject);
  const addPlan2D = useViewerStore((s) => s.addPlan2DExportProduct);
  const remove = useViewerStore((s) => s.removeExportProduct);
  const rename = useViewerStore((s) => s.renameExportProduct);
  const setFormat = useViewerStore((s) => s.setExportProductFormat);
  const setInBatch = useViewerStore((s) => s.setExportProductInBatch);
  const move = useViewerStore((s) => s.moveExportProduct);

  // The plan products have to be loaded before the list can name any of them,
  // hence both restores rather than only this panel's own.
  useEffect(() => {
    restorePlans();
    restore();
  }, [restorePlans, restore]);

  const selected = batchProducts(products);
  const running = run.runningProductId !== null;

  /**
   * Issue every selected product.
   *
   * The outcome is surfaced as a toast rather than only in the rows: a batch is
   * something somebody starts and then looks away from, and a run that refused
   * before it began leaves no row marked at all.
   */
  const startBatch = useCallback(async () => {
    const outcome = await runExportBatch(useViewerStore, planProducts);
    if (outcome.refused) {
      toast.error(outcome.refused);
      return;
    }
    const failed = Object.keys(outcome.failures).length;
    if (failed === 0) toast.success(`${outcome.written.length} Produkte ausgegeben`);
    else toast.error(`${outcome.written.length} ausgegeben, ${failed} nicht — siehe Liste`);
  }, [planProducts]);

  const addFromPlan = useCallback((planProductId: string) => {
    addPlan2D(planProductId);
  }, [addPlan2D]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <PackageCheck className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">Exportprodukte</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {selected.length} von {products.length} im Stapel
        </span>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Select onValueChange={addFromPlan} value="">
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="Planprodukt hinzufügen…" />
          </SelectTrigger>
          <SelectContent>
            {planProducts.map((plan) => (
              <SelectItem key={plan.id} value={plan.id} className="text-xs">
                <Plus className="mr-1 inline h-3 w-3" />
                {plan.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1">
        {products.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Noch keine Exportprodukte. Oben ein Planprodukt hinzufügen —
            daraus wird ein Blatt, das der Stapel ausgibt.
          </p>
        ) : (
          <ul className="divide-y">
            {products.map((product, index) => (
              <ProductRow
                key={product.id}
                product={product}
                blocker={productBlocker(product, planProducts)}
                isFirst={index === 0}
                isLast={index === products.length - 1}
                disabled={running}
                failure={run.failures[product.id]}
                onRename={(name) => rename(product.id, name)}
                onFormat={(format) => setFormat(product.id, format)}
                onInBatch={(inBatch) => setInBatch(product.id, inBatch)}
                onMove={(direction) => move(product.id, direction)}
                onRemove={() => remove(product.id)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>

      <footer className="border-t px-3 py-2">
        {running && (
          <p className="mb-2 text-xs text-muted-foreground">
            Exportiert… {run.done} von {run.total}
          </p>
        )}
        <Button
          className="w-full"
          size="sm"
          disabled={running || selected.length === 0}
          onClick={() => { void startBatch(); }}
        >
          <Play className="mr-1 h-3.5 w-3.5" />
          Stapel exportieren ({selected.length})
        </Button>
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          Der Grundriss zeichnet jedes Blatt einzeln — die Ansicht wandert dabei mit.
        </p>
      </footer>
    </div>
  );
}

interface ProductRowProps {
  product: ExportProduct;
  blocker: string | null;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  failure: string | undefined;
  onRename: (name: string) => void;
  onFormat: (format: ExportFormat) => void;
  onInBatch: (inBatch: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function ProductRow({
  product, blocker, isFirst, isLast, disabled, failure,
  onRename, onFormat, onInBatch, onMove, onRemove,
}: ProductRowProps) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 shrink-0"
          checked={product.inBatch}
          disabled={disabled || blocker !== null}
          onChange={(event) => onInBatch(event.target.checked)}
          aria-label={`${product.name} in den Stapel`}
        />
        <Input
          className="h-7 flex-1 text-xs"
          defaultValue={product.name}
          disabled={disabled}
          onBlur={(event) => onRename(event.target.value)}
        />
        <Select
          value={product.format}
          disabled={disabled}
          onValueChange={(value) => onFormat(value as ExportFormat)}
        >
          <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FORMATS_BY_KIND[product.kind].map((format) => (
              <SelectItem key={format} value={format} className="text-xs">
                {format.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-1 flex items-center gap-1 pl-6">
        <span className="text-[10px] text-muted-foreground">
          {KIND_LABELS[product.kind]} · {productFilename(product)}.{product.format}
        </span>
        <div className="ml-auto flex items-center">
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            disabled={disabled || isFirst} onClick={() => onMove(-1)}
            title="Nach oben"
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            disabled={disabled || isLast} onClick={() => onMove(1)}
            title="Nach unten"
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            disabled={disabled} onClick={onRemove}
            title="Entfernen"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {(blocker || failure) && (
        <p className="mt-1 flex items-start gap-1 pl-6 text-[10px] text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          {failure ?? blocker}
        </p>
      )}
    </li>
  );
}
