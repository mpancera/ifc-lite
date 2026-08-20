/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Strand 2 — the good case, and it is shorter.
 *
 * # What it argues
 * Strand 1 traced a floor by hand because nothing else existed. That is the
 * fallback, not the method. When the architect's model is there the work
 * starts with a question — does it carry what the fire-detection planning
 * needs — and the answer is a check, not an opinion. Everything after the
 * check is the same as strand 1, so the clip says so and moves on rather than
 * showing it again.
 *
 * # Why the IDS is a file in the repository
 * `public/samples/brandmelder-uebergabe.ids` states four requirements without
 * naming any project, which is what makes it committable — and a real one from
 * a real handover can replace it without touching this clip.
 *
 * # Why the proofs do not assume a pass/fail split
 * The clip runs against whichever model is in `demo-local`, and how much of a
 * requirement a given model meets is a property of that model, not of the
 * software. So the beats prove that a report was produced and that isolation
 * engaged — never that N elements failed. A caption that named a number would
 * be true for one building and a lie for the next.
 */

import { getViewerStoreApi } from '@/store';
import { loadIdsContent } from '@/hooks/ids/loadIdsContent';
import { useViewerStore } from '@/store';
import { openDemoFile } from '../dataset';
import { modelsSettled } from '../model-lookup';
import {
  authoredCount, authoredDevices, makeEditable, placeFromCatalogue, PLACEMENTS,
} from './demo-building';
import type { ScreenflowBeat, ScreenflowClip } from '../types';

/** The requirement set, beside the sample building it is generic enough for. */
const IDS_PATH = '/samples/brandmelder-uebergabe.ids';

/**
 * Three of strand 1's five, placed the same way.
 *
 * Three and not five because this stretch is a reminder, not a demonstration:
 * strand 1 spent eight beats on it, and repeating that here would make the
 * "shorter" claim of the opening card false on screen while the caption made
 * it in words.
 */
const REMINDER_PLACEMENTS = PLACEMENTS.slice(0, 3);

function placeReminderBeats(): ScreenflowBeat[] {
  return REMINDER_PLACEMENTS.map((placement, i) => ({
    id: `place-${i}`,
    worldPoint: placement.at,
    captionDe: i === 0
      ? 'Melder setzen wie vorhin – aus derselben Bibliothek.'
      : 'Und weiter, Raum für Raum.',
    captionEn: i === 0
      ? 'Place detectors as before - from the same library.'
      : 'And on, room by room.',
    perform: (store) => placeFromCatalogue(store, placement),
    settled: () => authoredDevices(getViewerStoreApi()).length >= i + 1,
    settleTimeoutMs: 10_000,
    holdMs: i === 0 ? 3400 : 2400,
  }));
}

