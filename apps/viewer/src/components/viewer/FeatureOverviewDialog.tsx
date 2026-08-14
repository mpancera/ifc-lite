/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Funktionsübersicht — die Antwort auf „was kann das hier eigentlich, und
 * was davon ist nicht die Originalanwendung?“.
 *
 * Erreichbar über die Statusleiste unten rechts, also von überall und ohne
 * ein Ribbon-Register zu treffen: die Frage stellt sich meistens, bevor man
 * weiss, in welchem Register man suchen müsste.
 *
 * Der Herkunftsfilter ist der eigentliche Zweck des Dialogs. Wer sich in
 * IFClite auskennt, will die Ergänzungen sehen; wer diese Installation neu
 * bekommt, will alles sehen und trotzdem wissen, was er anderswo
 * wiederfindet. Inhalt kommt aus `lib/features/catalog.ts`.
 */

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FEATURE_SECTIONS,
  ORIGIN_LABEL,
  countByOrigin,
  type FeatureEntry,
  type FeatureOrigin,
} from '@/lib/features/catalog';

type OriginFilter = FeatureOrigin | 'all';

interface FeatureOverviewDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Herkunftsmarke. Feste Breite, damit die Namen daneben eine Spalte bilden. */
function OriginTag({ origin }: { origin: FeatureOrigin }) {
  return (
    <span
      className={
        origin === 'ifcedit'
          ? 'mt-0.5 w-[52px] shrink-0 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1 py-px text-center font-mono text-[9px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400'
          : 'mt-0.5 w-[52px] shrink-0 rounded-sm border border-zinc-300 px-1 py-px text-center font-mono text-[9px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-500'
      }
    >
      {ORIGIN_LABEL[origin]}
    </span>
  );
}

function FeatureRow({ entry }: { entry: FeatureEntry }) {
  return (
    <div className="flex gap-2.5 py-1.5">
      <OriginTag origin={entry.origin} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium leading-snug">{entry.name}</span>
          {entry.where && (
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
              {entry.where}
            </span>
          )}
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{entry.what}</p>
      </div>
    </div>
  );
}

export function FeatureOverviewDialog({ open, onClose }: FeatureOverviewDialogProps) {
  const [filter, setFilter] = useState<OriginFilter>('all');
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return FEATURE_SECTIONS.map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => {
        if (filter !== 'all' && entry.origin !== filter) return false;
        if (!needle) return true;
        return (
          entry.name.toLowerCase().includes(needle) ||
          entry.what.toLowerCase().includes(needle) ||
          (entry.where?.toLowerCase().includes(needle) ?? false)
        );
      }),
    })).filter((section) => section.entries.length > 0);
  }, [filter, query]);

  const shown = sections.reduce((n, section) => n + section.entries.length, 0);

  const tabs: { id: OriginFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Alle', count: countByOrigin('ifclite') + countByOrigin('ifcedit') },
    { id: 'ifclite', label: 'IFClite', count: countByOrigin('ifclite') },
    { id: 'ifcedit', label: 'IFCedit', count: countByOrigin('ifcedit') },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
          <DialogTitle>Funktionsübersicht</DialogTitle>
          <DialogDescription>
            Diese Anwendung ist ein Fork von IFClite. <strong>IFClite</strong> ist die
            Originalanwendung, <strong>IFCedit</strong> steht für alles, was hier dazugekommen
            ist. Die ausführliche Fassung steht in EXTENSION.md im Repository.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-6 py-3">
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={
                  filter === tab.id
                    ? 'rounded-sm bg-primary px-2.5 py-1 font-mono text-[11px] text-primary-foreground'
                    : 'rounded-sm px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted'
                }
              >
                {tab.label}
                <span className="ml-1.5 opacity-60">{tab.count}</span>
              </button>
            ))}
          </div>

          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suchen — Name, Beschreibung, Ort im Menü"
              className="h-8 w-full rounded-md border bg-transparent pl-7 pr-7 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Suche zurücksetzen"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Natives Scrollen statt `ScrollArea`: dessen Viewport rechnet mit
            `height: 100%`, und die Höhe des Elternteils kommt hier aus Flex
            und nicht aus `height` — die Prozentangabe löst also nicht auf,
            die Liste wächst über den Dialog hinaus und wird abgeschnitten.
            `min-h-0` gehört dazu, sonst schrumpft das Flex-Element gar nicht
            erst unter seine Inhaltshöhe. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 px-6 py-4">
            {sections.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nichts gefunden für „{query}“.
              </p>
            ) : (
              sections.map((section) => (
                <section key={section.id}>
                  <h3 className="text-[13px] font-semibold">{section.title}</h3>
                  <p className="mb-1.5 text-xs text-muted-foreground">{section.intro}</p>
                  <div className="divide-y divide-border/50 border-t border-border/50">
                    {section.entries.map((entry) => (
                      <FeatureRow key={`${section.id}-${entry.name}`} entry={entry} />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>

        <div className="shrink-0 border-t px-6 py-2 text-[11px] text-muted-foreground">
          {shown} von {tabs[0].count} Funktionen · IFClite von{' '}
          <a
            href="https://github.com/LTplus-AG/ifc-lite"
            target="_blank"
            rel="noopener noreferrer"
            className="underline transition-colors hover:text-foreground"
          >
            LTplus-AG/ifc-lite
          </a>
          , MPL-2.0
        </div>
      </DialogContent>
    </Dialog>
  );
}
