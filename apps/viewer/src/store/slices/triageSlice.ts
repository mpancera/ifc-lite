/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which of the two class-cleaning panels owns the docked sidebar slot.
 *
 * Both were dialogs first, and both had to stop being dialogs for the same
 * reason: deciding what a group of elements IS means looking at them. A dialog
 * covers the viewport, so the one thing that would settle the question was
 * behind the window asking it (Marc, 2026-08-15). As side panels they can
 * isolate their selection in the model and stand next to it.
 *
 * Two flags rather than one shared "triage" flag: the sidebar is
 * single-tenant and `SIDEBAR_PANEL_FLAGS` pairs each panel id with a flag
 * named after it, so one flag for two ids would break the exclusivity
 * bookkeeping that decides which panel is showing.
 */

import { type StateCreator } from 'zustand';
import type { ViewerState } from '../index.js';

export interface TriageSlice {
  proxyTriagePanelVisible: boolean;
  classTriagePanelVisible: boolean;
  setProxyTriagePanelVisible: (visible: boolean) => void;
  setClassTriagePanelVisible: (visible: boolean) => void;
}

export const createTriageSlice: StateCreator<ViewerState, [], [], TriageSlice> = (set) => ({
  proxyTriagePanelVisible: false,
  classTriagePanelVisible: false,
  setProxyTriagePanelVisible: (proxyTriagePanelVisible) => set({ proxyTriagePanelVisible }),
  setClassTriagePanelVisible: (classTriagePanelVisible) => set({ classTriagePanelVisible }),
});
