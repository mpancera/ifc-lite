/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Correcting a georeference against a surveyed building.
 *
 * The sibling of `ParcelFitPanel`, and deliberately not a mode of it: a parcel
 * boundary is fetched by identifier from an official service, while a building
 * footprint is not reachable that way — the federal services publish parcels by
 * E-GRID and buildings only inside the national 3D model. So the reference
 * arrives as a file the user brought, produced by whatever already knows how to
 * get it, and the viewer stays off the network for this.
 *
 * Two things differ from the parcel case beyond where the ring comes from:
 *
 * - **The model side is a footprint, not a boundary.** A building is a closed
 *   solid and has no border edges to chain; what it has is a silhouette.
 * - **The rotation is held by default.** The defect being corrected is almost
 *   always position alone, and a free search would spend the inevitable
 *   footprint disagreement on a degree or two of spurious rotation.
 *
 * The distances come before the button, as they do next door: a fit onto the
 * wrong building looks exactly like a fit onto the right one except in these
 * numbers.
 */

import { useCallback, useRef, useState } from 'react';
import { Building2, Check, ChevronRight, FileUp, Loader2 } from 'lucide-react';

import { useViewerStore } from '@/store';
import { fromGlobalIdFromModels } from '@/store/globalId';
import { computeAngleToGridNorth } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';

import { footprintFromSelection } from '@/lib/geo/selection-outline';
import {
  compareCrsNames,
  fitFootprintToReference,
  looksLikeUniformInset,
  placementShiftMetres,
  type FootprintFitReport,
} from '@/lib/geo/building-fit';
import {
  parseOutlineGeoJson,
  type ReferenceOutline,
  type ReferenceOutlineFailure,
} from '@/lib/geo/reference-outline';
import type { MapConversionAttributes } from '@/lib/geo/mesh-to-map';

export interface BuildingFitPanelProps {
  modelId?: string;
  editable?: boolean;
  /** EPSG name of the model's CRS — checked against the reference file's. */
  crsName?: string;
  geometryResult?: GeometryResult | null;
  /** CRS map unit → metres. */
  mapUnitScale: number;
  /** Project length unit → metres. */
  lengthUnitScale: number;
  /**
   * The placement in force. Supplies the rotation to hold and the position the
   * fit would move away from — both only meaningful against what is there now.
   */
  currentConversion?: {
    eastings?: number;
    northings?: number;
    xAxisAbscissa?: number;
    xAxisOrdinate?: number;
  };
  onApply: (attributes: MapConversionAttributes) => void;
}

interface LoadedReference extends ReferenceOutline {
  fileName: string;
}

interface Report extends FootprintFitReport {
  /** How far the model moves, metres. `null` when it has no placement yet. */
  shiftMetres: number | null;
  /** Raster cell size of the model footprint, metres — its accuracy. */
  cellSize: number;
}

const FOOTPRINT_TROUBLE: Record<string, string> = {
  'nothing-selected': 'Nichts ausgewählt. Wähle im Viewport das Gebäude — die Wände, Decken und das Dach, die seinen Umriss ergeben.',
  'no-geometry': 'Die Auswahl hat keine Geometrie in diesem Modell.',
  empty: 'Die Auswahl enthält keine Dreiecke.',
  degenerate: 'Die Auswahl hat von oben gesehen keine Fläche — eine einzelne senkrechte Wand hat keinen Grundriss.',
  'no-ring': 'Aus der Auswahl liess sich kein geschlossener Grundriss bilden.',
};

const REFERENCE_TROUBLE: Record<ReferenceOutlineFailure, string> = {
  'not-json': 'Die Datei ist kein GeoJSON.',
  'no-polygon': 'In der Datei steht keine Fläche — erwartet wird ein Polygon mit dem Gebäudeumriss.',
  'too-few-vertices': 'Der Umriss in der Datei hat weniger als drei Punkte.',
  'degrees-not-projected': 'Die Datei enthält Grad (WGS84). Für die Einpassung braucht es projizierte Meter, etwa LV95.',
  'crs-unknown': 'Die Datei nennt kein Bezugssystem, und das Modell auch nicht. Ohne Angabe lässt sich nicht sagen, was die Zahlen bedeuten.',
};

