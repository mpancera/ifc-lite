/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Whether the Housekeeping panel owns the docked sidebar slot.
 *
 * One flag and its setter, and nothing else: the plan itself is computed by
 * `useHousekeeping` from the model and needs no store state, and which
 * findings the user accepted lives with the project rather than with the
 * session (see `lib/housekeeping/acceptedFindings`).
 *
 * A slice for one boolean rather than a boolean squeezed into a neighbouring
 * slice, because `SIDEBAR_PANEL_FLAGS` pairs every docked side panel with a
 * flag named after it, and a test holds that table against the panel registry.
 * A panel registered without its flag is iconed, rendered — and impossible to
 * open; that is how the Compartments panel looked like a dead feature for
 * months, and the test exists to stop it happening twice.
 */

import { type StateCreator } from 'zustand';
import type { ViewerState } from '../index.js';

export interface HousekeepingSlice {
  housekeepingPanelVisible: boolean;
  setHousekeepingPanelVisible: (visible: boolean) => void;
  toggleHousekeepingPanel: () => void;
}

export const createHousekeepingSlice: StateCreator<
  ViewerState, [], [], HousekeepingSlice
> = (set) => ({
  housekeepingPanelVisible: false,
  setHousekeepingPanelVisible: (housekeepingPanelVisible) => set({ housekeepingPanelVisible }),
  toggleHousekeepingPanel: () => set((s) => ({
    housekeepingPanelVisible: !s.housekeepingPanelVisible,
  })),
});
