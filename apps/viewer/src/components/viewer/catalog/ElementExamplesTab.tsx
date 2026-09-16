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
 * Placing copies the example's REAL geometry into the open model — the
 * profiles, booleans and styles somebody modelled, as a representation map on
 * the type and a mapped item per occurrence — together with the companions
 * (clearance, detection area, plan symbol) as their own related products.
 *
 * What it does not do yet is show the result immediately: overlay-created
 * geometry is not re-meshed in session, so a placed example appears after an
 * export and reload. The toast says so rather than leaving the user looking
 * for it.
 */

import { useState } from 'react';
import { Download, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { toast } from '@/components/ui/toast';
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
  type ElementExample,
} from '@/lib/elementExamples/elementExamples';
import { fetchExampleModel } from '@/lib/elementExamples/fetchExampleModel';
import { useViewerStore } from '@/store';

interface ElementExamplesTabProps {
  /** The dialog being open — what counts as the user asking for the list. */
  open: boolean;
  /** Close the dialog once something has been placed. */
  onPlaced?: () => void;
}

export function ElementExamplesTab({ open, onPlaced }: ElementExamplesTabProps) {
  const { catalog, loading, error, load } = useElementExamples(open);
  const entries = catalog?.entries ?? [];

  const activeModelId = useViewerStore((s) => s.activeModelId);
  const models = useViewerStore((s) => s.models);
  const placeElementExample = useViewerStore((s) => s.placeElementExample);
  const [placing, setPlacing] = useState<string | null>(null);

  /**
   * The storey to place into: the first one the model has.
   *
   * A stand-in for a proper pick, and a stated one. Placing by CLICK — the
   * Add-Element flow's `addElementType`, which resolves the storey from where
   * the cursor lands — is the right home for this and needs a place-mode of
   * its own; until then the object lands at the model origin of the first
   * storey, where it can be moved.
   */
  const firstStoreyId = (() => {
    const store = activeModelId ? models.get(activeModelId)?.ifcDataStore : null;
    const storeys = store?.entityIndex.byType.get('IFCBUILDINGSTOREY');
    return storeys?.[0] ?? null;
  })();

  const place = async (entry: ElementExample) => {
    if (!activeModelId || firstStoreyId === null) {
      toast.error('Kein Modell offen, in das platziert werden könnte.');
      return;
    }
    setPlacing(entry.id);
    try {
      const fetched = await fetchExampleModel(
        exampleFileUrl(DEFAULT_ELEMENT_EXAMPLES_URL, entry.id),
      );
      if (!fetched.ok) {
        toast.error(fetched.error);
        return;
      }
      const result = placeElementExample(activeModelId, firstStoreyId, {
        example: fetched.model,
        position: [0, 0, 0],
        exampleId: entry.id,
      });
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      const companions = fetched.model.companions.length;
      toast.success(
        companions > 0
          ? `${entry.name} platziert — mit ${companions} zugehörigen Körper${companions === 1 ? '' : 'n'}. Im Bild sichtbar nach Export und Neuladen.`
          : `${entry.name} platziert. Im Bild sichtbar nach Export und Neuladen.`,
      );
      onPlaced?.();
    } finally {
      setPlacing(null);
    }
  };

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
              <TableHead className="font-mono text-[10px] uppercase"> </TableHead>
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
                  {/* The file stays on offer beside the button: an example is
                      useful to download and study even when there is no model
                      open to place it into. */}
                  <a
                    href={exampleFileUrl(DEFAULT_ELEMENT_EXAMPLES_URL, entry.id)}
                    download
                    className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 dark:text-emerald-500 hover:underline"
                  >
                    <Download className="h-3 w-3" />
                    {entry.id}.ifc
                  </a>
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px] font-mono"
                    disabled={placing !== null || !activeModelId || firstStoreyId === null}
                    onClick={() => void place(entry)}
                  >
                    {placing === entry.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <MapPin className="h-3 w-3 mr-1" />}
                    Platzieren
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </>
  );
}
