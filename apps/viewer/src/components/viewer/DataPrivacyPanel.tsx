/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The one switch that decides whether this app may talk to third parties.
 *
 * Several features reach outside the browser as a side effect of being shown —
 * the location map fetches tiles for the building's coordinates, the place
 * search posts the typed query. None of that is obvious from the UI, so the
 * panel names every host and what it would disclose rather than offering a
 * bare toggle.
 */

import { useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  EXTERNAL_ENDPOINTS,
  externalRequestsAllowed,
  setExternalRequestsAllowed,
} from '@/lib/privacy/externalRequests';

interface DataPrivacyPanelProps {
  trigger?: React.ReactNode;
}

export function DataPrivacyPanel({ trigger }: DataPrivacyPanelProps) {
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState(() => externalRequestsAllowed());

  const toggle = (next: boolean) => {
    setExternalRequestsAllowed(next);
    setAllowed(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <ShieldCheck className="h-4 w-4 mr-2" />
            Datenschutz
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Datenschutz</DialogTitle>
          <DialogDescription>
            Geöffnete IFC-Dateien verlassen den Browser grundsätzlich nie — sie werden
            lokal gelesen und dargestellt. Einzelne Funktionen fragen jedoch bei Dritten an.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-sm border border-zinc-200 dark:border-zinc-800 px-3 py-3">
            {allowed
              ? <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              : <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-zinc-900 dark:text-zinc-100">
                Externe Anfragen {allowed ? 'erlaubt' : 'blockiert'}
              </p>
              <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                {allowed
                  ? 'Ortsplan, Ortssuche, Geländehöhe und bSDD-Suche dürfen anfragen.'
                  : 'Es wird ausschliesslich der eigene Server kontaktiert. Die betroffenen Funktionen bleiben still.'}
              </p>
            </div>
            <Switch checked={allowed} onCheckedChange={toggle} />
          </div>

          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-1.5">
              Betroffene Dienste
            </p>
            <div className="space-y-1">
              {EXTERNAL_ENDPOINTS.map((endpoint) => (
                <div key={endpoint.host} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 text-[11px] font-mono">
                  <span className="truncate text-zinc-700 dark:text-zinc-300" title={endpoint.host}>
                    {endpoint.host}
                  </span>
                  <span className="truncate text-zinc-500 dark:text-zinc-400" title={endpoint.purpose}>
                    {endpoint.purpose}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 leading-relaxed">
            Ortsplan und Geländehöhe geben die reale Position des Gebäudes preis — die
            angefragten Kacheln sind die Koordinaten. Die Einstellung gilt für diesen Browser
            und lässt sich jederzeit zurücknehmen.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
