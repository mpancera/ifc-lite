/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The sample clip: two discipline models, one structure.
 *
 * Numbered 0 because it is not one of the five strands. It exists to prove the
 * machinery against real data -- captions, the drawn pointer, per-beat proofs,
 * subtitles from measured timings -- and its beats belong at the opening of
 * strand 3, which also starts from both models loaded.
 *
 * The argument it lands is the entry to the whole series: what
 * arrives as a pile of files from two trades becomes one navigable project,
 * in a browser, with nothing installed and nothing uploaded. Every later clip
 * stands on it, so it shows the boring part honestly -- the second file really
 * is loaded on top of the first, and the storey tree really does come out of
 * the files rather than out of a configured list.
 *
 * The unit mismatch is named out loud in beat four because it is the thing a
 * BIM audience expects to go wrong: one export is in feet, the other in
 * metres, and they still land on top of each other.
 *
 * Captions are generic on purpose (this repository is public); a recording
 * that should name the building supplies the words through the local override
 * file described in `captions.ts`.
 */

import { addDemoFile, openDemoFile } from '../dataset';
import { orbitViewpoint } from '../cameraMoves';
import { findStoreyByName, modelsSettled } from '../model-lookup';
import type { ScreenflowClip } from '../types';

/** The ground floor as the architecture export names its storeys. */
const GROUND_FLOOR = '00';

export const CLIP_01_FEDERATION: ScreenflowClip = {
  id: 'clip-01-federation',
  number: 0,
  titleDe: 'Zwei Modelle, eine Struktur',
  titleEn: 'Two models, one structure',
  messageDe: 'Föderiert im Browser. Nichts installiert, nichts hochgeladen.',
  messageEn: 'Federated in the browser. Nothing installed, nothing uploaded.',
  version: 1,
  requires: ['architecture', 'fireDetection'],
  beats: [
    {
      id: 'title',
      frame: 'card',
      captionDe: 'Ein Bestandsgebäude – Architektur und Brandmeldeanlage.',
      captionEn: 'An existing building - architecture and fire detection.',
      holdMs: 3200,
    },
    {
      id: 'load-architecture',
      captionDe: 'Das Architekturmodell wird geöffnet – im Browser, ohne Installation.',
      captionEn: 'The architecture model opens - in the browser, nothing installed.',
      perform: () => openDemoFile('architecture'),
      settled: (s) => modelsSettled(s, 1),
      // A real IFC of this size takes its time to parse, and the clip shows
      // that honestly rather than cutting to an already-loaded model.
      settleTimeoutMs: 180_000,
    },
    {
      id: 'add-fire-detection',
      captionDe: 'Ein zweites Fachmodell kommt dazu: die Brandmeldeanlage.',
      captionEn: 'A second discipline model joins it: the fire detection system.',
      perform: () => addDemoFile('fireDetection'),
      settled: (s) => modelsSettled(s, 2),
      settleTimeoutMs: 120_000,
    },
    {
      id: 'units',
      captionDe: 'Beide im selben Weltrahmen – eines rechnet in Fuss, das andere in Metern.',
      captionEn: 'Both in one world frame - one file in feet, the other in metres.',
      perform: (store) => {
        const { cameraCallbacks } = store.getState();
        cameraCallbacks.fitAll?.();
        const from = cameraCallbacks.getViewpoint?.();
        if (from && cameraCallbacks.applyViewpoint) {
          cameraCallbacks.applyViewpoint(orbitViewpoint(from, 45), true, 4000);
        }
      },
    },
    {
      id: 'structure',
      anchor: 'hierarchy-panel',
      captionDe: 'Die Gebäudestruktur kommt aus den Dateien, nicht aus einer Liste.',
      captionEn: 'The structure comes out of the files, not out of a maintained list.',
      prepare: (store) => {
        store.getState().setLeftPanelCollapsed(false);
        store.getState().setActiveStorey(null);
      },
    },
    {
      id: 'isolate-storey',
      anchor: 'hierarchy-panel',
      captionDe: 'Ein Klick auf das Erdgeschoss – und nur dieses Geschoss steht da.',
      captionEn: 'One click on the ground floor - and only that floor is left standing.',
      perform: (store) => {
        const ref = findStoreyByName(store.getState(), GROUND_FLOOR);
        if (ref) store.getState().setActiveStorey(ref);
      },
      settled: (s) => s.activeStorey !== null,
      settleTimeoutMs: 4000,
    },
    {
      id: 'close',
      frame: 'card',
      captionDe: 'Zwei Fachmodelle, eine Struktur – kein Austausch zwischen Programmen.',
      captionEn: 'Two models, one structure - no handover between two programs.',
      holdMs: 3600,
    },
  ],
};
