/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Writing the height system out for another application to read.
 *
 * The file is the interface, so two things matter more than they would
 * internally:
 *
 * 1. **Rounded to the millimetre.** Elevations are computed by subtraction and
 *    carry float noise — `0.1 - -2.43` is `2.5300000000000002`. Internally that
 *    is harmless and exactness is worth keeping; in a file somebody else parses
 *    and shows, it is noise that invites a bug report. A millimetre is also the
 *    honest resolution for a building level.
 * 2. **Stable key order.** So that re-exporting an unchanged system produces a
 *    byte-identical file apart from the timestamp, and a diff shows what
 *    actually changed.
 *
 * `updatedAt` is stamped at EXPORT time: the receiving side uses it to decide
 * whether it holds a newer version, and the question it is really asking is
 * "when was this file produced".
 *
 * Pure — a system in, a string out. The caller does the download.
 */

import { sidecarFileName } from '@ifc-lite/project';
import type { HeightSystem, ReferenceLevel, Storey } from './types.js';

/**
 * What the height system is called on disk.
 *
 * **One per project, not one per model.** The system is the project's
 * reference — the thing every discipline model gets compared against — so a
 * name derived from whichever model it happened to be read from would be
 * wrong even when it looked helpful.
 *
 * The name is fixed rather than proposed, because it is a contract: the
 * reading side looks for this name. An earlier version proposed
 * `ARC-01.heights.json`, which no reader was looking for and which
 * would therefore simply never have been picked up.
 */
export function heightsFileName(): string {
  return sidecarFileName('heights');
}

/** Millimetre resolution. `-0` is normalised away: it survives JSON and reads
 *  as a different number to a human. */
function mm(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function level(l: ReferenceLevel): ReferenceLevel {
  return { key: l.key, label: l.label, offset: mm(l.offset) };
}

function storey(s: Storey): Storey {
  return {
    id: s.id,
    name: s.name,
    elevation: mm(s.elevation),
    source: s.source,
    // Only when the storey actually overrides. An empty array is KEPT — it
    // means "this storey deliberately has none", which is not the same as
    // falling back to the system's.
    ...(s.levels !== undefined ? { levels: s.levels.map(level) } : {}),
  };
}

/** The exact object that gets written, for tests and for callers that want to
 *  hand it somewhere other than a file. */
export function heightSystemPayload(
  system: HeightSystem,
  now: Date = new Date(),
): HeightSystem {
  return {
    formatVersion: 1,
    derivedFrom: {
      ...(system.derivedFrom.documentId !== undefined
        ? { documentId: system.derivedFrom.documentId }
        : {}),
      fileName: system.derivedFrom.fileName,
      ...(system.derivedFrom.sourceLengthUnit !== undefined
        ? { sourceLengthUnit: system.derivedFrom.sourceLengthUnit }
        : {}),
    },
    updatedAt: now.toISOString(),
    // Omitted rather than zeroed when unknown — 0 would be a claim about the
    // site, and the receiving side treats absence as "unknown".
    ...(system.datumAboveSeaLevel !== undefined
      ? { datumAboveSeaLevel: mm(system.datumAboveSeaLevel) }
      : {}),
    referenceLevels: system.referenceLevels.map(level),
    storeys: [...system.storeys]
      .sort((a, b) => a.elevation - b.elevation)
      .map(storey),
  };
}

/** The file contents. Two-space indent: this gets read by people and diffed. */
export function serializeHeightSystem(system: HeightSystem, now?: Date): string {
  return `${JSON.stringify(heightSystemPayload(system, now), null, 2)}\n`;
}
