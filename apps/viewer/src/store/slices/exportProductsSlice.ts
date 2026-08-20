/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The delivery list: what this project gets issued as.
 *
 * Thin, like `planProductsSlice`: it holds the list and the run state, and
 * every rule about what a product may be lives in `lib/exportProducts`, where
 * it is testable without a store.
 *
 * The RUN itself is not here. Producing a drawing needs the canvas and the
 * export hook, which are React, so `useExportBatch` drives the run and reports
 * progress back through the two fields below. A slice that tried to own it
 * would have to reach into the component tree.
 */

import type { StateCreator } from 'zustand';
import type { ViewerState } from '../index.js';
import type { ExportProduct, ExportFormat } from '@/lib/exportProducts/exportProducts';
import {
  isFormatValid, newGraphExportProduct, newListExportProduct, newPlan2DProduct,
} from '@/lib/exportProducts/exportProducts';
import {
  loadExportProducts, saveExportProducts, nextProductId,
} from '@/lib/exportProducts/exportProductsStorage';
import { findProduct } from '@/lib/planProducts/planProducts';

/** What a batch run is doing right now. */
export interface ExportRunState {
  /** `null` when nothing is running. */
  readonly runningProductId: string | null;
  /** How many products the current run has finished. */
  readonly done: number;
  /** How many it set out to produce. */
  readonly total: number;
  /** Product id to the reason it failed, for the run just finished. */
  readonly failures: Readonly<Record<string, string>>;
}

const IDLE: ExportRunState = {
  runningProductId: null, done: 0, total: 0, failures: {},
};

export interface ExportProductsSlice {
  /**
   * Whether the panel owns the docked side slot.
   *
   * Every docked side panel needs a flag of its own: `openWorkspacePanel`
   * sets them BY NAME, so a panel without one cannot be opened from any
   * entry point — not the rail, not the palette — and reads as a dead
   * feature with no error anywhere.
   */
  exportsPanelVisible: boolean;
  setExportsPanelVisible: (visible: boolean) => void;

  exportProducts: readonly ExportProduct[];
  /** Which project the list was loaded for. */
  exportProductsProject: string | null;
  exportRun: ExportRunState;

  restoreExportProductsForProject: () => void;
  /** Add a drawing product for a plan product. No-op if the plan is unknown. */
  addPlan2DExportProduct: (planProductId: string) => void;
  /** Add a list product for a saved list. No-op if the list is unknown. */
  addListExportProduct: (listId: string) => void;
  /**
   * Add a diagram product from the chain the graph panel is showing.
   *
   * A snapshot rather than a picker over some catalogue of diagrams, because
   * there is no such catalogue: a diagram IS a chain plus the classes the walk
   * starts from, and both are things somebody sets up by looking at the
   * result. This is the same move as adding a plan product that was already
   * configured.
   */
  addGraphExportProduct: (name: string) => void;
  removeExportProduct: (id: string) => void;
  renameExportProduct: (id: string, name: string) => void;
  setExportProductFormat: (id: string, format: ExportFormat) => void;
  setExportProductInBatch: (id: string, inBatch: boolean) => void;
  setExportProductStorey: (id: string, storeyId: number | null) => void;
  /** Move a product up or down, since batch order is the issuing order. */
  moveExportProduct: (id: string, direction: -1 | 1) => void;

  /** Called by `useExportBatch` as a run proceeds. */
  beginExportRun: (total: number) => void;
  reportExportProduct: (id: string, failure?: string) => void;
  endExportRun: () => void;
}

export const createExportProductsSlice: StateCreator<
  ViewerState, [], [], ExportProductsSlice
> = (set, get) => {
  /** Write through to storage on every change: the list is small and a lost
   *  delivery list is worse than a few extra writes. */
  const commit = (products: readonly ExportProduct[]) => {
    set({ exportProducts: products });
    saveExportProducts(get().currentProjectKey(), products);
  };

  const update = (id: string, change: (product: ExportProduct) => ExportProduct) => {
    commit(get().exportProducts.map((p) => (p.id === id ? change(p) : p)));
  };

  return {
    exportsPanelVisible: false,
    setExportsPanelVisible: (exportsPanelVisible) => set({ exportsPanelVisible }),

    exportProducts: [],
    exportProductsProject: null,
    exportRun: IDLE,

    restoreExportProductsForProject: () => {
      const project = get().currentProjectKey();
      if (project === null) return;
      if (get().exportProductsProject === project) return;
      set({
        exportProductsProject: project,
        exportProducts: loadExportProducts(project),
        exportRun: IDLE,
      });
    },

    addPlan2DExportProduct: (planProductId) => {
      const plan = findProduct(get().planProducts, planProductId);
      // Silently adding a product pointing at nothing would put a permanently
      // broken row in the list.
      if (!plan) return;

      const products = get().exportProducts;
      commit([...products, newPlan2DProduct(plan, nextProductId(products, 'plan'))]);
    },

    addListExportProduct: (listId) => {
      const list = get().listDefinitions.find((candidate) => candidate.id === listId);
      // Same reasoning as above: a row pointing at nothing is a row that can
      // never be issued, and nothing would say so until the run.
      if (!list) return;

      const products = get().exportProducts;
      commit([...products, newListExportProduct(list, nextProductId(products, 'list'))]);
    },

    addGraphExportProduct: (name) => {
      const { graphChainId, graphStartTypes } = get();
      // No starts means an empty diagram, and an empty diagram reads as an
      // answer. Refused here rather than saved and blocked later.
      if (!graphChainId || graphStartTypes.length === 0) return;

      const products = get().exportProducts;
      commit([...products, newGraphExportProduct(
        { id: graphChainId, name },
        graphStartTypes,
        nextProductId(products, 'graph'),
      )]);
    },

    removeExportProduct: (id) => {
      commit(get().exportProducts.filter((product) => product.id !== id));
    },

    renameExportProduct: (id, name) => {
      const trimmed = name.trim();
      // An empty name yields an empty filename; the product keeps its old one.
      if (!trimmed) return;
      update(id, (product) => ({ ...product, name: trimmed }));
    },

    setExportProductFormat: (id, format) => {
      update(id, (product) => (
        isFormatValid(product.kind, format) ? { ...product, format } : product
      ));
    },

    setExportProductInBatch: (id, inBatch) => {
      update(id, (product) => ({ ...product, inBatch }));
    },

    setExportProductStorey: (id, storeyId) => {
      update(id, (product) => (
        product.kind === 'plan2d' ? { ...product, storeyId } : product
      ));
    },

    moveExportProduct: (id, direction) => {
      const products = [...get().exportProducts];
      const from = products.findIndex((product) => product.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= products.length) return;

      [products[from], products[to]] = [products[to], products[from]];
      commit(products);
    },

    beginExportRun: (total) => {
      set({ exportRun: { runningProductId: null, done: 0, total, failures: {} } });
    },

    reportExportProduct: (id, failure) => {
      const run = get().exportRun;
      set({
        exportRun: {
          ...run,
          runningProductId: id,
          done: run.done + 1,
          failures: failure ? { ...run.failures, [id]: failure } : run.failures,
        },
      });
    },

    // Failures survive the run so the panel can still show what went wrong;
    // only the "currently working on" marker is cleared.
    endExportRun: () => {
      set({ exportRun: { ...get().exportRun, runningProductId: null } });
    },
  };
};
