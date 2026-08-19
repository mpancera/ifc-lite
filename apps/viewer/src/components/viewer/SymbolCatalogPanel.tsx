/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Syncing the symbol catalogue, from the Settings group.
 *
 * The sibling of `ClassCatalogPanel`, and deliberately shows more than it
 * does. That catalogue is either synced or not; this one is expected to be
 * INCOMPLETE for a while — the list of what needs a symbol is written before
 * the symbols are drawn — so the panel reports three different states that a
 * bare count would blur into one:
 *
 * - entries with a drawing, which is what the plan can actually place,
 * - entries still waiting to be drawn, which is the drawing work outstanding,
 * - drawings that were named but did not arrive or were refused, which is a
 *   fault at the source and the only one of the three that is a problem.
 *
 * A symbol quietly missing from a fire plan is exactly the kind of absence
 * nobody notices until somebody needs it, which is why the last group is
 * listed by name rather than counted.
 */

import React, { useState } from 'react';
import { RefreshCw, Shapes, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  useSymbolCatalog, syncSymbolCatalog, type RejectedSymbol,
} from '@/lib/symbolCatalog/useSymbolCatalog';
import {
  DEFAULT_SYMBOL_CATALOG_URL, symbolCatalogCoverage,
} from '@/lib/symbolCatalog/symbolCatalog';

export interface SymbolCatalogPanelProps {
  trigger: React.ReactNode;
}

export function SymbolCatalogPanel({ trigger }: SymbolCatalogPanelProps): React.ReactElement {
  const catalog = useSymbolCatalog();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rejected, setRejected] = useState<readonly RejectedSymbol[]>([]);

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    setRejected([]);
    const result = await syncSymbolCatalog();
    setBusy(false);
    if (result.ok) {
      setMessage(`${result.count} Einträge, ${result.drawings} Zeichnungen übernommen.`);
      setRejected(result.rejected ?? []);
    } else {
      setMessage(result.error ?? 'Der Abgleich schlug fehl.');
    }
  };

  const coverage = catalog ? symbolCatalogCoverage(catalog) : null;

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md text-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Shapes className="h-4 w-4 text-muted-foreground" />
            Symbolkatalog
          </DialogTitle>
          <DialogDescription className="text-xs leading-tight">
            Welches Plansymbol eine Fachklasse bekommt. Liegt beim Objektkatalog
            und wird nur abgeglichen, wenn Sie es hier verlangen.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-2 rounded-sm border bg-muted/40 px-2 py-1.5">
          {catalog && coverage ? (
            <>
              <div className="tabular-nums">
                {coverage.withSymbol} von {coverage.entries} Fachklassen gezeichnet
              </div>
              {coverage.withoutSymbol > 0 && (
                <div className="text-muted-foreground">
                  {coverage.withoutSymbol} warten noch auf eine Zeichnung
                </div>
              )}
              <div className="text-muted-foreground">
                Stand {new Date(catalog.fetchedAt).toLocaleString('de-CH')}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">Noch kein Symbolkatalog abgeglichen.</div>
          )}
        </div>

        {/* Named rather than counted: this is the group that means something
            is wrong at the source, and a number would not say which symbol. */}
        {coverage && coverage.missingDrawings.length > 0 && (
          <p className="mb-2 flex items-start gap-1 text-[10px] leading-tight text-amber-600 dark:text-amber-500">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span>
              Zeichnung fehlt: {coverage.missingDrawings.join(', ')}
            </span>
          </p>
        )}

        <Button size="sm" className="w-full h-7 text-xs" onClick={() => void sync()} disabled={busy}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {catalog ? 'Erneut abgleichen' : 'Katalog abgleichen'}
        </Button>

        {message && <p className="mt-1.5 leading-tight">{message}</p>}

        {rejected.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[10px] leading-tight text-amber-600 dark:text-amber-500">
            {rejected.map((entry) => (
              <li key={entry.symbol}>
                <span className="font-medium">{entry.symbol}</span>: {entry.reason}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 break-all text-[10px] leading-tight text-muted-foreground">
          {DEFAULT_SYMBOL_CATALOG_URL}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default SymbolCatalogPanel;
