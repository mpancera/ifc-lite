/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where a presenter may jump into a clip.
 *
 * The card beats are already the clip's section breaks — a full-bleed
 * statement between two stretches of work is exactly what a chapter mark is,
 * and deriving the list from them means a clip cannot grow a section without
 * growing the chapter that names it. A separate hand-kept list would drift the
 * first time somebody inserted a beat.
 *
 * Jumping is never a seek: beats build on each other, and a clip that starts
 * at "detect the rooms" would find no walls. So a jump REPLAYS everything
 * before it without the reading pauses — the model reaches the same state, it
 * just gets there fast. That is also why chapter jumps stay honest about
 * failure: the replayed beats keep their proofs.
 */

import type { ScreenflowClip } from './types';

export interface Chapter {
  /** Index of the beat this chapter starts at. */
  beatIndex: number;
  /** What the presenter picks from a list. */
  titleDe: string;
}

/**
 * Chapter marks of a clip: its card beats, plus the very first beat when that
 * is not already one — a presenter must always be able to get back to the
 * start.
 */
export function chaptersOf(clip: ScreenflowClip): Chapter[] {
  const chapters: Chapter[] = [];
  clip.beats.forEach((beat, beatIndex) => {
    if (beat.frame === 'card') chapters.push({ beatIndex, titleDe: beat.captionDe });
  });
  if (chapters.length === 0 || chapters[0].beatIndex !== 0) {
    chapters.unshift({ beatIndex: 0, titleDe: clip.titleDe });
  }
  return chapters;
}

/** The chapter a given beat belongs to — the last one at or before it. */
export function chapterAt(chapters: readonly Chapter[], beatIndex: number): Chapter | null {
  let current: Chapter | null = null;
  for (const chapter of chapters) {
    if (chapter.beatIndex <= beatIndex) current = chapter;
    else break;
  }
  return current;
}
