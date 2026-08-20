/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The clip player: a module singleton, like the tour controller, so a URL
 * parameter or a command-palette entry can start a clip without a component
 * in the way.
 *
 * # The shape of one beat
 * prepare -> caption up -> pointer travels to the anchor -> hold for reading
 * -> perform -> wait for proof -> settle -> next. The hold comes BEFORE the
 * action on purpose: in a silent clip the caption is the sentence and the
 * action is the demonstration, and a demonstration that runs before its
 * sentence has been read is just motion.
 *
 * # Two ways a beat can be wrong, both recorded
 * Its action can fail to land (the `settled` proof times out), and its anchor
 * can be missing -- a caption about a row that is not on screen. Both are
 * faults on the end card, because both produce a recording that plays
 * perfectly and shows the wrong thing.
 *
 * # Waiting for proof, with a deadline
 * After `perform`, the beat waits for `settled` -- the app's own state saying
 * the thing happened. Without a deadline a clip in front of a running
 * recorder can sit forever; with a silent deadline, a broken clip looks fine
 * and ships. So the deadline exists AND is recorded as a fault, surfaced on
 * the end card. A clip with faults is not a clip to present.
 *
 * # Timings are measured
 * Every beat's real start and end are kept, and the subtitle files are built
 * from those, not from the plan. See `srt.ts`.
 */

import { getViewerStoreApi } from '@/store';
import type { ViewerState } from '@/store';
import { resolveAnchor } from '@/lib/tours/anchor-resolver';
import { applyCaptionOverrides, loadCaptionOverrides } from './captions';
import { DEMO_FILES, missingDemoFiles } from './dataset';
import { beatHoldMs, SETTLE_MS } from './pacing';
import { getClip } from './registry';
import { patchScreenflowState, resetScreenflowState, useScreenflowStore } from './screenflow-store';
import type { BeatTimeline, ScreenflowBeat, ScreenflowClip, ScreenflowMode } from './types';

const DEFAULT_SETTLE_TIMEOUT_MS = 8000;
/** The pointer's travel to its anchor, and the pause on the click ring. */
export const POINTER_TRAVEL_MS = 700;
export const POINTER_CLICK_MS = 320;

interface Run {
  clip: ScreenflowClip;
  mode: ScreenflowMode;
  startedAt: number;
  timeline: BeatTimeline[];
  cancelled: boolean;
  /** Presenting: the clip holds here until the presenter says otherwise. */
  paused: boolean;
  /** Presenting: beats to replay at speed before presenting resumes. */
  seekUntil: number;
  /** Hold the moment the replay above finishes. */
  pauseAfterSeek: boolean;
  /** Resolves the beat's current wait early -- "get on with it". */
  advance: (() => void) | null;
}

let run: Run | null = null;

/**
 * Wait, but under the presenter's control.
 *
 * Polled rather than a single timer because the wait has to survive being
 * paused: a timer that is cancelled and re-armed has to carry its own
 * remaining time, and the arithmetic for that is the kind that ends up one
 * beat out. Recording never calls this -- there the pacing must be the pacing
 * the subtitles were measured against, so it keeps the plain sleep.
 */
function pacedWait(ms: number, r: Run): Promise<void> {
  const step = 80;
  return new Promise((resolve) => {
    let remaining = ms;
    const done = () => { r.advance = null; resolve(); };
    r.advance = done;
    const tick = () => {
      if (r.cancelled || r.advance !== done) { resolve(); return; }
      if (!r.paused) remaining -= step;
      if (remaining <= 0) { done(); return; }
      window.setTimeout(tick, step);
    };
    window.setTimeout(tick, step);
  });
}

/** Sleep for a beat: exact while recording, interruptible while presenting. */
function beatWait(ms: number, r: Run): Promise<void> {
  if (r.mode === 'record') return sleep(ms);
  if (r.seekUntil > 0) return Promise.resolve();
  return pacedWait(ms, r);
}

export function isPlaying(): boolean {
  return run !== null && !run.cancelled;
}

/** Measured timings of the last clip that played; the source for the SRTs. */
let lastRun: { clip: ScreenflowClip; timeline: BeatTimeline[] } | null = null;

