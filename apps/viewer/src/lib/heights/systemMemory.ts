/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keeping the height system across reloads.
 *
 * Deriving it is one click; correcting what the model got wrong is the work,
 * and the whole reason the system is held in the store rather than recomputed.
 * Until now that work lasted exactly as long as the tab (Marc, 2026-09-15:
 * "Die Stockwerkshöhen sollten eigentlich gespeichert sein ... Sollte
 * automatisch passieren, wenn ich dies einmal abgeleitet habe").
 *
 * ## Not the export format
 *
 * `serializeHeightSystem` writes the file the reading side has agreed to —
 * with a generation timestamp and a shape chosen for an outside consumer.
 * What is stored here is the system's own object, because this end has to read
 * it back EXACTLY: a format designed for someone else is not a round trip, and
 * a lossy one would quietly return a slightly different building.
 *
 * ## Read strictly
 *
 * A restored system is applied without anybody looking at it, and every length
 * in it is metres that the viewer does not re-check. So the reader rejects
 * rather than repairs: a missing storey list, an elevation that is not a
 * finite number, a format version from a future build. Losing it costs one
 * derive; half-reading it puts a building at the wrong height with nothing on
 * screen saying so.
 */

import type { ProjectKey } from '@ifc-lite/project';
import { readScoped, writeScoped, clearScoped } from '@/lib/project/scopedStorage';
import type { HeightSystem, ReferenceLevel, Storey } from './types.js';

const STORAGE_KEY = 'ifc-lite:height-system';

function isLevel(value: unknown): value is ReferenceLevel {
  if (typeof value !== 'object' || value === null) return false;
  const l = value as Partial<ReferenceLevel>;
  return typeof l.key === 'string' && typeof l.label === 'string'
    && typeof l.offset === 'number' && Number.isFinite(l.offset);
}

function isStorey(value: unknown): value is Storey {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<Storey>;
  if (typeof s.id !== 'string' || typeof s.name !== 'string') return false;
  if (typeof s.elevation !== 'number' || !Number.isFinite(s.elevation)) return false;
  if (typeof s.source !== 'string') return false;
  return s.levels === undefined || (Array.isArray(s.levels) && s.levels.every(isLevel));
}

/** The stored system for a project, or `null` when there is none to trust. */
export function loadHeightSystem(project: ProjectKey | null): HeightSystem | null {
  const raw = readScoped(STORAGE_KEY, project);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const s = parsed as Partial<HeightSystem>;
    // A version this build does not know is a system written by a later one.
    // Guessing at it would be guessing about metres.
    if (s.formatVersion !== 1) return null;
    if (!Array.isArray(s.storeys) || !s.storeys.every(isStorey)) return null;
    if (!Array.isArray(s.referenceLevels) || !s.referenceLevels.every(isLevel)) return null;
    if (typeof s.updatedAt !== 'string') return null;
    if (typeof s.derivedFrom !== 'object' || s.derivedFrom === null) return null;
    if (s.datumAboveSeaLevel !== undefined
      && !(typeof s.datumAboveSeaLevel === 'number' && Number.isFinite(s.datumAboveSeaLevel))) {
      return null;
    }
    return parsed as HeightSystem;
  } catch (err) {
    console.warn(`[heights] ignoring malformed system in ${STORAGE_KEY}`, err);
    return null;
  }
}

/** Remember this project's system. `null` forgets it. */
export function saveHeightSystem(project: ProjectKey | null, system: HeightSystem | null): void {
  if (system === null) {
    clearScoped(STORAGE_KEY, project);
    return;
  }
  writeScoped(STORAGE_KEY, project, JSON.stringify(system));
}
