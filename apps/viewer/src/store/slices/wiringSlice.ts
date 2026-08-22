/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The click sequence the wiring tool is building, before anything is written.
 *
 * # Why this is a run in progress and not a set of picks
 * Every other selection in the viewer is a SET — what is selected, in no
 * particular order. This one is a LIST, and the order is the entire content:
 * it is which detector the cable reaches first, second, third. Storing it in
 * the ordinary selection would lose exactly the information the tool exists to
 * capture, which is why it gets its own state rather than a flag on the other.
 *
 * # Nothing here writes to the model
 * The sequence is a draft. It becomes ports, connections and a circuit only
 * when `wireCircuit` is called with it — one action, one undo step. A tool
 * that wrote a connection per click would leave half a run in the file every
 * time somebody changed their mind, and "changed their mind" is most of what
 * drawing a cable is.
 */

import type { StateCreator } from 'zustand';

export interface WiringSlice {
  /**
   * Devices in the order they were clicked, controller first when one was
   * picked. Empty when no run is being drawn.
   */
  wiringSequence: number[];
  /**
   * The device the cursor is over, or `null`.
   *
   * Kept here rather than in the overlay so the preview line can be drawn to
   * the cursor without the overlay owning a copy of the pick logic.
   */
  wiringHover: number | null;
  /** True while the run is closed back to its start — a ring. */
  wiringRing: boolean;

  /** Append a device. A repeat of the FIRST entry closes the run as a ring. */
  pushWiringPick: (expressId: number) => void;
  /** Undo the last click. */
  popWiringPick: () => void;
  setWiringHover: (expressId: number | null) => void;
  /** Drop the whole draft — the tool was left, or the run abandoned. */
  clearWiring: () => void;
}

export const createWiringSlice: StateCreator<WiringSlice, [], [], WiringSlice> = (set) => ({
  wiringSequence: [],
  wiringHover: null,
  wiringRing: false,

  pushWiringPick: (expressId) => set((state) => {
    const sequence = state.wiringSequence;
    if (sequence.length === 0) return { wiringSequence: [expressId], wiringRing: false };

    // Clicking the start again closes the ring. This is the whole ring/stub
    // decision — nobody declares it up front and then gets it wrong.
    if (expressId === sequence[0]) {
      return { wiringRing: sequence.length > 1, wiringSequence: sequence };
    }
    // A device already on this run is a slip, not an instruction: a detector
    // cannot sit twice on one cable. Ignored rather than appended, because
    // appending would renumber everything after it for a mis-click.
    if (sequence.includes(expressId)) return {};
    // Adding after the ring was closed re-opens it — the run grew.
    return { wiringSequence: [...sequence, expressId], wiringRing: false };
  }),

  popWiringPick: () => set((state) => {
    // Undo takes the ring off first when there is one: the last thing done was
    // closing the loop, so the last thing undone is closing the loop.
    if (state.wiringRing) return { wiringRing: false };
    return { wiringSequence: state.wiringSequence.slice(0, -1) };
  }),

  setWiringHover: (wiringHover) => set({ wiringHover }),

  clearWiring: () => set({ wiringSequence: [], wiringHover: null, wiringRing: false }),
});
