/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Elementbeispiele tab of the Product Library.
 *
 * Its own file rather than a third block inside `ProductLibraryPanel`: this
 * tab is the only one that talks to the network, and it is the only one with
 * a loading and a failure state. Folding that into the panel would put three
 * unrelated lifecycles in one component.
 *
 * This tab SYNCS and shows; it does not place. Placing happens where every
 * other element is placed — Add element → Library — because it is the same
 * act: pick, resolve a storey from where the cursor falls, snap, drop. A
 * second placement surface here would be two ways to do one thing, differing
 * only in where the geometry came from (Marc, 2026-09-16).
 *
 * A sync is kept between sessions, so the picker never has to reach out to the
 * network while somebody is using it. Only the LIST is stored; an example's
 * IFC file is fetched at placement, which is when its geometry matters.
 *
 * # Two actions, not one
 * Syncing reads the list — a few kilobytes, done often. Preparing the geometry
 * downloads every file and runs it through the geometry pipeline, after which
 * a placed example appears in the scene immediately instead of after an export
 * and reload. The second is slow and deliberate, so it is its own button
 * (Marc, 2026-09-17), and the table says per row which examples are ready.
 */

import { useMemo, useState } from 'react';
import { Box, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useElementExamples } from '@/lib/elementExamples/useElementExamples';
import {
  DEFAULT_ELEMENT_EXAMPLES_URL,
  exampleFileUrl,
} from '@/lib/elementExamples/elementExamples';
import {
  exampleIsPrepared,
  prepareExampleGeometry,
  type PreparationProgress,
} from '@/lib/elementExamples/prepareExampleGeometry';
import { toast } from '@/components/ui/toast';

interface ElementExamplesTabProps {
  /** The dialog being open — what counts as the user asking for the list. */
  open: boolean;
}

export function ElementExamplesTab({ open }: ElementExamplesTabProps) {
  const { catalog, loading, error, load } = useElementExamples(open);
  const entries = catalog?.entries ?? [];

  // The cupboard is module state, not React state, so a counter is what makes
  // the rows re-read it after a run. Cheap, and honest about where the truth
  // lives — see `exampleMeshes.ts`.
  const [preparedAt, setPreparedAt] = useState(0);
  const [progress, setProgress] = useState<PreparationProgress | null>(null);

  async function prepare() {
    if (!catalog) return;
    setProgress({ done: 0, total: catalog.entries.length, current: '' });
    try {
      const result = await prepareExampleGeometry(catalog, setProgress);
      setPreparedAt((n) => n + 1);
      if (result.failures.length === 0) {
        toast.success(`${result.prepared} Beispiele sind bereit.`);
      } else {
        // `error`, not `info`: something the user asked for did not happen,
        // and the names say which. The rest IS prepared — hence the count.
        toast.error(
          `${result.prepared} bereit, ${result.failures.length} nicht: ` +
          result.failures.map((f) => f.name).join(', '),
        );
      }
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;

  // Which examples the cupboard holds. Recomputed after a run and whenever the
  // list changes: the cupboard is module state, so nothing else would tell
  // React that this column has something new to say.
  const prepared = useMemo(() => {
    const source = catalog?.source ?? DEFAULT_ELEMENT_EXAMPLES_URL;
    return new Set(entries.filter((e) => exampleIsPrepared(e, source)).map((e) => e.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `preparedAt` is the signal
  }, [entries, catalog?.source, preparedAt]);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {catalog ? 'Neu synchronisieren' : 'Synchronisieren'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void prepare()}
            disabled={busy || loading || entries.length === 0}
            title="Alle Körper einmal durch die Geometrie-Pipeline — danach erscheint ein platziertes Beispiel sofort in der Szene"
          >
            <Box className={`h-3 w-3 mr-2 ${busy ? 'animate-pulse' : ''}`} />
            Geometrie aufbereiten
          </Button>
          <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
            {busy
              ? `${progress.done}/${progress.total} — ${progress.current}`
              : (
                <>
                  Produktneutral, aus dem Swiss Data Dictionary — platziert wird über
                  <span className="text-zinc-700 dark:text-zinc-300"> Add element → Library</span>.
                </>
              )}
          </span>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          {entries.length} Beispiel{entries.length === 1 ? '' : 'e'}
        </span>
      </div>

      {error && (
        <p className="text-[11px] font-mono text-amber-700 dark:text-amber-500">{error}</p>
      )}

      <ScrollArea className="flex-1 border rounded-sm border-zinc-200 dark:border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono text-[10px] uppercase">Bezeichnung</TableHead>
              <TableHead className="font-mono text-[10px] uppercase">Fachklasse</TableHead>
              <TableHead className="font-mono text-[10px] uppercase" title="Aus wie vielen Körpern das Beispiel aufgebaut ist">Körper</TableHead>
              <TableHead className="font-mono text-[10px] uppercase">Geändert</TableHead>
              <TableHead className="font-mono text-[10px] uppercase">Herausgeber</TableHead>
              <TableHead className="font-mono text-[10px] uppercase">Modell</TableHead>
              <TableHead className="font-mono text-[10px] uppercase" title="Ob die Geometrie aufbereitet ist — ein aufbereitetes Beispiel erscheint beim Platzieren sofort">Szene</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-[11px] font-mono text-zinc-500 py-6">
                  {loading ? 'Wird geladen …' : error ? 'Nichts geladen.' : 'Keine Elementbeispiele.'}
                </TableCell>
              </TableRow>
            )}
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-mono text-xs">{entry.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  {entry.entity}{entry.predefinedType ? `.${entry.predefinedType}` : ''}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{entry.parts}</TableCell>
                <TableCell className="font-mono text-[10px] text-zinc-500">{entry.changed}</TableCell>
                <TableCell className="font-mono text-[10px] text-zinc-500">{entry.organisation}</TableCell>
                <TableCell>
                  {/* The file stays on offer: an example is worth downloading
                      and studying even with no model open. */}
                  <a
                    href={exampleFileUrl(DEFAULT_ELEMENT_EXAMPLES_URL, entry.id)}
                    download
                    className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 dark:text-emerald-500 hover:underline"
                  >
                    <Download className="h-3 w-3" />
                    {entry.id}.ifc
                  </a>
                </TableCell>
                <TableCell className="font-mono text-[10px]">
                  {prepared.has(entry.id)
                    ? <span className="text-emerald-700 dark:text-emerald-500">bereit</span>
                    : <span className="text-zinc-400 dark:text-zinc-600">nicht aufbereitet</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </>
  );
}
