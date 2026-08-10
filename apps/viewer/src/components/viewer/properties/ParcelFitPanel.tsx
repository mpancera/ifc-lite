/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Placing a model by laying its own plot outline onto the surveyed one.
 *
 * Works on the SELECTION, not on a guessed element. The fit cannot tell a
 * parcel boundary from a setback line or a building footprint — it matches
 * whatever it is given and reports a plausible error either way. Naming the
 * surface is a judgement about the model, and it stays with the person making
 * it.
 *
 * The distances are shown before the button is reachable, for the same reason:
 * they are the only evidence that the outline really was that parcel.
 */

import { useCallback, useState } from 'react';
import { ChevronRight, LandPlot, Loader2, Check } from 'lucide-react';

import { useViewerStore } from '@/store';
import { fromGlobalIdFromModels } from '@/store/globalId';
import type { GeometryResult } from '@ifc-lite/geometry';

import { outlineFromSelection } from '@/lib/geo/selection-outline';
import { fitOutline } from '@/lib/geo/fit-outline';
import { metreFitToMapConversion, type MapConversionAttributes } from '@/lib/geo/mesh-to-map';
import {
  parcelSourceForCrs,
  type FetchParcelFailure,
  type ParcelSource,
} from '@/lib/geo/parcel-source';

export interface ParcelFitPanelProps {
  modelId?: string;
  editable?: boolean;
  /** EPSG name of the model's CRS — decides whether a cadastre is reachable. */
  crsName?: string;
  geometryResult?: GeometryResult | null;
  mapUnitScale: number;
  lengthUnitScale: number;
  onApply: (attributes: MapConversionAttributes) => void;
}

interface FitReport {
  attributes: MapConversionAttributes;
  rotationDeg: number;
  meanDistance: number;
  maxDistance: number;
  vertexCount: number;
}

const OUTLINE_TROUBLE: Record<string, string> = {
  'nothing-selected': 'Nichts ausgewählt. Wähle im Viewport die Fläche, die der Parzelle entspricht.',
  'no-geometry': 'Die Auswahl hat keine Geometrie in diesem Modell.',
  empty: 'Die Auswahl enthält keine Dreiecke.',
  'no-boundary': 'Das ist ein geschlossener Körper — er hat keinen Rand. Wähle eine Fläche, etwa das Gelände oder die Umgebungsplatte.',
  'no-closed-ring': 'Aus den Randkanten liess sich kein geschlossener Umriss bilden.',
};

const LOOKUP_TROUBLE: Record<FetchParcelFailure, string> = {
  'invalid-identifier': 'Das ist keine gültige E-GRID (CH + 12 Ziffern).',
  'external-requests-disabled': 'Externe Abfragen sind aus. Ohne sie lässt sich die amtliche Grenze nicht holen — im Datenschutz-Bereich freigeben.',
  'not-found': 'Zu dieser E-GRID wurde keine Parzelle gefunden.',
  network: 'Die Abfrage ist fehlgeschlagen. Netzwerk oder Dienst nicht erreichbar.',
};

