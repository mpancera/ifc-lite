/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's reference height system.
 *
 * Derived from the architecture model, then edited by hand — because the model
 * is frequently wrong about exactly the thing the system exists to fix. Held in
 * the store rather than recomputed on read: once a person has corrected a
 * level, re-deriving would throw their work away.
 *
 * The rules live in `lib/heights` (pure, unit-tested). This slice is the part
 * that needs the store: which model to read, and holding the result.
 */

import { type StateCreator } from 'zustand';
import { deriveHeightSystem } from '@/lib/heights/derive';
import { readRawStoreys } from '@/lib/heights/read';
import {
  addReferenceLevel, removeReferenceLevel, setDatumAboveSeaLevel, setElevation,
  setReferenceLevels, setStoreyHeight, setStoreyLevels, setStoreyName,
  updateReferenceLevel,
} from '@/lib/heights/edit';
import type { HeightSystem, ReferenceLevel } from '@/lib/heights/types';
import type { ViewerState } from '../index.js';

export interface HeightsSlice {
  /** `null` until derived. */
  heightSystem: HeightSystem | null;
  /**
   * Why the last derivation refused, or `null`.
   *
   * Kept as state rather than thrown: an unknown length unit is a condition of
   * the FILE, not an exception, and the panel has to be able to say so instead
   * of showing an empty list that looks like "no storeys".
   */
  heightSystemError: string | null;
  heightsPanelVisible: boolean;

  setHeightsPanelVisible: (visible: boolean) => void;
  /** Read the storeys from a model and replace the system. Discards edits. */
  deriveHeightSystemFrom: (modelId: string) => boolean;
  setHeightSystem: (system: HeightSystem | null) => void;

  setStoreyElevation: (storeyId: string, elevation: number) => void;
  setStoreyHeightValue: (storeyId: string, height: number) => void;
  renameHeightStorey: (storeyId: string, name: string) => void;
  setHeightDatum: (datum: number | null) => void;
  setHeightReferenceLevels: (levels: readonly ReferenceLevel[]) => void;
  setHeightStoreyLevels: (storeyId: string, levels: readonly ReferenceLevel[] | null) => void;
  addHeightReferenceLevel: (label: string, offset: number) => void;
  removeHeightReferenceLevel: (key: string) => void;
  updateHeightReferenceLevel: (
    key: string, patch: Partial<Pick<ReferenceLevel, 'label' | 'offset'>>,
  ) => void;
}

export const createHeightsSlice: StateCreator<ViewerState, [], [], HeightsSlice> = (set, get) => {
  /** Apply a pure edit to the current system, or do nothing when there is none. */
  const edit = (fn: (system: HeightSystem) => HeightSystem) => {
    const current = get().heightSystem;
    if (!current) return;
    const next = fn(current);
    if (next !== current) set({ heightSystem: next });
  };

  return {
    heightSystem: null,
    heightSystemError: null,
    heightsPanelVisible: false,

    setHeightsPanelVisible: (heightsPanelVisible) => set({ heightsPanelVisible }),
    setHeightSystem: (heightSystem) => set({ heightSystem, heightSystemError: null }),

    deriveHeightSystemFrom: (modelId) => {
      const model = get().models.get(modelId);
      const store = model?.ifcDataStore;
      if (!store) {
        set({ heightSystemError: 'Für dieses Modell liegt keine gelesene IFC-Struktur vor.' });
        return false;
      }

      const { storeys, lengthUnitScale, lengthUnitName } = readRawStoreys(store, modelId);
      const result = deriveHeightSystem({
        fileName: model.name ?? modelId,
        storeys,
        lengthUnitScale,
        lengthUnitName,
        // Carried over so re-deriving does not silently drop a datum and the
        // level names somebody set up.
        datumAboveSeaLevel: get().heightSystem?.datumAboveSeaLevel,
        referenceLevels: get().heightSystem?.referenceLevels,
      });

      if (!result.ok) {
        set({ heightSystem: null, heightSystemError: result.reason });
        return false;
      }
      set({ heightSystem: result.system, heightSystemError: null });
      return true;
    },

    setStoreyElevation: (storeyId, elevation) => edit((s) => setElevation(s, storeyId, elevation)),
    setStoreyHeightValue: (storeyId, height) => edit((s) => setStoreyHeight(s, storeyId, height)),
    renameHeightStorey: (storeyId, name) => edit((s) => setStoreyName(s, storeyId, name)),
    setHeightDatum: (datum) => edit((s) => setDatumAboveSeaLevel(s, datum)),
    setHeightReferenceLevels: (levels) => edit((s) => setReferenceLevels(s, levels)),
    setHeightStoreyLevels: (storeyId, levels) => edit((s) => setStoreyLevels(s, storeyId, levels)),
    addHeightReferenceLevel: (label, offset) => edit((s) => addReferenceLevel(s, label, offset)),
    removeHeightReferenceLevel: (key) => edit((s) => removeReferenceLevel(s, key)),
    updateHeightReferenceLevel: (key, patch) => edit((s) => updateReferenceLevel(s, key, patch)),
  };
};
