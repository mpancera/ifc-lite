/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A screenflow is a clip that plays ITSELF: the app performs the actions, the
 * captions narrate them, and a screen recorder catches the result. It is the
 * sibling of a tour, not a variant of one, and the difference is the whole
 * point.
 *
 * # A tour waits for the user; a clip must never wait
 * Tour steps are task-gated on purpose -- nothing advances until the person
 * really did the thing. A recording has no person. So a beat performs the
 * action itself and then waits for the app to prove it landed (`settled`),
 * with a timeout, because a clip that stalls in front of a running recorder
 * produces a minute of dead video and no error. The timeout is not a
 * shortcut around a broken gate: it is recorded as a fault, so a clip that
 * needed it is known to be wrong before it reaches a presentation.
 *
 * # Two languages on one timeline
 * The German caption is burned into the picture, the English one is written
 * out as a subtitle sidecar over the same measured timings. One beat is one
 * cue in both, which is why both texts live on the beat itself rather than in
 * a translation file that could fall a beat out of step.
 *
 * # Why clips are not in the tour registry
 * Tour copy is English and ASCII-only (there is a test for it) because it is
 * product UI. Clip copy is German prose for a specific audience and a specific
 * model. Keeping them in separate registries keeps the Learn hub free of
 * demo material and lets each carry the copy rule it actually has.
 */

import type { ViewerState } from '@/store';
import type { WorkspacePanelId } from '@/lib/panels/registry';
import type { TourAnchorId } from '@/lib/tours/anchors';
import type { DemoFileId } from './dataset';
import type { IfcStoreyLocalPoint } from './worldPointer';

export type ScreenflowStoreApi = typeof import('@/store').useViewerStore;

/** What the stage shows behind the caption while a beat runs. */
export type BeatFrame =
  /** Caption over the live app; the normal case. */
  | 'live'
  /** Full-bleed card: clip title, or the closing statement. */
  | 'card';

export interface ScreenflowBeat {
  id: string;
  /** Burned into the picture. German, umlauts welcome. */
  captionDe: string;
  /** Same beat, written out as an English subtitle cue. */
  captionEn: string;
  frame?: BeatFrame;
  /** Overrides the reading-time hold. Use for a beat whose action is the
   *  content (a long camera move) rather than the caption. */
  holdMs?: number;
  /** UI element the pointer travels to before the action runs. The pointer is
   *  drawn by the stage; it is a picture of the click, not the click itself,
   *  because a synthetic DOM click would test the UI rather than show it. */
  anchor?: TourAnchorId;
  /**
   * A place in the building to point at, in IFC storey-local metres — the
   * same numbers the builders take. Use instead of `anchor` for the work that
   * happens in the 3D view, where there is no element to ring.
   *
   * The point's Z is measured from a storey floor. Name the storey with
   * `worldStoreyId` when the model has several; a clip that builds its own
   * project leaves it out and gets the only storey there is.
   */
  worldPoint?: IfcStoreyLocalPoint;
  /** Storey the `worldPoint` is local to. Defaults to the first one. */
  worldStoreyId?: number;
  /** Panel that must be docked and open for `anchor` to resolve. */
  panel?: WorkspacePanelId;
  /** Idempotent setup before the caption appears (open a panel, clear state). */
  prepare?: (store: ScreenflowStoreApi) => void | Promise<void>;
  /** The action itself, run after the caption has been readable for `holdMs`. */
  perform?: (store: ScreenflowStoreApi) => void | Promise<void>;
  /** Proof the action landed. Polled after `perform`; the beat ends on true. */
  settled?: (state: ViewerState) => boolean;
  /** How long `settled` may take before the beat gives up and reports a
   *  fault. Generous for loads, short for UI state. Default 8000. */
  settleTimeoutMs?: number;
}

export interface ScreenflowClip {
  id: string;
  /** Position in the series (1..9); shown on the title card and in filenames. */
  number: number;
  /** Local demo files this clip cannot play without; checked before the
   *  first beat so a missing one is a refusal, not a dead take. */
  requires?: readonly DemoFileId[];
  titleDe: string;
  titleEn: string;
  /** The one sentence this clip exists to prove, shown under the title. */
  messageDe: string;
  messageEn: string;
  /** Bump when the beats change enough that an old recording is stale. */
  version: number;
  /** Data the clip needs on screen before beat one. Runs before recording
   *  matters, so it may be slow. */
  setup?: (store: ScreenflowStoreApi) => Promise<void>;
  beats: ScreenflowBeat[];
}

/** Measured, not planned: what the beat actually took while recording. */
export interface BeatTimeline {
  beatId: string;
  captionDe: string;
  captionEn: string;
  startMs: number;
  endMs: number;
  /** The beat ended on its timeout instead of on `settled`. */
  timedOut: boolean;
}

export type ScreenflowStatus = 'idle' | 'arming' | 'playing' | 'done';

/**
 * What the clip is being played for.
 *
 * `record` is the original: no controls anywhere, fixed pacing, because every
 * pixel ends up in a video and a button in frame invites the audience to
 * wonder who is pressing it.
 *
 * `present` is the same beats shown live. It needs the opposite: the presenter
 * talks over it, so it must hold on command; they may want to skip ahead; and
 * a beat that fails must be visible to them without becoming a red card in
 * front of the room. Same clip definitions either way — that separation is the
 * whole reason this is a mode and not a second set of clips.
 */
export type ScreenflowMode = 'record' | 'present';
