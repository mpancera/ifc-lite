/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Whether the viewer is showing a building or a plan.
 *
 * Not a camera preset. A top-down camera over a 3D scene still foreshortens,
 * still lets elements at different heights drift apart on screen, and still
 * picks whatever is nearest the eye rather than what is on the floor being
 * worked on. Somebody working from plans notices all three immediately.
 *
 * Plan mode is therefore its own mode: one storey at a time, cut at a stated
 * height, orthographic, no orbit. It sits ALONGSIDE the existing 2D Section
 * tool rather than replacing it — that one answers "what does a section
 * through this look like", which is a different question from "let me work on
 * this floor".
 *
 * The mode is deliberately thin state. Everything that reads it — the camera,
 * the storey isolation, the cut — stays where it already lives, so a tool that
 * knows nothing about plan mode keeps working unchanged.
 */

import { type StateCreator } from 'zustand';
import type { ViewerState } from '../index.js';

export type ViewMode = '3d' | '2d';

/**
 * Where the plan is cut, in metres above the storey's finished floor level.
 *
 * 1.25 m is the drafting convention: above a window sill and below a door
 * head, so both appear the way a plan is read. Adjustable, because a building
 * with high sills or a mezzanine needs a different height and a fixed value
 * would quietly cut through the wrong things.
 */
export const DEFAULT_PLAN_CUT_HEIGHT = 1.25;

export interface ViewModeSlice {
  viewMode: ViewMode;
  /** Which storey the plan shows. `null` until one is chosen. */
  planStoreyId: string | null;
  /** Metres above the storey's finished floor. */
  planCutHeight: number;

  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setPlanStorey: (storeyId: string | null) => void;
  setPlanCutHeight: (metres: number) => void;
}

export const createViewModeSlice: StateCreator<ViewerState, [], [], ViewModeSlice> = (set, get) => ({
  viewMode: '3d',
  planStoreyId: null,
  planCutHeight: DEFAULT_PLAN_CUT_HEIGHT,

  setViewMode: (viewMode) => {
    if (get().viewMode === viewMode) return;
    set({ viewMode });
  },
  toggleViewMode: () => set({ viewMode: get().viewMode === '2d' ? '3d' : '2d' }),

  setPlanStorey: (planStoreyId) => set({ planStoreyId }),

  // Refuses a non-finite value rather than defaulting to zero: a cut at the
  // floor shows the slab and nothing else, which reads as a broken plan.
  setPlanCutHeight: (metres) => {
    if (Number.isFinite(metres)) set({ planCutHeight: metres });
  },
});
