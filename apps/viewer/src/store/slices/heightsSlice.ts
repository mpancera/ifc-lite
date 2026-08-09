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
import { createEmptyHeightSystem, deriveHeightSystem } from '@/lib/heights/derive';
import { readRawStoreys } from '@/lib/heights/read';
import {
  addReferenceLevel, addStorey, removeReferenceLevel, removeStorey, setDatumAboveSeaLevel,
  setElevation, setReferenceLevels, setStoreyHeight, setStoreyLevels, setStoreyName,
  updateReferenceLevel,
} from '@/lib/heights/edit';
import { sameProject as isSameProject, type ProjectKey } from '@ifc-lite/project';
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
  /**
   * Which project the current system belongs to.
   *
   * Beside the system rather than in it: `HeightSystem` is the file format
   * agreed with the reading side, and an id that means nothing there has no
   * business in it. `null` when the project is unknown, which is never treated
   * as a match.
   */
  heightSystemProject: ProjectKey | null;
  heightsPanelVisible: boolean;

  setHeightsPanelVisible: (visible: boolean) => void;
  /** Read the storeys from a model and replace the system. Discards edits. */
  deriveHeightSystemFrom: (modelId: string) => boolean;
  /**
   * Start an empty system, for a project that has drawings but no model yet.
   *
   * Refuses to replace an existing system: that would throw away levels
   * somebody typed, and there is no undo here.
   */
  startManualHeightSystem: () => boolean;
  addHeightStorey: (name: string, elevation: number) => void;
  removeHeightStorey: (storeyId: string) => void;
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
    heightSystemProject: null,
    heightsPanelVisible: false,

    setHeightsPanelVisible: (heightsPanelVisible) => set({ heightsPanelVisible }),
    setHeightSystem: (heightSystem) => set({
      heightSystem, heightSystemError: null, heightSystemProject: get().currentProjectKey(),
    }),

    deriveHeightSystemFrom: (modelId) => {
      const model = get().models.get(modelId);
      const store = model?.ifcDataStore;
      if (!store) {
        set({ heightSystemError: 'Für dieses Modell liegt keine gelesene IFC-Struktur vor.' });
        return false;
      }

      const fileName = model.name ?? modelId;
      const { storeys, lengthUnitScale, lengthUnitName } = readRawStoreys(store, modelId);

      // Carry the datum and the level names forward when re-deriving the SAME
      // project, so an update does not throw away what somebody set up — but
      // NOT across projects. Different buildings sit on different sites;
      // inheriting one's height above sea level into another would be a wrong
      // number that looks like a filled-in field.
      //
      // Decided on the PROJECT KEY, not on the file name. The file name was a
      // stand-in from before there was a project: it treats a renamed file as
      // a new project and, worse, two projects that both call their
      // architecture model the same thing as one.
      //
      // The key is held BESIDE the system rather than inside it: `HeightSystem`
      // is a file format agreed with the reading side, and an id that means
      // nothing there does not belong in it.
      const previous = get().heightSystem;
      const projectKey = get().currentProjectKey();
      const sameProject = previous !== null
        && isSameProject(get().heightSystemProject, projectKey);

      const result = deriveHeightSystem({
        fileName,
        storeys,
        lengthUnitScale,
        lengthUnitName,
        datumAboveSeaLevel: sameProject ? previous?.datumAboveSeaLevel : undefined,
        referenceLevels: sameProject ? previous?.referenceLevels : undefined,
      });

      if (!result.ok) {
        set({ heightSystem: null, heightSystemError: result.reason, heightSystemProject: null });
        return false;
      }
      set({ heightSystem: result.system, heightSystemError: null, heightSystemProject: projectKey });
      return true;
    },

    startManualHeightSystem: () => {
      if (get().heightSystem) return false;
      set({
        heightSystem: createEmptyHeightSystem(),
        heightSystemError: null,
        heightSystemProject: get().currentProjectKey(),
      });
      return true;
    },
    addHeightStorey: (name, elevation) => edit((s) => addStorey(s, { name, elevation })),
    removeHeightStorey: (storeyId) => edit((s) => removeStorey(s, storeyId)),

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
