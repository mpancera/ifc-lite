/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * List state slice - configurable property tables from IFC data
 */

import type { StateCreator } from 'zustand';
import type { ListDefinition, ListResult } from '@ifc-lite/lists';
import { loadListDefinitions, saveListDefinitions } from '../../lib/lists/persistence.js';

export interface ListSlice {
  // State
  listDefinitions: ListDefinition[];
  activeListId: string | null;
  listResult: ListResult | null;
  listPanelVisible: boolean;
  listExecuting: boolean;
  /** A list definition handed off from elsewhere (e.g. "Create list" in the
   *  search filter) for the ListPanel to open straight into the builder. */
  pendingListDraft: ListDefinition | null;
  /**
   * Export the list currently on screen, in this format. Consumed once and
   * cleared by the table, the same handoff the role dialog uses.
   *
   * The export model is built from what the table is showing — configured
   * columns, the active grouping, the totals — so it can only be assembled
   * there. This lets a caller ask for it anyway, which is what a demo of
   * "the list leaves as a file" needs, without a second and inevitably
   * divergent model builder somewhere else.
   */
  listExportRequested: 'csv' | 'xlsx' | 'pdf' | null;
  /**
   * Run this list and show its result. Consumed once and cleared by the panel.
   *
   * Distinct from `pendingListDraft`, which opens the BUILDER: handing a
   * definition over to be edited and handing one over to be answered are
   * different intentions, and one field carrying both would need a second
   * field to say which.
   */
  runListRequested: ListDefinition | null;

  // Actions
  setListDefinitions: (definitions: ListDefinition[]) => void;
  addListDefinition: (definition: ListDefinition) => void;
  updateListDefinition: (id: string, updates: Partial<ListDefinition>) => void;
  deleteListDefinition: (id: string) => void;
  setActiveListId: (id: string | null) => void;
  setListResult: (result: ListResult | null) => void;
  setListPanelVisible: (visible: boolean) => void;
  requestListExport: (format: 'csv' | 'xlsx' | 'pdf' | null) => void;
  requestListRun: (definition: ListDefinition | null) => void;
  toggleListPanel: () => void;
  setListExecuting: (executing: boolean) => void;
  setPendingListDraft: (definition: ListDefinition | null) => void;
}

export const createListSlice: StateCreator<ListSlice, [], [], ListSlice> = (set, get) => ({
  // Initial state - load saved definitions
  listDefinitions: loadListDefinitions(),
  activeListId: null,
  listResult: null,
  listPanelVisible: false,
  listExecuting: false,
  pendingListDraft: null,
  listExportRequested: null,
  runListRequested: null,

  // Actions
  setListDefinitions: (listDefinitions) => {
    set({ listDefinitions });
    saveListDefinitions(listDefinitions);
  },

  addListDefinition: (definition) => {
    const updated = [...get().listDefinitions, definition];
    set({ listDefinitions: updated });
    saveListDefinitions(updated);
  },

  updateListDefinition: (id, updates) => {
    const updated = get().listDefinitions.map(d =>
      d.id === id ? { ...d, ...updates, updatedAt: Date.now() } : d
    );
    set({ listDefinitions: updated });
    saveListDefinitions(updated);
  },

  deleteListDefinition: (id) => {
    const updated = get().listDefinitions.filter(d => d.id !== id);
    const activeListId = get().activeListId === id ? null : get().activeListId;
    const listResult = get().activeListId === id ? null : get().listResult;
    set({ listDefinitions: updated, activeListId, listResult });
    saveListDefinitions(updated);
  },

  setActiveListId: (activeListId) => set({ activeListId }),
  setListResult: (listResult) => set({ listResult }),
  setListPanelVisible: (listPanelVisible) => set({ listPanelVisible }),
  requestListExport: (listExportRequested) => set({ listExportRequested }),
  requestListRun: (runListRequested) => set({ runListRequested }),
  toggleListPanel: () => set((state) => ({ listPanelVisible: !state.listPanelVisible })),
  setListExecuting: (listExecuting) => set({ listExecuting }),
  setPendingListDraft: (pendingListDraft) => set({ pendingListDraft }),
});