export const STRAND_02_MODEL_ALREADY_THERE: ScreenflowClip = {
  id: 'strand-02-model-already-there',
  number: 2,
  titleDe: 'Wenn das Modell schon da ist',
  titleEn: 'When the model is already there',
  messageDe: 'Der gute Fall ist kürzer – und endet in denselben Produkten.',
  messageEn: 'The good case is shorter - and ends in the same deliverables.',
  version: 1,
  requires: ['architecture'],
  beats: [
    {
      id: 'title',
      frame: 'card',
      captionDe: 'Von Hand geht es. Es muss aber nicht.',
      captionEn: 'By hand works. But it does not have to.',
      holdMs: 3200,
    },
    {
      id: 'open-model',
      captionDe: 'Das Modell kommt vom Architekten – gelesen, nicht konvertiert.',
      captionEn: "The model comes from the architect - read, not converted.",
      perform: () => openDemoFile('architecture'),
      settled: (s) => modelsSettled(s, 1),
      settleTimeoutMs: 120_000,
      holdMs: 4200,
    },
    {
      id: 'ids-load',
      anchor: 'activity-ids',
      panel: 'ids',
      captionDe: 'Was die Brandmeldeplanung braucht, steht als IDS – prüfbar, nicht als Mail.',
      captionEn: 'What the planning needs is an IDS - checkable, not an email.',
      prepare: (store) => { store.getState().showWorkspacePanel('ids'); },
      perform: async () => {
        const res = await fetch(IDS_PATH);
        if (!res.ok) throw new Error(`IDS nicht gefunden: ${res.status} ${IDS_PATH}`);
        loadIdsContent(useViewerStore, await res.text());
      },
      // The document is parsed and audited before it can be run; a
      // specification count is the fact that says both happened.
      settled: (s) => (s.idsDocument?.specifications.length ?? 0) > 0,
      settleTimeoutMs: 20_000,
      holdMs: 5200,
    },
    {
      id: 'ids-run',
      anchor: 'activity-ids',
      panel: 'ids',
      captionDe: 'Vier Anforderungen, gegen das Modell gerechnet.',
      captionEn: 'Four requirements, run against the model.',
      perform: (store) => store.getState().setIdsRunRequested(true),
      settled: (s) => s.idsValidationReport !== null && !s.idsLoading,
      settleTimeoutMs: 120_000,
      holdMs: 5600,
    },
    {
      id: 'ids-read',
      anchor: 'activity-ids',
      panel: 'ids',
      captionDe: 'Erfüllt oder nicht – Anforderung für Anforderung, nicht als Gesamturteil.',
      captionEn: 'Met or not - requirement by requirement, not as one verdict.',
      holdMs: 5200,
    },
    {
      id: 'ids-isolate',
      anchor: 'activity-ids',
      panel: 'ids',
      captionDe: 'Und was nicht erfüllt ist, lässt sich im Modell isolieren.',
      captionEn: 'And what is not met can be isolated in the model.',
      perform: (store) => store.getState().setIdsIsolateMode('failed'),
      settled: (s) => s.idsIsolateMode === 'failed',
      settleTimeoutMs: 8000,
      holdMs: 5200,
    },
    {
      id: 'quality-card',
      frame: 'card',
      captionDe: 'Die geforderte Qualität ist nachgewiesen. Ab hier ist es Strang 1.',
      captionEn: 'The required quality is proven. From here it is strand 1.',
      holdMs: 3600,
      perform: (store) => {
        // Out of isolation and back to the whole building: the next stretch is
        // about placing into it, and a view still showing only the failures
        // would make the placements look like they landed nowhere.
        store.getState().setIdsIsolateMode(null);
        makeEditable(store);
      },
      settled: (s) => s.idsIsolateMode === null && s.mutationViews.size > 0,
      settleTimeoutMs: 8000,
    },
    ...placeReminderBeats(),
    {
      id: 'to-plan',
      captionDe: 'Die Ausgabe beginnt im Grundriss – gezeichnet wird, was zu sehen ist.',
      captionEn: 'Output starts in the plan - what is drawn is what is shown.',
      perform: (store) => {
        store.getState().setActiveTool('select');
        store.getState().setViewMode('2d');
      },
      settled: (s) => s.viewMode === '2d',
      settleTimeoutMs: 8000,
      holdMs: 2600,
    },
    {
      id: 'export-pdf',
      captionDe: 'Derselbe Plan als PDF – für die Baustelle.',
      captionEn: 'The same plan as PDF - for the site.',
      // Each export is a fire-and-forget browser download, and a download is
      // not a store fact. What CAN be proved is that the plan took the request
      // -- it clears the field when it has -- and that is what the beat waits
      // for. Proving the file landed would mean reading the user's disk.
      perform: (store) => store.getState().requestPlanExport('pdf'),
      settled: (s) => s.planExportRequested === null,
      settleTimeoutMs: 30_000,
      holdMs: 3400,
    },
    {
      id: 'export-svg',
      captionDe: 'Als SVG – zum Weiterverwenden in anderen Anwendungen.',
      captionEn: 'As SVG - to carry on with elsewhere.',
      perform: (store) => store.getState().requestPlanExport('svg'),
      settled: (s) => s.planExportRequested === null,
      settleTimeoutMs: 30_000,
      holdMs: 3400,
    },
    {
      id: 'export-dxf',
      captionDe: 'Und als DXF – die Geometrie zurück ins CAD.',
      captionEn: 'And as DXF - the geometry back into CAD.',
      perform: (store) => store.getState().requestPlanExport('dxf'),
      settled: (s) => s.planExportRequested === null,
      settleTimeoutMs: 30_000,
      holdMs: 3400,
    },
    {
      id: 'close',
      frame: 'card',
      captionDe: 'Ein Modell rein, drei Planprodukte raus. Ohne Nachzeichnen.',
      captionEn: 'One model in, three plan products out. No tracing.',
      holdMs: 3800,
      settled: () => authoredCount(getViewerStoreApi(), 'IfcSensor') >= 1,
    },
  ],
};
