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

  setGraphPanelVisible: (visible: boolean) => void;
  toggleGraphPanel: () => void;
  setGraphHighlight: (highlight: GraphHighlight | null) => void;
  setGraphHighlightInView: (on: boolean) => void;
}

export const createGraphSlice: StateCreator<GraphSlice, [], [], GraphSlice> = (set, get) => ({
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
