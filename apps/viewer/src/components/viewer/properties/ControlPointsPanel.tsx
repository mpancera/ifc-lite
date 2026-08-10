/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deriving the coordinate operation by naming points.
 *
 * Each row is one correspondence: a point in the model, and where that point
 * actually is. Two rows are enough. The residual column is the reason to allow
 * more than two — it names the row that does not fit instead of quietly
 * averaging it in, so a mistyped coordinate is visible before it is applied.
 *
 * Rows are held as strings, not numbers: half-typed input has to survive a
 * re-render, and a field cleared to retype it must not read as 0.
 */

import { useCallback, useMemo, useState } from 'react';
import { Crosshair, Plus, Trash2, ChevronRight, Check } from 'lucide-react';

import {
  solveGeoreference,
  type GeoreferenceSolution,
  type SolveGeoreferenceFailure,
} from '@/lib/geo/solve-georeference';
import { rowsToPairs, type ControlPointRow } from '@/lib/geo/control-point-rows';

export interface ControlPointsPanelProps {
  editable?: boolean;
  /** Unit label for the map columns, e.g. "m". */
  mapUnitSuffix: string;
  /**
   * The scale IFC requires: project length unit ÷ map unit. The solve is
   * locked to it, so what the points imply becomes a check rather than a
   * result.
   */
  expectedScale: number;
  onApply: (solution: GeoreferenceSolution) => void;
}

let nextRowId = 0;
function emptyRow(): ControlPointRow {
  nextRowId += 1;
  return { id: `cp-${nextRowId}`, label: '', localX: '', localY: '', easting: '', northing: '' };
}

const FAILURE_TEXT: Record<SolveGeoreferenceFailure, string> = {
  'too-few-pairs': 'Mindestens zwei vollständige Zeilen nötig.',
  'coincident-local': 'Die Modellpunkte liegen alle aufeinander — es gibt keine Richtung.',
  'coincident-map': 'Die Kartenpunkte liegen alle aufeinander — es gibt keine Richtung.',
};

export function ControlPointsPanel({
  editable,
  mapUnitSuffix,
  expectedScale,
  onApply,
}: ControlPointsPanelProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ControlPointRow[]>(() => [emptyRow(), emptyRow()]);

  const setField = useCallback((id: string, field: keyof ControlPointRow, value: string) => {
    setRows(current => current.map(row => (row.id === id ? { ...row, [field]: value } : row)));
  }, []);

  const addRow = useCallback(() => setRows(current => [...current, emptyRow()]), []);

  const removeRow = useCallback((id: string) => {
    // Never drop below two: the panel would then be a form that cannot be
    // submitted, with no hint why.
    setRows(current => (current.length <= 2 ? current : current.filter(row => row.id !== id)));
  }, []);

  const { result, usedRowIds } = useMemo(() => {
    const { pairs, rowIds } = rowsToPairs(rows);
    return { result: solveGeoreference(pairs, { lockScale: expectedScale }), usedRowIds: rowIds };
  }, [rows, expectedScale]);

  const residualByRowId = useMemo(() => {
    const map = new Map<string, { value: number; isWorst: boolean }>();
    if (!result.ok) return map;
    usedRowIds.forEach((id, index) => {
      map.set(id, {
        value: result.solution.residuals[index],
        isWorst: index === result.solution.worstPairIndex && result.solution.maxResidual > 0,
      });
    });
    return map;
  }, [result, usedRowIds]);

  if (!editable) return null;

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-900">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left transition-colors"
      >
        <ChevronRight className={`h-3 w-3 text-teal-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Crosshair className="h-3 w-3 text-teal-500 shrink-0" />
        <span className="font-bold text-[11px] text-zinc-700 dark:text-zinc-300 uppercase tracking-wide flex-1">
          Referenzpunkte
        </span>
        {!open && result.ok && (
          <span className="text-[10px] font-mono text-teal-600/70 dark:text-teal-500/60">
            {usedRowIds.length} Punkte · ±{result.solution.maxResidual.toFixed(3)} {mapUnitSuffix}
          </span>
        )}
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-1.5">
          <p className="text-[9px] text-zinc-500 dark:text-zinc-400 leading-snug px-1">
            Punkt im Modell und seine amtliche Koordinate. Zwei Zeilen genügen; weitere
            werden ausgeglichen und die Restklaffe zeigt, welche nicht passt.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono tabular-nums">
              <thead>
                <tr className="text-zinc-400 dark:text-zinc-500">
                  <th className="text-left font-normal px-1 py-0.5">Punkt</th>
                  <th className="text-right font-normal px-1 py-0.5">X lokal</th>
                  <th className="text-right font-normal px-1 py-0.5">Y lokal</th>
                  <th className="text-right font-normal px-1 py-0.5">E</th>
                  <th className="text-right font-normal px-1 py-0.5">N</th>
                  <th className="text-right font-normal px-1 py-0.5">Klaffe</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const residual = residualByRowId.get(row.id);
                  return (
                    <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="px-0.5 py-0.5">
                        <CellInput
                          value={row.label}
                          placeholder="Ecke NO"
                          align="left"
                          onChange={value => setField(row.id, 'label', value)}
                        />
                      </td>
                      {(['localX', 'localY', 'easting', 'northing'] as const).map(field => (
                        <td key={field} className="px-0.5 py-0.5">
                          <CellInput
                            value={row[field]}
                            placeholder="—"
                            align="right"
                            onChange={value => setField(row.id, field, value)}
                          />
                        </td>
                      ))}
                      <td
                        className={`px-1 py-0.5 text-right ${
                          residual?.isWorst
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-teal-600 dark:text-teal-400'
                        }`}
                      >
                        {residual ? residual.value.toFixed(3) : '—'}
                      </td>
                      <td className="px-0.5 py-0.5 text-right">
                        <button
                          onClick={() => removeRow(row.id)}
                          disabled={rows.length <= 2}
                          className="p-0.5 text-zinc-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-zinc-400"
                          aria-label="Zeile entfernen"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 px-1">
            <button
              onClick={addRow}
              className="flex items-center gap-1 text-[9px] text-teal-500 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
            >
              <Plus className="h-2.5 w-2.5" />
              Zeile
            </button>
            <span className="text-[9px] text-zinc-400 dark:text-zinc-500 ml-auto">
              Massstab gesperrt auf {expectedScale}
            </span>
          </div>

          {result.ok
            ? (
              <SolutionSummary
                solution={result.solution}
                mapUnitSuffix={mapUnitSuffix}
                onApply={() => onApply(result.solution)}
              />
            )
            : (
              <p className="text-[9px] text-zinc-500 dark:text-zinc-400 px-1">
                {FAILURE_TEXT[result.reason]}
              </p>
            )}
        </div>
      )}
    </div>
  );
}

function CellInput({
  value,
  placeholder,
  align,
  onChange,
}: {
  value: string;
  placeholder: string;
  align: 'left' | 'right';
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={event => onChange(event.target.value)}
      className={`w-full min-w-[4.5rem] text-[10px] font-mono px-1 py-0.5 bg-transparent border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 focus:border-teal-400 dark:focus:border-teal-600 outline-none text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    />
  );
}

