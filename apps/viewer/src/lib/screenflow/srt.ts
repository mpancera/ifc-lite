/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Subtitle sidecars for a recorded screenflow.
 *
 * # Why the timings are measured, not planned
 * The pacing module says how long a beat SHOULD hold. What a beat actually
 * took is a different number: a model load waits on the parser, an action gate
 * waits on the app, and both depend on the machine doing the recording. A
 * subtitle file written from the plan would drift against the video by exactly
 * that difference, and the drift accumulates over nine beats. So the clip
 * records a real start and end per beat while it plays and builds the file
 * from those.
 *
 * # Zero is the first frame of the recording, not of the clip
 * The recorder is started by hand before the clip is, so the cues carry an
 * offset the operator can dial in. Everything else stays relative to the first
 * beat, which is the only reference both sides can agree on.
 */

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** `00:01:07,480` -- SRT wants a comma before the milliseconds, not a dot. */
export function formatSrtTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const milli = clamped % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

export interface SrtOptions {
  /** Milliseconds between the recorder's first frame and the clip's first
   *  beat; shifts every cue by the same amount. */
  offsetMs?: number;
  /** Gap held back at the end of each cue so two cues never share a frame. */
  gapMs?: number;
}

/**
 * Build an SRT file. Cues are emitted in time order, empty ones dropped, and
 * an overlap is resolved in favour of the LATER cue -- a subtitle that is
 * still up when the next caption is already burned into the picture reads as
 * a bug in the video, not as generosity.
 */
export function toSrt(cues: readonly CaptionCue[], options: SrtOptions = {}): string {
  const offset = options.offsetMs ?? 0;
  const gap = options.gapMs ?? 80;
  const ordered = cues
    .filter((c) => c.text.trim().length > 0 && c.endMs > c.startMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs);

  const blocks: string[] = [];
  ordered.forEach((cue, i) => {
    const next = ordered[i + 1];
    const rawEnd = next ? Math.min(cue.endMs, next.startMs) : cue.endMs;
    const end = Math.max(cue.startMs + 1, rawEnd - gap);
    blocks.push(
      [
        String(blocks.length + 1),
        `${formatSrtTimestamp(cue.startMs + offset)} --> ${formatSrtTimestamp(end + offset)}`,
        cue.text.trim(),
        '',
      ].join('\n'),
    );
  });
  return blocks.join('\n');
}