export function getLastRun(): { clip: ScreenflowClip; timeline: readonly BeatTimeline[] } | null {
  return lastRun;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

/** How a beat's wait for its proof ended. */
type ProofResult = 'held' | 'timeout' | 'skipped';

/**
 * Resolve when `predicate` holds.
 *
 * Three outcomes, and the third is why this is not a boolean. `timeout` is a
 * fault: the action did not land and the recording would show a caption over
 * an interface that never changed. `skipped` is the presenter pressing on
 * during a slow model load -- a decision, not a defect, and recording it as
 * one would put an amber dot on every demo given over a coffee break.
 */
/**
 * Wait until the beat's proof holds, or give up and record a fault.
 *
 * # A proof must be a function of the VIEWER STORE
 * The predicate is evaluated once up front and then only when the store
 * changes. A proof that reads anything else — a module variable, the DOM, a
 * React state — is checked once, before the work it is waiting for has landed,
 * and then never again: the beat times out however well it actually worked,
 * and the fault says the opposite of what happened. If the thing to wait for
 * is not store state, make it store state; the plan's `planFitVersion` exists
 * for exactly that reason.
 *
 * (Reading the DOM is fine INSIDE a predicate that also depends on store
 * state, because the store change is what re-triggers the check.)
 */
function waitForProof(
  predicate: (s: ViewerState) => boolean,
  timeoutMs: number,
  r: Run,
): Promise<ProofResult> {
  const store = getViewerStoreApi();
  if (predicate(store.getState())) return Promise.resolve('held');
  return new Promise((resolve) => {
    const finish = (result: ProofResult) => {
      window.clearTimeout(timer);
      unsub();
      if (r.advance === skip) r.advance = null;
      resolve(result);
    };
    const skip = () => finish('skipped');
    const timer = window.setTimeout(() => finish('timeout'), timeoutMs);
    const unsub = store.subscribe((s) => {
      let ok = false;
      try {
        ok = predicate(s);
      } catch (err) {
        // A throwing proof is a broken beat, not a passing one.
        console.warn('[screenflow] settled predicate threw:', err);
        finish('timeout');
        return;
      }
      if (ok) finish('held');
    });
    // Presenting only: "get on with it" has to reach the proof as well, or it
    // does nothing on exactly the beats where somebody would press it.
    if (r.mode === 'present') r.advance = skip;
  });
}

async function playBeat(r: Run, beat: ScreenflowBeat, index: number): Promise<void> {
  const store = getViewerStoreApi();
  const beatStart = performance.now() - r.startedAt;

  patchScreenflowState({
    beatIndex: index,
    paused: r.paused,
    caption: beat.captionDe,
    frame: beat.frame ?? 'live',
    pointerTarget: null,
    pointerWorld: null,
    clicking: false,
  });

  try {
    await beat.prepare?.(store);
  } catch (err) {
    console.warn('[screenflow] beat prepare failed:', beat.id, err);
  }
  if (r.cancelled) return;

  // The pointer travels while the caption is being read, so the eye is
  // already where the action will happen when it happens.
  let anchorMissing = false;
  if (beat.anchor && r.seekUntil > 0) {
    // Replaying to reach a chapter: the pointer is not part of the outcome,
    // and resolving an anchor costs up to two seconds per beat.
  } else if (beat.anchor) {
    const res = await resolveAnchor(store, { anchor: beat.anchor, panel: beat.panel }, () => !r.cancelled);
    if (r.cancelled) return;
    if (res.el) {
      patchScreenflowState({ pointerTarget: res.el });
    } else {
      // A fault, not a log line. A beat whose anchor is missing plays its
      // caption over an interface that does not contain the thing the caption
      // is about -- and the recording looks fine. Measured: three beats
      // pointing at a property row that was never in the DOM, because another
      // tool still owned the panel.
      anchorMissing = true;
      console.warn('[screenflow] anchor did not resolve:', beat.id, beat.anchor);
      patchScreenflowState({ faults: [...useScreenflowStore.getState().faults, beat.id] });
    }
  } else if (beat.worldPoint) {
    // A building coordinate needs no resolution — the stage projects it every
    // frame, so it keeps up with a camera that is still moving. The storey is
    // resolved here rather than written into the beat: a clip that builds its
    // own project cannot know the id at authoring time, and the first storey
    // is the only one such a project has.
    const state = store.getState();
    const [modelId, model] = [...state.models.entries()][0] ?? [];
    const storeyId = beat.worldStoreyId
      ?? model?.ifcDataStore?.entityIndex?.byType?.get('IFCBUILDINGSTOREY')?.[0];
    if (modelId && storeyId !== undefined) {
      patchScreenflowState({ pointerWorld: { point: beat.worldPoint, storeyId, modelId } });
    }
  }

  await beatWait(beatHoldMs(beat), r);
  if (r.cancelled) return;

  if ((beat.anchor || beat.worldPoint) && r.seekUntil === 0) {
    patchScreenflowState({ clicking: true });
    await beatWait(POINTER_CLICK_MS, r);
    patchScreenflowState({ clicking: false });
    if (r.cancelled) return;
  }

  try {
    await beat.perform?.(store);
  } catch (err) {
    console.warn('[screenflow] beat perform failed:', beat.id, err);
  }
  if (r.cancelled) return;

  let timedOut = false;
  if (beat.settled) {
    const result = await waitForProof(beat.settled, beat.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS, r);
    if (r.cancelled) return;
    if (result === 'timeout') {
      timedOut = true;
      patchScreenflowState({ faults: [...useScreenflowStore.getState().faults, beat.id] });
    }
  }

  await beatWait(SETTLE_MS, r);
  r.timeline.push({
    beatId: beat.id,
    captionDe: beat.captionDe,
    captionEn: beat.captionEn,
    startMs: beatStart,
    endMs: performance.now() - r.startedAt,
    timedOut: timedOut || anchorMissing,
  });
}

/**
 * Play a clip. Resolves when it ends -- normally, or because `stopClip` was
 * called. A missing data file stops it before the first beat rather than
 * halfway through a take.
 */
export interface PlayOptions {
  mode?: ScreenflowMode;
  /** Presenting: replay everything before this beat at speed, then present
   *  from there. Beats build on each other, so a jump is a fast replay and
   *  never a seek. */
  startAtBeat?: number;
  /** Presenting: hold as soon as the replay reaches its chapter. Somebody who
   *  jumped wants a moment to start talking, not the next beat. */
  startPaused?: boolean;
}

export async function playClip(clipId: string, options: PlayOptions = {}): Promise<void> {
  if (run) return;
  const registered = getClip(clipId);
  if (!registered) {
    console.warn('[screenflow] unknown clip:', clipId);
    return;
  }
  const store = getViewerStoreApi();
  resetScreenflowState();
  patchScreenflowState({ status: 'arming', clipId: registered.id, beatIndex: 0 });

  const missing = await missingDemoFiles(registered.requires ?? []);
  if (missing.length > 0) {
    patchScreenflowState({ status: 'done', missingFiles: missing.map((id) => DEMO_FILES[id].name) });
    return;
  }

  const clip = applyCaptionOverrides(registered, await loadCaptionOverrides());
  const mode = options.mode ?? 'record';
  const r: Run = {
    clip,
    mode,
    startedAt: 0,
    timeline: [],
    cancelled: false,
    paused: false,
    seekUntil: mode === 'present' ? Math.max(0, options.startAtBeat ?? 0) : 0,
    pauseAfterSeek: mode === 'present' && options.startPaused === true,
    advance: null,
  };
  run = r;
  patchScreenflowState({ mode, beatCount: clip.beats.length, seeking: r.seekUntil > 0 });

  try {
    await clip.setup?.(store);
  } catch (err) {
    console.warn('[screenflow] setup failed:', clip.id, err);
    run = null;
    patchScreenflowState({ status: 'done', faults: ['setup'] });
    return;
  }
  if (r.cancelled) { run = null; return; }

  r.startedAt = performance.now();
  patchScreenflowState({ status: 'playing' });
  for (let i = 0; i < clip.beats.length; i += 1) {
    if (r.cancelled) break;
    if (r.seekUntil > 0 && i >= r.seekUntil) {
      r.seekUntil = 0;
      r.paused = r.pauseAfterSeek;
      patchScreenflowState({ seeking: false, paused: r.paused });
    }
    await playBeat(r, clip.beats[i], i);
  }

  const finished = !r.cancelled;
  lastRun = { clip, timeline: r.timeline };
  // Only tear down if this run is still the current one. A chapter jump stops
  // this run and starts another immediately; the stopped run's loop unwinds a
  // moment later, and without this guard it nulled `run` and reset the state
  // of its own successor -- the presenter bar vanished and the controls went
  // dead, on a clip that was playing perfectly.
  if (run !== r) return;
  run = null;
  if (finished) {
    patchScreenflowState({ status: 'done', pointerTarget: null, pointerWorld: null, clicking: false, caption: '' });
  } else {
    resetScreenflowState();
  }
}

/**
 * Presenter controls. All no-ops while recording, on purpose: a take must be
 * the same every time, and a stray key press that quietly changed the pacing
 * would be discovered in the edit.
 */
export function togglePause(): void {
  if (!run || run.mode !== 'present') return;
  run.paused = !run.paused;
  patchScreenflowState({ paused: run.paused });
}

export function isPaused(): boolean {
  return run?.paused ?? false;
}

/** End the current wait now — "I have said my piece, get on with it". */
export function advanceBeat(): void {
  if (!run || run.mode !== 'present') return;
  run.paused = false;
  patchScreenflowState({ paused: false });
  run.advance?.();
}

/**
 * Jump to a chapter by restarting the clip and replaying up to it at speed.
 *
 * Restarting rather than rewinding, because a beat's action has no inverse: a
 * wall drawn is drawn. Replaying reaches the same model state honestly, keeps
 * every proof, and takes a few seconds.
 */
export function jumpToChapter(beatIndex: number): void {
  const current = run;
  if (!current || current.mode !== 'present') return;
  const clipId = current.clip.id;
  stopClip();
  void playClip(clipId, { mode: 'present', startAtBeat: beatIndex, startPaused: true });
}

/** Stop the clip where it stands; the stage goes away, the app stays as-is. */
export function stopClip(): void {
  if (run) {
    run.cancelled = true;
    run.advance?.();
    lastRun = { clip: run.clip, timeline: run.timeline };
    run = null;
  }
  resetScreenflowState();
}
