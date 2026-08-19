/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Playback state for a screenflow, in its own zustand store for the same
 * reason the tour engine has one: `resetViewerState` runs inside every
 * `loadFile`, and a clip's first beat IS a file load. State kept in a viewer
 * slice would be wiped exactly when the clip starts.
 */

import { create } from 'zustand';
import type { BeatFrame, ScreenflowMode, ScreenflowStatus } from './types';
import type { IfcStoreyLocalPoint } from './worldPointer';

export interface ScreenflowUiState {
  status: ScreenflowStatus;
  /** Recording (no controls, fixed pacing) or presenting (held on command). */
  mode: ScreenflowMode;
  clipId: string | null;
  beatIndex: number;
  /** How many beats the running clip has, for the presenter's counter. */
  beatCount: number;
  /** Presenting only: the clip is holding on the current beat. */
  paused: boolean;
  /** Presenting only: replaying earlier beats at speed to reach a chapter. */
  seeking: boolean;
  /** Caption currently burned into the picture (German). */
  caption: string;
  frame: BeatFrame;
  /** Resolved element the pointer travels to; null means no pointer. */
  pointerTarget: HTMLElement | null;
  /** A building coordinate to point at instead of an element (IFC storey-local
   *  metres), with the storey its Z is measured from. */
  pointerWorld: { point: IfcStoreyLocalPoint; storeyId: number; modelId: string } | null;
  /** True while the pointer's click ring is animating. */
  clicking: boolean;
  /** Set when a beat ended on its timeout instead of on its proof. */
  faults: string[];
  /** Files the clip needs that are not in public/demo-local. */
  missingFiles: string[];
}

const INITIAL: ScreenflowUiState = {
  status: 'idle',
  mode: 'record',
  clipId: null,
  beatIndex: 0,
  beatCount: 0,
  paused: false,
  seeking: false,
  caption: '',
  frame: 'live',
  pointerTarget: null,
  pointerWorld: null,
  clicking: false,
  faults: [],
  missingFiles: [],
};

export const useScreenflowStore = create<ScreenflowUiState>()(() => ({ ...INITIAL }));

export function patchScreenflowState(patch: Partial<ScreenflowUiState>): void {
  useScreenflowStore.setState(patch);
}

export function resetScreenflowState(): void {
  useScreenflowStore.setState({ ...INITIAL });
}
