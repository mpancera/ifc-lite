/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning a played clip into subtitle files.
 *
 * Two files, one timeline: the German one matches the captions that are
 * burned into the picture (useful for a viewer with the sound off in a room
 * where the burn-in is too small), the English one is the translation that
 * never appears on screen. Both are built from measured beat timings, so they
 * fit the take that was just recorded and not the one that was planned.
 */

import { downloadBlob } from '@/lib/export/download';
import { toSrt, type CaptionCue, type SrtOptions } from './srt';
import type { BeatTimeline, ScreenflowClip } from './types';

export type SubtitleLanguage = 'de' | 'en';

/**
 * `clip-01-zwei-modelle-eine-struktur.de.srt`
 *
 * Umlauts are transliterated rather than stripped: "Grundriss statt
 * Screenshot" is fine either way, but "Prüfliste" becomes "pruefliste", not
 * "prufliste". This is a slug for a filename the operator sorts by, so
 * `sanitizeFilename` (which deliberately preserves case and spacing) is the
 * wrong tool here.
 */
export function subtitleFilename(clip: ScreenflowClip, language: SubtitleLanguage): string {
  const slug = clip.titleDe
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `clip-${String(clip.number).padStart(2, '0')}-${slug}.${language}.srt`;
}

export function cuesFromTimeline(timeline: readonly BeatTimeline[], language: SubtitleLanguage): CaptionCue[] {
  return timeline.map((beat) => ({
    startMs: beat.startMs,
    endMs: beat.endMs,
    text: language === 'de' ? beat.captionDe : beat.captionEn,
  }));
}

export function buildSubtitles(
  timeline: readonly BeatTimeline[],
  language: SubtitleLanguage,
  options: SrtOptions = {},
): string {
  return toSrt(cuesFromTimeline(timeline, language), options);
}

/** Hand both subtitle files to the browser, through the app's one save path. */
export function downloadSubtitles(
  clip: ScreenflowClip,
  timeline: readonly BeatTimeline[],
  options: SrtOptions = {},
): void {
  for (const language of ['de', 'en'] as const) {
    const srt = buildSubtitles(timeline, language, options);
    if (srt.length === 0) continue;
    downloadBlob(new Blob([srt], { type: 'text/plain;charset=utf-8' }), subtitleFilename(clip, language));
  }
}
