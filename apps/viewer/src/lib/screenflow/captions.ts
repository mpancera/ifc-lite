/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Local caption overrides.
 *
 * # Why captions can be overridden at all
 * This repository is public, so the committed clips speak generically: "das
 * Architekturmodell", not the name of the building it belongs to. A recording
 * made for a specific audience usually wants the specific name on screen. The
 * override file lives next to the models in the git-ignored
 * `public/demo-local/`, so the naming and the data it names stay together and
 * neither reaches the repository.
 *
 * # Why an overlay and not a second set of clips
 * A forked clip drifts: someone fixes a beat in the committed one and the
 * local copy keeps the old timing forever. An overlay can only change words.
 * The beats, the actions and the order stay single-sourced, which is the part
 * that would actually break a recording if it went stale.
 *
 * Shape of `public/demo-local/captions.json`:
 * ```json
 * {
 *   "clip-01-federation": {
 *     "title": { "de": "...", "en": "..." }
 *   }
 * }
 * ```
 * Unknown clip and beat ids are ignored, and either language may be omitted.
 */

import { looksLikeSpaFallback } from './dataset';
import type { ScreenflowBeat, ScreenflowClip } from './types';

const OVERRIDES_PATH = '/demo-local/captions.json';

export interface CaptionOverride {
  de?: string;
  en?: string;
}

export type CaptionOverrides = Record<string, Record<string, CaptionOverride>>;

function isOverride(value: unknown): value is CaptionOverride {
  if (typeof value !== 'object' || value === null) return false;
  const { de, en } = value as CaptionOverride;
  return (de === undefined || typeof de === 'string') && (en === undefined || typeof en === 'string');
}

/**
 * Keep only the well-formed entries instead of rejecting the whole file: a
 * typo in one beat should cost that one caption, not the take.
 */
export function parseCaptionOverrides(raw: unknown): CaptionOverrides {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: CaptionOverrides = {};
  for (const [clipId, beats] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof beats !== 'object' || beats === null) continue;
    const clean: Record<string, CaptionOverride> = {};
    for (const [beatId, override] of Object.entries(beats as Record<string, unknown>)) {
      if (isOverride(override)) clean[beatId] = override;
    }
    if (Object.keys(clean).length > 0) out[clipId] = clean;
  }
  return out;
}

/** Apply overrides to one clip. Returns the clip unchanged when none apply. */
export function applyCaptionOverrides(clip: ScreenflowClip, overrides: CaptionOverrides): ScreenflowClip {
  const forClip = overrides[clip.id];
  if (!forClip) return clip;
  let changed = false;
  const beats: ScreenflowBeat[] = clip.beats.map((beat) => {
    const override = forClip[beat.id];
    if (!override || (override.de === undefined && override.en === undefined)) return beat;
    changed = true;
    return {
      ...beat,
      captionDe: override.de ?? beat.captionDe,
      captionEn: override.en ?? beat.captionEn,
    };
  });
  return changed ? { ...clip, beats } : clip;
}

/**
 * Read the local override file. A missing or malformed file is the normal
 * case (nobody has to have one), so it resolves to no overrides rather than
 * throwing -- but a malformed one is logged, because silently ignoring a file
 * someone wrote on purpose is how a recording goes out with the wrong words.
 */
export async function loadCaptionOverrides(): Promise<CaptionOverrides> {
  try {
    const res = await fetch(OVERRIDES_PATH);
    // The dev server answers an unknown path with the app's index.html and a
    // 200, so "no override file" arrives here as a page of HTML. Without this
    // check every run without overrides logs a JSON parse error, which trains
    // the operator to ignore the one that means something.
    if (!res.ok || looksLikeSpaFallback(res)) return {};
    return parseCaptionOverrides(await res.json());
  } catch (err) {
    console.warn('[screenflow] caption overrides could not be read:', err);
    return {};
  }
}
