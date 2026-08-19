/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * How long a beat stays on screen before the clip acts.
 *
 * # Why the clip computes this instead of the author typing seconds
 * A screenflow is silent: the caption IS the narration, and the viewer has to
 * read it while also watching the interface do something. Hand-typed hold
 * times drift the moment the wording changes -- someone shortens a caption and
 * the beat still sits there for six seconds, or lengthens one and it is gone
 * before it was read. Deriving the hold from the text keeps the two in step by
 * construction, and an author who really needs a different length says so with
 * `holdMs` and gets exactly that.
 *
 * # The slower of the two languages wins
 * The German caption is burned into the picture, the English one rides along
 * as a subtitle file over the SAME timeline -- one cue per beat, because the
 * subtitle track cannot cut faster than the picture it belongs to. So the beat
 * must last long enough for whichever of the two takes longer to read;
 * pacing on the German alone would leave an English viewer behind on every
 * beat where the translation runs longer.
 *
 * # The numbers
 * 11 characters per second is deliberately below the 15-17 that broadcast
 * subtitling allows. That rate assumes the picture is the story and the text
 * is support; here it is the other way round, and the eye also has to travel
 * to whatever the interface just did.
 */

/** Reading rate for burned-in captions, characters per second. */
export const CAPTION_CHARS_PER_SECOND = 11;
/** No caption flashes: even "Fertig." gets read time plus a beat of air. */
export const MIN_CAPTION_MS = 2200;
/** Past this, a caption is too long for one beat -- split it instead. */
export const MAX_CAPTION_MS = 7000;
/** Air after the action lands, before the next caption replaces this one. */
export const SETTLE_MS = 600;

/** Read time for one caption, clamped into the legible band. */
export function readingTimeMs(text: string): number {
  const chars = text.trim().length;
  if (chars === 0) return MIN_CAPTION_MS;
  const raw = Math.round((chars / CAPTION_CHARS_PER_SECOND) * 1000);
  return Math.min(MAX_CAPTION_MS, Math.max(MIN_CAPTION_MS, raw));
}

/**
 * True when a caption cannot be read inside one beat at the target rate --
 * the author is being told to split it, not silently given a longer beat.
 */
export function isCaptionOverlong(text: string): boolean {
  return Math.round((text.trim().length / CAPTION_CHARS_PER_SECOND) * 1000) > MAX_CAPTION_MS;
}

export interface BeatTiming {
  /** Explicit hold from the author; wins over the derived one. */
  holdMs?: number;
  captionDe: string;
  captionEn: string;
}

/** How long the beat shows its caption before `perform` runs. */
export function beatHoldMs(beat: BeatTiming): number {
  if (typeof beat.holdMs === 'number') return Math.max(0, beat.holdMs);
  return Math.max(readingTimeMs(beat.captionDe), readingTimeMs(beat.captionEn));
}