/**
 * The three numbers worth reading before applying: how far the worst point
 * misses, how much the model is turned, and whether the points agree with the
 * locked scale. The scale check is the one that catches a wrong unit or a
 * transposed digit, which no residual on its own would reveal.
 */
function SolutionSummary({
  solution,
  mapUnitSuffix,
  onApply,
}: {
  solution: GeoreferenceSolution;
  mapUnitSuffix: string;
  onApply: () => void;
}) {
  const ppm = solution.scaleDeviationPpm;
  // 200 ppm over a 100 m building is 2 cm — within picking accuracy. Beyond
  // that the points disagree about size, which a rigid transform cannot fix.
  const scaleSuspect = ppm !== null && Math.abs(ppm) > 200;

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 space-y-1">
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono tabular-nums">
        <Readout label="Klaffe max" value={`${solution.maxResidual.toFixed(3)} ${mapUnitSuffix}`} />
        <Readout label="Drehung" value={`${solution.rotationDeg.toFixed(4)}°`} />
        <Readout
          label="Massstabsprobe"
          value={ppm === null ? '—' : `${ppm >= 0 ? '+' : ''}${ppm.toFixed(0)} ppm`}
          warn={scaleSuspect}
        />
      </div>
      {scaleSuspect && (
        <p className="text-[9px] text-amber-600 dark:text-amber-400 leading-snug">
          Die Punkte sind sich über die Grösse nicht einig. Meist eine vertauschte Ziffer
          oder ein Modell in einer anderen Einheit als angenommen.
        </p>
      )}
      <button
        onClick={onApply}
        className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium text-white bg-teal-600 hover:bg-teal-700 transition-colors"
      >
        <Check className="h-3 w-3" />
        In die Koordinatenoperation übernehmen
      </button>
    </div>
  );
}

function Readout({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] text-zinc-400 dark:text-zinc-500 truncate">{label}</div>
      <div className={warn ? 'text-amber-600 dark:text-amber-400' : 'text-teal-700 dark:text-teal-400'}>
        {value}
      </div>
    </div>
  );
}
