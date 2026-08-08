/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Höhen & Lage — the project's reference height system.
 *
 * A verification view, not a tool: it lives in the bottom strip like Lists and
 * opens from File ▸ Settings, because the question it answers ("what do the
 * levels in this project actually mean") is one you ask occasionally and then
 * leave alone.
 *
 * The layout follows from that. Storeys are rows; the named reference heights
 * are COLUMNS showing their absolute elevation, because the everyday act is
 * comparing one level across storeys, not inspecting one storey's offsets. The
 * offsets themselves are defined once, above the table.
 *
 * Three things the view refuses to fake:
 *
 * - The topmost storey has NO height. Nothing in a storey list says where the
 *   building ends, so the cell shows "—" rather than a number.
 * - Every level says where it came from. A figure read from the model and one
 *   a person typed are not the same claim.
 * - An empty sea-level field means UNKNOWN, and clearing it drops the value
 *   rather than writing 0.
 */

import { useMemo, useState } from 'react';
import { Download, Plus, RefreshCw, Ruler, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { levelsFor, withStoreyHeights } from '@/lib/heights/derive';
import { findUnitIssues, unitOf, unitTypeColumns, type ModelUnits } from '@/lib/heights/units';
import { HEIGHTS_FILE_NAME, serializeHeightSystem } from '@/lib/heights/serialize';
import { downloadFile } from '@/lib/export/download';
import { toast } from '@/components/ui/toast';
import { describeAllUnits } from '@ifc-lite/parser';
import type { ElevationSource } from '@/lib/heights/types';

/** Millimetre resolution: the honest precision for a building level, and it
 *  keeps float noise (2.5300000000000002) out of the user's face. */
function metres(value: number): string {
  return (Math.round(value * 1000) / 1000).toFixed(3);
}

/** Accepts a comma as the decimal separator, which is what a Swiss keyboard
 *  produces on the numeric block. */
function parseMetres(raw: string): number {
  return Number(raw.trim().replace(',', '.'));
}

const SOURCE_LABEL: Record<ElevationSource, string> = {
  'ifc-elevation-attribute': 'IFC-Attribut',
  'pset-ffl-relative': 'Pset (FFL)',
  'object-placement': 'aus Platzierung',
  manual: 'von Hand',
};

/** Only the two that are NOT the architect's own number stand out. */
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
  const addLevel = useViewerStore((s) => s.addHeightReferenceLevel);
  const removeLevel = useViewerStore((s) => s.removeHeightReferenceLevel);
  const updateLevel = useViewerStore((s) => s.updateHeightReferenceLevel);
  const setStoreyLevels = useViewerStore((s) => s.setHeightStoreyLevels);

  const [editingName, setEditingName] = useState<string | null>(null);
  const [showUnits, setShowUnits] = useState(false);
  const models = useViewerStore((s) => s.models);

  /**
   * What every loaded model declares. Read on demand rather than kept in the
   * store: it changes only when a model is loaded, and re-reading is a few
   * entity lookups against an index that is already in memory.
   */
  const modelUnits = useMemo<ModelUnits[]>(() => {
    const out: ModelUnits[] = [];
    for (const [modelId, model] of models) {
      const store = model.ifcDataStore;
      out.push({
        modelId,
        fileName: model.name ?? modelId,
        units: store?.source && store.entityIndex
          ? describeAllUnits(store.source, store.entityIndex)
          : null,
      });
    }
    return out;
  }, [models]);

  const unitColumns = useMemo(() => unitTypeColumns(modelUnits), [modelUnits]);
  const unitIssues = useMemo(() => findUnitIssues(modelUnits), [modelUnits]);

  const rows = useMemo(
    // Top storey first: that is how a building is read on a section, and it
    // puts the "no height" row where the eye already expects the roof.
    () => (system ? [...withStoreyHeights(system.storeys)].reverse() : []),
    [system],
  );
  const levels = system?.referenceLevels ?? [];

  /** Storey column + level columns, so header and body cannot drift apart. */
  const gridStyle = {
    gridTemplateColumns: `minmax(7rem,1fr) 6rem 6rem ${levels.map(() => '7rem').join(' ')} 8rem`,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Ruler className="h-4 w-4 text-muted-foreground" />
        <span className="text-[13px] font-medium">Höhen &amp; Lage</span>
        {system && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {system.derivedFrom.fileName} · {system.derivedFrom.sourceLengthUnit ?? '—'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline" size="sm" className="h-6 px-2 text-[11px]"
                disabled={!system}
                onClick={() => {
                  if (!system) return;
                  downloadFile(serializeHeightSystem(system), HEIGHTS_FILE_NAME, 'application/json');
                  toast.success(`${HEIGHTS_FILE_NAME} exportiert`);
                }}
              >
                <Download className="mr-1 h-3 w-3" />
                Export
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Als {HEIGHTS_FILE_NAME} sichern — alle Längen in Metern, bezogen auf ±0.00.
              Jederzeit wiederholbar; die Datei trägt den Zeitpunkt ihrer Erzeugung.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
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
          {/* The reference heights are defined ONCE here and then read down the
              table as columns — an offset belongs to the system, not to a row. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-2">
            <div className="flex items-center gap-1.5">
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
                  // Empty means UNKNOWN; writing 0 would be a claim about the site.
                  setDatum(raw === '' ? null : parseMetres(raw));
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
            </div>

            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Referenzhöhen
            </span>
            {levels.map((level) => (
              <div key={level.key} className="flex items-center gap-1">
                <Input
                  key={`l:${level.key}:${level.label}`}
                  defaultValue={level.label}
                  className="h-6 w-32 text-[11px]"
                  onBlur={(e) => updateLevel(level.key, { label: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <Input
                  key={`o:${level.key}:${level.offset}`}
                  defaultValue={metres(level.offset)}
                  title="Abstand zur Geschosskote, in Metern"
                  className="h-6 w-20 text-right font-mono text-[11px]"
                  onBlur={(e) => updateLevel(level.key, { offset: parseMetres(e.target.value) })}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <Button
                  variant="ghost" size="icon" className="h-6 w-6"
                  title={`„${level.label}" entfernen`}
                  onClick={() => removeLevel(level.key)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline" size="sm" className="h-6 px-2 text-[11px]"
              onClick={() => addLevel('Neue Höhe', 0)}
            >
              <Plus className="mr-1 h-3 w-3" />
              Referenzhöhe
            </Button>
          </div>

          <div
            className="grid gap-2 border-b px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground"
            style={gridStyle}
          >
            <span>Geschoss</span>
            <span className="text-right">Kote</span>
            <span className="text-right">Höhe</span>
            {levels.map((l) => <span key={l.key} className="truncate text-right">{l.label}</span>)}
            <span>Quelle</span>
          </div>

          <ScrollArea className="flex-1">
            <ul className="divide-y">
              {rows.map((storey) => {
                const own = storey.levels !== undefined;
                const effective = levelsFor(storey, system);
                return (
                  <li key={storey.id} className="grid items-center gap-2 px-3 py-1" style={gridStyle}>
                    {editingName === storey.id ? (
                      <Input
                        autoFocus
                        defaultValue={storey.name}
                        className="h-6 text-[12px]"
                        onBlur={(e) => { rename(storey.id, e.target.value); setEditingName(null); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') setEditingName(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onDoubleClick={() => setEditingName(storey.id)}
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
                      onBlur={(e) => setElevation(storey.id, parseMetres(e.target.value))}
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
                          die Höhe messen liesse. Unbekannt, nicht 0.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Input
                        key={`h:${storey.id}:${storey.height}`}
                        defaultValue={metres(storey.height)}
                        className="h-6 text-right font-mono text-[11px]"
                        title="Ändern verschiebt die Geschosse darüber"
                        onBlur={(e) => setHeight(storey.id, parseMetres(e.target.value))}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      />
                    )}

                    {/* Absolute elevation of each named height. A storey that
                        deliberately lacks one shows "—" rather than repeating
                        its own level, which would answer a different question. */}
                    {levels.map((level) => {
                      const here = effective.find((l) => l.key === level.key);
                      return (
                        <span
                          key={level.key}
                          className={`text-right font-mono text-[11px] ${own ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground'}`}
                        >
                          {here ? metres(storey.elevation + here.offset) : '—'}
                        </span>
                      );
                    })}

                    <div className="flex items-center gap-1">
                      <span className={`truncate text-[10px] ${SOURCE_TONE[storey.source]}`}>
                        {SOURCE_LABEL[storey.source]}
                      </span>
                      {own && (
                        <Button
                          variant="ghost" size="sm" className="h-5 px-1 text-[10px]"
                          title="Eigene Referenzhöhen verwerfen und die des Systems verwenden"
                          onClick={() => setStoreyLevels(storey.id, null)}
                        >
                          eigene
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </>
      )}

      {/* Current units. Folded away by default — it is the answer to a
          question you ask once per project, and it would otherwise push the
          storeys off the strip. The issue count stays visible, because that is
          the part nobody would think to look for. */}
      <div className="border-t">
        <button
          type="button"
          onClick={() => setShowUnits(!showUnits)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/50"
        >
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Current units
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {modelUnits.length} {modelUnits.length === 1 ? 'Modell' : 'Modelle'}
          </span>
          {unitIssues.length > 0 && (
            <span className="rounded-sm bg-amber-100 px-1.5 py-px text-[10px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              {unitIssues.length} {unitIssues.length === 1 ? 'Auffälligkeit' : 'Auffälligkeiten'}
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {showUnits ? 'zuklappen' : 'aufklappen'}
          </span>
        </button>

        {showUnits && (
          <div className="max-h-56 overflow-auto border-t px-3 py-2">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-3 text-left font-normal">Modell</th>
                  {unitColumns.map((c) => (
                    <th key={c} className="py-1 pr-3 text-left font-normal">
                      {c.replace(/UNIT$/, '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {modelUnits.map((m) => (
                  <tr key={m.modelId} className="border-t">
                    <td className="max-w-[16rem] truncate py-1 pr-3" title={m.fileName}>
                      {m.fileName}
                    </td>
                    {m.units === null ? (
                      <td colSpan={Math.max(1, unitColumns.length)} className="py-1 text-amber-600 dark:text-amber-400">
                        keine Einheitenzuweisung
                      </td>
                    ) : (
                      unitColumns.map((c) => (
                        <td key={c} className="py-1 pr-3">
                          {unitOf(m, c)?.name ?? <span className="text-muted-foreground">—</span>}
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {unitIssues.length > 0 && (
              <ul className="mt-2 space-y-1">
                {unitIssues.map((issue, i) => (
                  <li key={`${issue.kind}:${issue.modelId}:${i}`} className="text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              IFC schreibt keine Einheit vor und kennt keine Ländertabelle — die
              Zuweisung ist sogar optional. Was hier steht, ist deshalb das
              Einzige, worauf sich die Zahlen im Modell berufen können.
            </p>
          </div>
        )}
      </div>

      <div className="border-t px-3 py-1.5">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Alle Längen in Metern, bezogen auf den Projektnullpunkt ±0.00.
          Referenzhöhen sind Abstände zur Geschosskote und wandern mit ihr mit;
          die Höhe eines Geschosses zu ändern verschiebt die darüberliegenden.
        </p>
      </div>
    </div>
  );
}
