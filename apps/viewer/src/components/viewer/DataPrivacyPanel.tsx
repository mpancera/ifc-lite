/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which third parties this app may contact, one switch per source.
 *
 * It was one switch for all of them. That made the decision coarser than the
 * facts: asking `epsg.io` what a coordinate system is discloses a region,
 * while the elevation endpoint is sent the building's exact position. Under
 * one switch the careful answer to the second is also the answer to the
 * first, so the app loses features it could have had.
 *
 * The master switch stays, because "block everything" has to be one action
 * and because it is the honest summary line. The rows beneath it are the
 * actual decision.
 */

import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, MapPin } from 'lucide-react';
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
  EXTERNAL_SOURCES,
  externalRequestsAllowed,
  setExternalRequestAllowed,
  setExternalRequestsAllowed,
  type ExternalSource,
} from '@/lib/privacy/externalRequests';

interface DataPrivacyPanelProps {
  trigger?: React.ReactNode;
}

/** Read every source once, so the rows and the summary cannot disagree. */
function readAll(): Record<ExternalSource, boolean> {
  const state = {} as Record<ExternalSource, boolean>;
  for (const source of EXTERNAL_SOURCES) state[source.id] = externalRequestsAllowed(source.id);
  return state;
}

export function DataPrivacyPanel({ trigger }: DataPrivacyPanelProps) {
  const [open, setOpen] = useState(false);
  // Re-read on open rather than only on mount: the location map has its own
  // "show the map" button that writes the same storage, and a panel opened
  // afterwards must not show the state from before.
  const [allowedBySource, setAllowedBySource] = useState(readAll);

  const allowedCount = EXTERNAL_SOURCES.filter((source) => allowedBySource[source.id]).length;
  const allOn = allowedCount === EXTERNAL_SOURCES.length;

  const toggleOne = (source: ExternalSource, next: boolean) => {
    setExternalRequestAllowed(source, next);
    setAllowedBySource((prev) => ({ ...prev, [source]: next }));
  };

  const toggleAll = (next: boolean) => {
    setExternalRequestsAllowed(next);
    setAllowedBySource(readAll());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setAllowedBySource(readAll());
        setOpen(next);
      }}
    >
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
            {allowedCount > 0
              ? <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              : <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-zinc-900 dark:text-zinc-100">
                {allowedCount === 0
                  ? 'Alle externen Anfragen blockiert'
                  : `${allowedCount} von ${EXTERNAL_SOURCES.length} Quellen erlaubt`}
              </p>
              <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                {allowedCount === 0
                  ? 'Es wird ausschliesslich der eigene Server kontaktiert. Die betroffenen Funktionen bleiben still.'
                  : 'Der Schalter hier schaltet alle auf einmal; einzeln entscheiden ist unten.'}
              </p>
            </div>
            <Switch
              checked={allOn}
              onCheckedChange={toggleAll}
              aria-label="Alle Quellen erlauben oder blockieren"
            />
          </div>

          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-1.5">
              Quellen einzeln
            </p>
            <div className="space-y-1">
              {EXTERNAL_SOURCES.map((source) => (
                <div
                  key={source.id}
                  className="flex items-start gap-3 rounded-sm border border-zinc-200/70 dark:border-zinc-800/70 px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[12px] text-zinc-900 dark:text-zinc-100">
                      {source.label}
                      {source.discloses === 'position' && (
                        // The three that send the site itself are the ones
                        // worth pausing over, and the mark says so without
                        // making the reader parse the sentence below.
                        <span
                          className="inline-flex items-center gap-0.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 text-[9px] leading-4 text-amber-700 dark:text-amber-300"
                          title="Diese Anfrage enthält die Position des Gebäudes"
                        >
                          <MapPin className="h-2.5 w-2.5" />
                          Position
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                      {source.purpose}
                    </p>
                    <p className="mt-0.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-600">
                      {source.hosts.join(', ')}
                    </p>
                  </div>
                  <Switch
                    className="mt-0.5"
                    checked={allowedBySource[source.id]}
                    onCheckedChange={(next) => toggleOne(source.id, next)}
                    aria-label={`${source.label} erlauben`}
                  />
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 leading-relaxed">
            Die Einstellung gilt für diesen Browser und lässt sich jederzeit zurücknehmen.
            Eine Quelle, die später dazukommt, ist zuerst blockiert — eine frühere
            Zustimmung deckt sie nicht ab.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
