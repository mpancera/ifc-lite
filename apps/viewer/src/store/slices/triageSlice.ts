/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which of the three cleaning panels owns the docked sidebar slot.
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
  /**
   * Doors whose defining room somebody chose by hand, keyed by door.
   *
   * The numbering derives the room from the escape direction and says so; two
   * rooms equally far from the way out have no direction between them, and
   * where the model states no swing either there is nothing left to derive
   * from. That is a decision only a person can make, so it is kept here rather
   * than guessed — and kept OUTSIDE the model, because it is an input to the
   * numbering, not a statement about the building.
   */
  doorNumberRoom: ReadonlyMap<number, number>;
  setDoorNumberRoom: (doorId: number, roomId: number) => void;
  clearDoorNumberRoom: (doorId: number) => void;

  proxyTriagePanelVisible: boolean;
  classTriagePanelVisible: boolean;
  roomTriagePanelVisible: boolean;
  doorNumbersPanelVisible: boolean;
  setProxyTriagePanelVisible: (visible: boolean) => void;
  setClassTriagePanelVisible: (visible: boolean) => void;
  setRoomTriagePanelVisible: (visible: boolean) => void;
  setDoorNumbersPanelVisible: (visible: boolean) => void;
}

export const createTriageSlice: StateCreator<ViewerState, [], [], TriageSlice> = (set) => ({
  doorNumberRoom: new Map<number, number>(),
  setDoorNumberRoom: (doorId, roomId) => set((state) => {
    const next = new Map(state.doorNumberRoom);
    next.set(doorId, roomId);
    return { doorNumberRoom: next };
  }),
  clearDoorNumberRoom: (doorId) => set((state) => {
    if (!state.doorNumberRoom.has(doorId)) return {};
    const next = new Map(state.doorNumberRoom);
    next.delete(doorId);
    return { doorNumberRoom: next };
  }),

  proxyTriagePanelVisible: false,
  classTriagePanelVisible: false,
  roomTriagePanelVisible: false,
  doorNumbersPanelVisible: false,
  setProxyTriagePanelVisible: (proxyTriagePanelVisible) => set({ proxyTriagePanelVisible }),
  setClassTriagePanelVisible: (classTriagePanelVisible) => set({ classTriagePanelVisible }),
  setRoomTriagePanelVisible: (roomTriagePanelVisible) => set({ roomTriagePanelVisible }),
  setDoorNumbersPanelVisible: (doorNumbersPanelVisible) => set({ doorNumbersPanelVisible }),
});