/**
 * Above this the fit is probably onto something else. Looser than the parcel
 * panel's metre on purpose: a building reference is an outer hull surveyed
 * independently of the model, and half a metre of honest disagreement is
 * ordinary. Two metres is not.
 */
const DOUBTFUL_MAX_DISTANCE = 2;

export function BuildingFitPanel({
  modelId,
  editable,
  crsName,
  geometryResult,
  mapUnitScale,
  lengthUnitScale,
  currentConversion,
  onApply,
}: BuildingFitPanelProps) {
  const models = useViewerStore(s => s.models);
  const selectedEntityIds = useViewerStore(s => s.selectedEntityIds);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState<LoadedReference | null>(null);
  const [holdRotation, setHoldRotation] = useState(true);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  // The angle to hold: the one the model already has. Zero when it has no
  // placement yet, which is the same thing said differently — its local axes
  // are the map axes until someone says otherwise.
  const currentRotationDeg = computeAngleToGridNorth(
    currentConversion?.xAxisAbscissa,
    currentConversion?.xAxisOrdinate,
  ) ?? 0;

  const loadReference = useCallback(async (file: File) => {
    setTrouble(null);
    setReport(null);
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      console.error('[BuildingFit] reading the reference file failed', error);
      setTrouble('Die Datei liess sich nicht lesen.');
      return;
    }

    const parsed = parseOutlineGeoJson(text, crsName ? { assumeCrs: crsName } : {});
    if (!parsed.ok) {
      setReference(null);
      setTrouble(REFERENCE_TROUBLE[parsed.reason]);
      return;
    }

    if (compareCrsNames(crsName, parsed.outline.crsName) === 'mismatch') {
      setReference(null);
      setTrouble(
        `Die Datei ist in ${parsed.outline.crsName}, das Modell in ${crsName}. `
        + 'Die beiden Systeme liegen nicht aufeinander — erst umprojizieren, dann einpassen.',
      );
      return;
    }

    setReference({ ...parsed.outline, fileName: file.name });
  }, [crsName]);

  const runFit = useCallback(() => {
    if (!modelId || !reference) return;
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

      const footprint = footprintFromSelection(mine, geometryResult);
      if (!footprint.ok) {
        setTrouble(FOOTPRINT_TROUBLE[footprint.reason] ?? 'Der Grundriss liess sich nicht bestimmen.');
        return;
      }

      const fit = fitFootprintToReference({
        localRing: footprint.ring,
        referenceRing: reference.ring,
        mapUnitScale,
        lengthUnitScale,
        ...(holdRotation ? { lockRotationDeg: currentRotationDeg } : {}),
      });
      if (!fit.ok) {
        setTrouble('Grundriss und Referenz liessen sich nicht einpassen.');
        return;
      }

      setReport({
        ...fit.report,
        shiftMetres: placementShiftMetres(currentConversion, fit.report.attributes, mapUnitScale),
        cellSize: footprint.cellSize,
      });
    } finally {
      setBusy(false);
    }
  }, [
    modelId, models, selectedEntityIds, geometryResult, reference,
    mapUnitScale, lengthUnitScale, holdRotation, currentRotationDeg, currentConversion,
  ]);

  if (!editable) return null;

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-900">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-left transition-colors"
      >
        <ChevronRight className={`h-3 w-3 text-teal-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Building2 className="h-3 w-3 text-teal-500 shrink-0" />
        <span className="font-bold text-[11px] text-zinc-700 dark:text-zinc-300 uppercase tracking-wide flex-1">
          Gebäudeeinpassung
        </span>
        {!open && report && (
          <span className="text-[10px] font-mono text-teal-600/70 dark:text-teal-500/60">
            ±{report.maxDistance.toFixed(2)} m
          </span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-2 space-y-1.5">
          <p className="text-[9px] text-zinc-500 dark:text-zinc-400 leading-snug">
            Wähle im Viewport das Gebäude und lade seinen amtlich vermessenen Umriss
            als GeoJSON in den Koordinaten des Modells. Nicht der Plan wandert zum
            Modell, sondern das Modell an seinen gemessenen Ort.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void loadReference(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-1 px-2 py-1 text-[10px] border border-zinc-200 dark:border-zinc-700 hover:border-teal-400 dark:hover:border-teal-600 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <FileUp className="h-3 w-3 text-teal-500 shrink-0" />
            <span className="truncate">
              {reference ? reference.fileName : 'Referenzumriss laden…'}
            </span>
          </button>

          {reference && (
            <div className="text-[9px] text-zinc-400 dark:text-zinc-500 leading-snug">
              {reference.ring.length} Punkte in {reference.crsName}
              {reference.identifier && <> · {reference.identifier}</>}
              {reference.candidateCount > 1 && (
                <> · {reference.candidateCount} Flächen in der Datei, die grösste wurde genommen</>
              )}
            </div>
          )}

          <label className="flex items-start gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={holdRotation}
              onChange={event => setHoldRotation(event.target.checked)}
              className="mt-0.5 h-3 w-3 accent-teal-500 shrink-0"
            />
            <span className="text-[9px] text-zinc-600 dark:text-zinc-400 leading-snug">
              Rotation halten ({currentRotationDeg.toFixed(3)}°)
              <span className="block text-zinc-400 dark:text-zinc-500">
                An, solange nur die Position falsch ist. Zwei Grundrisse stimmen nie
                exakt überein, und die freie Suche verrechnet diese Abweichung in ein
                bis zwei Grad Scheindrehung, die wie ein besserer Fit aussieht.
              </span>
            </span>
          </label>

          <button
            onClick={runFit}
            disabled={busy || !reference}
            className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Einpassen
          </button>

          {trouble && (
            <p className="text-[9px] text-amber-600 dark:text-amber-400 leading-snug">{trouble}</p>
          )}

          {report && <FitReportView report={report} onApply={() => onApply(report.attributes)} />}
        </div>
      )}
    </div>
  );
}

/**
 * The evidence, then the button.
 *
 * The one reading that needs saying out loud is the uniform gap: the model
 * footprint includes the roof overhang, so against a reference surveyed at the
 * facade the two differ by that overhang all the way round. That is not a
 * position error and moving the model would not close it.
 */
function FitReportView({ report, onApply }: { report: Report; onApply: () => void }) {
  const doubtful = report.maxDistance > DOUBTFUL_MAX_DISTANCE;
  const uniform = looksLikeUniformInset(report.meanDistance, report.maxDistance);

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 space-y-1">
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono tabular-nums">
        <Readout label="Abstand Mittel" value={`${report.meanDistance.toFixed(3)} m`} />
        <Readout label="Abstand max" value={`${report.maxDistance.toFixed(3)} m`} warn={doubtful} />
        <Readout
          label={report.rotationWasHeld ? 'Drehung (gehalten)' : 'Drehung'}
          value={`${report.rotationDeg.toFixed(4)}°`}
        />
      </div>
      {report.shiftMetres !== null && (
        <div className="text-[10px] font-mono tabular-nums">
          <Readout label="Modell wandert" value={`${report.shiftMetres.toFixed(3)} m`} />
        </div>
      )}
      <div className="text-[9px] text-zinc-400 dark:text-zinc-500 leading-snug">
        {report.localVertexCount} Punkte im Modellgrundriss (Rasterweite {report.cellSize.toFixed(2)} m)
        {' '}gegen {report.referenceVertexCount} Punkte in der Referenz
      </div>
      {uniform && (
        <p className="text-[9px] text-zinc-500 dark:text-zinc-400 leading-snug">
          Der Restabstand ist ringsum etwa gleich gross. Das sieht nach einem
          systematischen Unterschied der beiden Umrisse aus — Dachvorsprung gegen
          Fassadenfluss — und nicht nach einem Positionsfehler. Verschieben schliesst
          ihn nicht.
        </p>
      )}
      {doubtful && (
        <p className="text-[9px] text-amber-600 dark:text-amber-400 leading-snug">
          Der Grundriss deckt sich schlecht mit der Referenz. Vermutlich ist die
          Auswahl nicht dasselbe Gebäude wie die Datei, oder es fehlt ein Gebäudeteil
          in der Auswahl.
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
