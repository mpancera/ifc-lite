/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Höhen & Lage — the project's reference height system.
 *
 * The base view Marc asked for: one row per storey with its LEVEL and its
 * HEIGHT, both editable. Named reference heights (OK-Fertigboden, UK-Rohboden)
 * sit behind that, because the everyday question is "how high is this floor",
 * not "what is the offset of the structural slab".
 *
 * Two things this view has to be honest about, and both are easy to fake:
 *
 * - The topmost storey has NO height. Nothing in a storey list says where the
 *   building ends, so the cell shows "—" rather than a number.
 * - Every level says where it came from. A figure read from the model and one
 *   a person typed are not the same claim, and the next re-derivation treats
 *   them differently.
 */

import { useMemo, useState } from 'react';
import { Ruler, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { withStoreyHeights } from '@/lib/heights/derive';
import type { ElevationSource } from '@/lib/heights/types';

/** Millimetre resolution: the honest precision for a building level, and it
 *  keeps float noise (2.5300000000000002) out of the user's face. */
function metres(value: number): string {
  return (Math.round(value * 1000) / 1000).toFixed(3);
}

const SOURCE_LABEL: Record<ElevationSource, string> = {
  'ifc-elevation-attribute': 'IFC-Attribut',
  'pset-ffl-relative': 'Pset (FFL)',
  'object-placement': 'aus Platzierung gerechnet',
  manual: 'von Hand',
};

/** Only `manual` is highlighted — it is the one that survives a re-derivation. */
const SOURCE_TONE: Record<ElevationSource, string> = {
  'ifc-elevation-attribute': 'text-muted-foreground',
  'pset-ffl-relative': 'text-muted-foreground',
  'object-placement': 'text-amber-600 dark:text-amber-400',
  manual: 'text-purple-600 dark:text-purple-400',
};

interface HeightsPanelProps {
  onClose?: () => void;
}

export function HeightsPanel({ onClose }: HeightsPanelProps) {
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const system = useViewerStore((s) => s.heightSystem);
  const error = useViewerStore((s) => s.heightSystemError);
  const derive = useViewerStore((s) => s.deriveHeightSystemFrom);
  const setElevation = useViewerStore((s) => s.setStoreyElevation);
  const setHeight = useViewerStore((s) => s.setStoreyHeightValue);
  const rename = useViewerStore((s) => s.renameHeightStorey);
  const setDatum = useViewerStore((s) => s.setHeightDatum);

  const [editing, setEditing] = useState<string | null>(null);

  const rows = useMemo(
    () => (system ? withStoreyHeights(system.storeys) : []),
    [system],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Ruler className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-[13px] font-medium">Höhen &amp; Lage</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={!activeModelId}
              onClick={() => activeModelId && derive(activeModelId)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {system
              ? 'Neu aus dem Modell ableiten — überschreibt Änderungen von Hand'
              : 'Aus dem Modell ableiten'}
          </TooltipContent>
        </Tooltip>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {error && (
        <p className="border-b bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
        </p>
      )}

      {!system && !error && (
        <p className="px-3 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          Noch nicht abgeleitet.
          <br />
          Das Architekturmodell gibt die Koten vor, an denen sich die übrigen
          Fachmodelle messen lassen.
        </p>
      )}

      {system && (
        <>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              ±0.00 ü.M.
            </label>
            <Input
              key={`datum:${system.datumAboveSeaLevel ?? ''}`}
              defaultValue={system.datumAboveSeaLevel !== undefined ? metres(system.datumAboveSeaLevel) : ''}
              placeholder="unbekannt"
              className="h-6 w-24 text-right font-mono text-[11px]"
              onBlur={(e) => {
                const raw = e.target.value.trim();
                // Empty means UNKNOWN, and clearing the field has to be able to
                // say that — writing 0 would be a claim about the site.
                setDatum(raw === '' ? null : Number(raw.replace(',', '.')));
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {system.derivedFrom.sourceLengthUnit ?? '—'}
            </span>
          </div>

          <div className="grid grid-cols-[1fr_5rem_5rem] gap-2 border-b px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Geschoss</span>
            <span className="text-right">Kote</span>
            <span className="text-right">Höhe</span>
          </div>

          <ScrollArea className="flex-1">
            <ul className="divide-y">
              {/* Top storey first: that is how a building is read on a
                  section, and it puts the "no height" row where the eye
                  already expects the roof. */}
              {[...rows].reverse().map((storey) => (
                <li key={storey.id} className="px-3 py-1.5">
                  <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
                    {editing === storey.id ? (
                      <Input
                        autoFocus
                        defaultValue={storey.name}
                        className="h-6 text-[12px]"
                        onBlur={(e) => { rename(storey.id, e.target.value); setEditing(null); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onDoubleClick={() => setEditing(storey.id)}
                        className="truncate text-left text-[12px]"
                        title="Doppelklick zum Umbenennen"
                      >
                        {storey.name}
                      </button>
                    )}

                    <Input
                      key={`e:${storey.id}:${storey.elevation}`}
                      defaultValue={metres(storey.elevation)}
                      className="h-6 text-right font-mono text-[11px]"
                      onBlur={(e) => setElevation(storey.id, Number(e.target.value.replace(',', '.')))}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />

                    {storey.height === null ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help text-right font-mono text-[11px] text-muted-foreground">
                            —
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Oberstes Geschoss: es gibt keine Kote darüber, an der sich
                          die Höhe messen liesse. Der Wert ist unbekannt, nicht 0.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Input
                        key={`h:${storey.id}:${storey.height}`}
                        defaultValue={metres(storey.height)}
                        className="h-6 text-right font-mono text-[11px]"
                        title="Ändern verschiebt das Geschoss darüber"
                        onBlur={(e) => setHeight(storey.id, Number(e.target.value.replace(',', '.')))}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      />
                    )}
                  </div>
                  <span className={`text-[10px] ${SOURCE_TONE[storey.source]}`}>
                    {SOURCE_LABEL[storey.source]}
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </>
      )}

      <div className="border-t px-3 py-2">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Alle Längen in Metern, bezogen auf den Projektnullpunkt ±0.00.
          Die Höhe eines Geschosses zu ändern verschiebt die darüberliegenden.
        </p>
      </div>
    </div>
  );
}
