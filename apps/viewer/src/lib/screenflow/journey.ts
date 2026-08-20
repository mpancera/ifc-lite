/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The user journey as five numbered steps, whatever state each one is in.
 *
 * # One list, not two
 * A built strand and a planned one are the same row to a reader — step 3 of
 * five, with a title and a state. They live apart in the registry because one
 * is code and the other is a note, and joining them for display here is what
 * keeps the launcher from being a second, hand-kept copy of the plan. Add a
 * strand and it appears; finish it and its row changes state on its own.
 *
 * # Why "ready" is not the same as "built"
 * A strand whose clip exists can still be unplayable on this machine: the
 * demo data it reads lives outside the repository. So readiness is answered
 * against the files actually present, not against the registry, and the row
 * says which file is missing rather than failing when somebody presses start.
 */

import { DEMO_FILES, missingDemoFiles, type DemoFileId } from './dataset';
import { storedDemoFileIds } from './demoFileStore';
import { PLANNED_CLIPS, SCREENFLOW_REGISTRY } from './registry';
import type { ScreenflowClip } from './types';

export type JourneyState =
  /** The clip exists and everything it reads is here. */
  | 'ready'
  /** The clip exists; a file it needs is not on this machine. */
  | 'missing-data'
  /** No clip yet — the row says what the product still owes it. */
  | 'planned';

/** Where a slot's file is coming from right now. */
export type DemoSlotSource =
  /** The user put a file in this slot; it lives in this browser only. */
  | 'uploaded'
  /** The server has it, out of the git-ignored `public/demo-local/`. */
  | 'served'
  /** Neither. */
  | 'missing';

export interface DemoSlotStatus extends MissingDemoFile {
  source: DemoSlotSource;
}

export interface MissingDemoFile {
  /** The slot, so the launcher can offer to fill it. */
  id: DemoFileId;
  name: string;
  /** What a file picker for this slot should offer. */
  accept: string;
  howToGetDe: string;
}

export interface JourneyStep {
  number: number;
  titleDe: string;
  /** One line: the claim for a built strand, the workflow for a planned one. */
  subtitleDe: string;
  state: JourneyState;
  /** Present exactly when a clip exists — what a start button starts. */
  clipId: string | null;
  /** Files the clip needs that are not here, each with how to get it. */
  missingFiles: MissingDemoFile[];
  /** What the product still owes this strand (`planned` only). */
  needsDe: string | null;
}

/** The five steps, in order, before readiness is known. */
function steps(): JourneyStep[] {
  const built = new Map<number, ScreenflowClip>();
  for (const clip of SCREENFLOW_REGISTRY) {
    // Number 0 is the sample that proved the machinery, not a step of the
    // journey. Showing it here would claim a sixth step.
    if (clip.number >= 1) built.set(clip.number, clip);
  }

  const rows: JourneyStep[] = [];
  for (const clip of built.values()) {
    rows.push({
      number: clip.number,
      titleDe: clip.titleDe,
      subtitleDe: clip.messageDe,
      state: 'ready',
      clipId: clip.id,
      missingFiles: [],
      needsDe: null,
    });
  }
  for (const planned of PLANNED_CLIPS) {
    if (built.has(planned.number)) continue;
    rows.push({
      number: planned.number,
      titleDe: planned.titleDe,
      subtitleDe: planned.stepDe,
      state: 'planned',
      clipId: null,
      missingFiles: [],
      needsDe: planned.needsDe,
    });
  }
  return rows.sort((a, b) => a.number - b.number);
}

/**
 * The journey with readiness resolved.
 *
 * Asynchronous because the answer is a fact about the disk, not about the
 * code: it asks the server whether each declared file is actually served.
 */
export async function journeySteps(): Promise<JourneyStep[]> {
  const rows = steps();
  const needed = new Set<DemoFileId>();
  for (const row of rows) {
    if (!row.clipId) continue;
    const clip = SCREENFLOW_REGISTRY.find((c) => c.id === row.clipId);
    for (const id of clip?.requires ?? []) needed.add(id);
  }
  const missing = new Set(await missingDemoFiles([...needed]));
  if (missing.size === 0) return rows;

  return rows.map((row) => {
    if (!row.clipId) return row;
    const clip = SCREENFLOW_REGISTRY.find((c) => c.id === row.clipId);
    const gone = (clip?.requires ?? []).filter((id) => missing.has(id));
    if (gone.length === 0) return row;
    return {
      ...row,
      state: 'missing-data' as const,
      missingFiles: gone.map((id) => ({
        id,
        name: DEMO_FILES[id].name,
        accept: DEMO_FILES[id].accept,
        howToGetDe: DEMO_FILES[id].howToGetDe,
      })),
    };
  });
}

/**
 * Every demo slot with where its file currently comes from.
 *
 * Separate from the steps because the two answer different questions. A step
 * asks "can I press start", and only names what that one clip reads — which
 * left the federation models unreachable, since no step of the journey
 * requires them. This asks "what data do I have on this machine", and the
 * answer has to cover every slot or a file nobody can upload is a file nobody
 * can supply at all.
 */
export async function demoDataSlots(): Promise<DemoSlotStatus[]> {
  const ids = Object.keys(DEMO_FILES) as DemoFileId[];
  const uploaded = new Set(await storedDemoFileIds());
  const missing = new Set(await missingDemoFiles(ids));
  return ids.map((id) => ({
    id,
    name: DEMO_FILES[id].name,
    accept: DEMO_FILES[id].accept,
    howToGetDe: DEMO_FILES[id].howToGetDe,
    source: uploaded.has(id) ? 'uploaded' : missing.has(id) ? 'missing' : 'served',
  }));
}

/** The journey without asking the disk — for a caller that only needs the plan. */
export function journeyOutline(): JourneyStep[] {
  return steps();
}
