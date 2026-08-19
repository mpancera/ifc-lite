/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Starting a clip from the address bar: `?screenflow=clip-01-federation`.
 *
 * # Why a URL parameter is the entry point
 * Recording is a two-handed job -- start the recorder, then start the clip --
 * and every second between the two is dead footage the operator has to trim.
 * A URL that plays the clip on load turns that into one action: arrange the
 * window, start recording, press Enter in the address bar. It also makes a
 * take reproducible by writing it down, which a menu item does not.
 *
 * # A deliberate delay before the first beat
 * The clip does not start the instant the page is interactive. The operator
 * needs a moment to move the mouse out of frame, and the app needs one to
 * finish its first paint; starting into a half-drawn interface is the most
 * common way a take is wasted. `?delay=` overrides the default for someone
 * who wants a longer runway.
 *
 * # It fires exactly once, and the guard is not a ref
 * React StrictMode mounts effects twice in development: effect, cleanup,
 * effect. A ref set on the first pass makes the second pass bail -- while the
 * cleanup in between has already cancelled the only timer, so the clip never
 * starts at all. Observed exactly that. The guard therefore marks the clip as
 * launched when it actually starts, not when it is scheduled, and the timer is
 * re-armed on every mount. `playClip` refuses a second concurrent run anyway,
 * so the two guards cover each other.
 */

import { useEffect } from 'react';
import { playClip } from './player';
import type { ScreenflowMode } from './types';

/** Module scope, not component scope: it must outlive a StrictMode remount. */
let launchedClipId: string | null = null;

/** Runway between page load and the first beat. */
export const DEFAULT_START_DELAY_MS = 1500;

export interface ScreenflowLaunchRequest {
  clipId: string;
  delayMs: number;
  mode: ScreenflowMode;
}

/**
 * Read the request out of a query string. Returns null when there is none.
 *
 * `?present` (or `?mode=present`) switches to presenting. Recording stays the
 * default: it is the mode with no controls, so a URL that arrives without an
 * opinion produces the safe thing rather than a bar in the corner of a video.
 */
export function parseLaunchRequest(search: string): ScreenflowLaunchRequest | null {
  const params = new URLSearchParams(search);
  const clipId = params.get('screenflow');
  if (!clipId) return null;
  const raw = params.get('delay');
  const parsed = raw === null ? Number.NaN : Number(raw);
  const wantsPresent = params.get('mode') === 'present'
    || (params.has('present') && params.get('present') !== '0');
  const mode: ScreenflowMode = wantsPresent ? 'present' : 'record';
  // Presenting starts at once: the runway exists so a recorder operator can
  // get the mouse out of frame, and there is no recorder here.
  const fallbackDelay = mode === 'present' ? 0 : DEFAULT_START_DELAY_MS;
  const delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackDelay;
  return { clipId, delayMs, mode };
}

export function useScreenflowLauncher(): void {
  useEffect(() => {
    const request = parseLaunchRequest(window.location.search);
    if (!request || launchedClipId === request.clipId) return;
    const timer = window.setTimeout(() => {
      launchedClipId = request.clipId;
      void playClip(request.clipId, { mode: request.mode });
    }, request.delayMs);
    return () => window.clearTimeout(timer);
  }, []);
}
