/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The schematic panel's state — and, more importantly, what it is currently
 * showing.
 *
 * `graphHighlight` is the whole reason this is store state rather than local
 * panel state: the drawing and the model answer each other. What the graph
 * draws is highlighted in the viewport and everything else fades back, so a
 * detector picked out of a system can be found in the building without
 * hunting. The panel writes it; `useGraphOverlay` reads it and paints. Neither
 * knows about the other.
 *
 * Deliberately express ids plus the model they belong to, not global ids: the
 * graph is scoped to one model (see `graphSourceFor`), and converting at the
 * point of painting keeps the federation rule in exactly one place.
 */

import type { StateCreator } from 'zustand';

export interface GraphHighlight {
  modelId: string;
  /** Express ids of the elements the drawing currently contains. */
  expressIds: number[];
}

export interface GraphSlice {
  graphPanelVisible: boolean;
  /** What the graph is drawing, or `null` when it is drawing nothing. */
  graphHighlight: GraphHighlight | null;
  /**
   * Whether the drawing reaches into the viewport at all.
   *
   * On by default — the connection is the point of docking the graph beside
   * the model rather than over it. Off for the case where someone wants to
   * read the schematic while leaving the model exactly as they had it.
   */
  graphHighlightInView: boolean;

  /**
   * What the drawing is OF: which chain, and what it starts from.
   *
   * In the store rather than in the panel because it is a choice about the
   * model, not about a mounted component. It survives closing the panel, and
   * it is drivable from outside — a screenflow that wants to show the block
   * schema has to be able to ask for one, and component state cannot be
   * asked. `graphStartTypes` feeds the type-picking chains, `graphStartSystems`
   * the system-picking ones; only one is ever in play.
   */
  graphChainId: string;
  graphStartTypes: string[];
  graphStartSystems: number[];

  setGraphChainId: (id: string) => void;
  setGraphStartTypes: (types: string[]) => void;
  setGraphStartSystems: (systems: number[]) => void;
  /** Both start sets at once, for a model swap: express ids and type names
   *  both belong to the model they came from. */
  clearGraphStarts: () => void;
  /**
   * Write the drawn chain out in this format. Consumed once by the panel.
   *
   * The chain and the graph are built in the panel from the store plus the
   * overlay, and the file is that graph — a caller assembling it elsewhere
   * would export a different diagram from the one on screen.
   */
  /**
   * A pending export request, or `null`. `preplanning` is the object-per-row
   * list a schematic tool imports; see `packages/graph/src/preplanning.ts`.
   */
  graphExportRequested: 'csv' | 'json' | 'preplanning' | null;
  requestGraphExport: (format: 'csv' | 'json' | 'preplanning' | null) => void;

  setGraphPanelVisible: (visible: boolean) => void;
  toggleGraphPanel: () => void;
  setGraphHighlight: (highlight: GraphHighlight | null) => void;
  setGraphHighlightInView: (on: boolean) => void;
}

export const createGraphSlice: StateCreator<GraphSlice, [], [], GraphSlice> = (set, get) => ({
  graphChainId: 'zone',
  graphStartTypes: [],
  graphStartSystems: [],
  setGraphChainId: (graphChainId) => set({ graphChainId }),
  setGraphStartTypes: (graphStartTypes) => set({ graphStartTypes }),
  setGraphStartSystems: (graphStartSystems) => set({ graphStartSystems }),
  clearGraphStarts: () => set({ graphStartTypes: [], graphStartSystems: [] }),
  graphExportRequested: null,
  requestGraphExport: (graphExportRequested) => set({ graphExportRequested }),

  graphPanelVisible: false,
  graphHighlight: null,
  graphHighlightInView: true,

  setGraphPanelVisible: (graphPanelVisible) => {
    // Closing the panel drops the highlight with it. A model left half-faded
    // by a drawing that is no longer on screen is a state nobody can explain
    // or undo — the overlay's teardown depends on this.
    set(graphPanelVisible ? { graphPanelVisible } : { graphPanelVisible, graphHighlight: null });
  },
  toggleGraphPanel: () => get().setGraphPanelVisible(!get().graphPanelVisible),
  setGraphHighlight: (graphHighlight) => set({ graphHighlight }),
  setGraphHighlightInView: (graphHighlightInView) => set({ graphHighlightInView }),
});