export function ParcelFitPanel({
  modelId,
  editable,
  crsName,
  geometryResult,
  mapUnitScale,
  lengthUnitScale,
  onApply,
}: ParcelFitPanelProps) {
  const models = useViewerStore(s => s.models);
  const selectedEntityIds = useViewerStore(s => s.selectedEntityIds);

  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [report, setReport] = useState<FitReport | null>(null);

  const source: ParcelSource | null = parcelSourceForCrs(crsName);

  const runFit = useCallback(async () => {
    if (!source || !modelId) return;
    setBusy(true);
    setTrouble(null);
    setReport(null);
    try {
      // Federated selections carry global ids; keep only the ones belonging to
      // this panel's model, resolved through the registry rather than by
      // arithmetic on the id.
      const mine = new Set<number>();
      for (const globalId of selectedEntityIds) {
        const ref = fromGlobalIdFromModels(models, globalId);
        if (ref && (ref.modelId === modelId || ref.modelId === 'legacy')) mine.add(ref.expressId);
      }

      const outline = outlineFromSelection(mine, geometryResult);
      if (!outline.ok) {
        setTrouble(OUTLINE_TROUBLE[outline.reason] ?? 'Der Umriss liess sich nicht bestimmen.');
        return;
      }

      const parcel = await source.fetchParcel(identifier);
      if (!parcel.ok) {
        setTrouble(LOOKUP_TROUBLE[parcel.reason]);
        return;
      }

      // Both rings are in the CRS's metric unit, so the fit's scale is a plain
      // 1 and the unit bridging happens once, afterwards.
      const fit = fitOutline(outline.ring, parcel.parcel.ring, { lockScale: 1 });
      if (!fit.ok) {
        setTrouble('Umriss und Parzelle liessen sich nicht einpassen.');
        return;
      }

      setReport({
        attributes: metreFitToMapConversion(fit.solution, mapUnitScale, lengthUnitScale),
        rotationDeg: fit.solution.rotationDeg,
        meanDistance: fit.meanDistance,
        maxDistance: fit.maxDistance,
        vertexCount: outline.ring.length,
      });
    } finally {
      setBusy(false);
    }
  }, [
    source, modelId, models, selectedEntityIds, geometryResult,
    identifier, mapUnitScale, lengthUnitScale,
  ]);

  if (!editable) return null;

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-900">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left transition-colors"
      >
        <ChevronRight className={`h-3 w-3 text-teal-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <LandPlot className="h-3 w-3 text-teal-500 shrink-0" />
        <span className="font-bold text-[11px] text-zinc-700 dark:text-zinc-300 uppercase tracking-wide flex-1">
          Parzelleneinpassung
        </span>
        {!open && report && (
          <span className="text-[10px] font-mono text-teal-600/70 dark:text-teal-500/60">
            ±{report.maxDistance.toFixed(2)} m
          </span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-2 space-y-1.5">
          {!source
            ? (
              <p className="text-[9px] text-zinc-500 dark:text-zinc-400 leading-snug">
                Für {crsName ?? 'dieses Koordinatensystem'} ist kein amtlicher Parzellendienst
                hinterlegt. Die Einpassung steht nur dort zur Verfügung, wo einer angebunden ist.
              </p>
            )
            : (
              <>
                <p className="text-[9px] text-zinc-500 dark:text-zinc-400 leading-snug">
                  Wähle im Viewport die Fläche, die der Parzelle entspricht — Gelände,
                  Umgebungsplatte, Grundstücksfläche. {source.label}.
                </p>

                <div className="flex items-center gap-1">
                  <input
                    value={identifier}
                    onChange={event => setIdentifier(event.target.value)}
                    placeholder={source.identifierHint}
                    className="flex-1 min-w-0 text-[11px] font-mono px-1.5 py-1 border border-zinc-200 dark:border-zinc-700 bg-transparent focus:border-teal-400 dark:focus:border-teal-600 outline-none text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400/60"
                  />
                  <button
                    onClick={() => { void runFit(); }}
                    disabled={busy || !identifier.trim()}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 shrink-0"
                  >
                    {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                    Einpassen
                  </button>
                </div>

                {trouble && (
                  <p className="text-[9px] text-amber-600 dark:text-amber-400 leading-snug">{trouble}</p>
                )}

                {report && <FitReportView report={report} onApply={() => onApply(report.attributes)} />}
              </>
            )}
        </div>
      )}
    </div>
  );
}

/**
 * The evidence, then the button. A fit that matched the wrong surface looks
 * exactly like one that matched the right surface except in these numbers, so
 * they are not an afterthought shown beside the result — they are the result.
 */
function FitReportView({ report, onApply }: { report: FitReport; onApply: () => void }) {
  // A decimetre is about what a published cadastral boundary and a modelled
  // one can be expected to agree to. Past a metre something else was fitted.
  const doubtful = report.maxDistance > 1;

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 space-y-1">
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono tabular-nums">
        <Readout label="Abstand Mittel" value={`${report.meanDistance.toFixed(3)} m`} />
        <Readout label="Abstand max" value={`${report.maxDistance.toFixed(3)} m`} warn={doubtful} />
        <Readout label="Drehung" value={`${report.rotationDeg.toFixed(4)}°`} />
      </div>
      <div className="text-[9px] text-zinc-400 dark:text-zinc-500">
        {report.vertexCount} Umrisspunkte
      </div>
      {doubtful && (
        <p className="text-[9px] text-amber-600 dark:text-amber-400 leading-snug">
          Der Umriss deckt sich nicht gut mit der Parzelle. Vermutlich ist die gewählte Fläche
          etwas anderes — eine Baulinie, ein Gebäudegrundriss — und nicht die Grundstücksgrenze.
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
