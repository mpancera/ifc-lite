/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Syncing the Fachklassen catalogue, from the Settings group.
 *
 * A button and a date, because that is the whole feature: the catalogue is
 * fetched when somebody asks for it and kept until they ask again (Marc,
 * 2026-08-13). Letting the user point at a different catalogue is deliberately
 * absent — parked until the one that exists has earned a second.
 */

import React, { useState } from 'react';
import { RefreshCw, BookMarked } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useClassCatalog, syncClassCatalog } from '@/lib/classCatalog/useClassCatalog';
import { DEFAULT_CLASS_CATALOG_URL } from '@/lib/classCatalog/classCatalog';

export interface ClassCatalogPanelProps {
  trigger: React.ReactNode;
}

export function ClassCatalogPanel({ trigger }: ClassCatalogPanelProps): React.ReactElement {
  const catalog = useClassCatalog();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    const result = await syncClassCatalog();
    setBusy(false);
    setMessage(result.ok
      ? `${result.count} Fachklassen übernommen.`
      : result.error ?? 'Der Abgleich schlug fehl.');
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md text-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <BookMarked className="h-4 w-4 text-muted-foreground" />
            Objektkatalog
          </DialogTitle>
          <DialogDescription className="text-xs leading-tight">
            Die Liste der Fachklassen — IFC-Entity mit PredefinedType — aus der
            ein Element seine Klasse bekommt. Wird nur abgeglichen, wenn Sie es
            hier verlangen.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-2 rounded-sm border bg-muted/40 px-2 py-1.5">
          {catalog ? (
            <>
              <div className="tabular-nums">{catalog.entries.length} Fachklassen</div>
              <div className="text-muted-foreground">
                Stand {new Date(catalog.fetchedAt).toLocaleString('de-CH')}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">Noch kein Katalog abgeglichen.</div>
          )}
        </div>

        <Button size="sm" className="w-full h-7 text-xs" onClick={() => void sync()} disabled={busy}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {catalog ? 'Erneut abgleichen' : 'Katalog abgleichen'}
        </Button>

        {message && <p className="mt-1.5 leading-tight">{message}</p>}

        <p className="mt-2 break-all text-[10px] leading-tight text-muted-foreground">
          {DEFAULT_CLASS_CATALOG_URL}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default ClassCatalogPanel;
