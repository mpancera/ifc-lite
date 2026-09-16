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
 * What it does NOT do yet is place an example. The row therefore offers the
 * file rather than a button that would look like placement and do something
 * lesser — see the note on the download link.
 */

import { Download, RefreshCw } from 'lucide-react';
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

interface ElementExamplesTabProps {
  /** The dialog being open — what counts as the user asking for the list. */
  open: boolean;
}

export function ElementExamplesTab({ open }: ElementExamplesTabProps) {
  const { catalog, loading, error, load } = useElementExamples(open);
  const entries = catalog?.entries ?? [];

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {catalog ? 'Neu laden' : 'Laden'}
          </Button>
          <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
            Produktneutral, aus dem Swiss Data Dictionary.
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-[11px] font-mono text-zinc-500 py-6">
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
                  {/* A link to the file, not a "place" button.
                      Placing an example means copying its real geometry into
                      this model's overlay, which is not built yet. A button
                      that dropped a box of the right size instead would look
                      like it had worked and quietly throw away the modelling
                      the example exists for. Until the real thing is here, the
                      honest offer is the file. */}
                  <a
                    href={exampleFileUrl(DEFAULT_ELEMENT_EXAMPLES_URL, entry.id)}
                    download
                    className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 dark:text-emerald-500 hover:underline"
                  >
                    <Download className="h-3 w-3" />
                    {entry.id}.ifc
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </>
  );
}
