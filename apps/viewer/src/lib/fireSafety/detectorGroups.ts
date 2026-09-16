/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cutting a floor's detectors into alarm groups.
 *
 * Two rules, both Marc's (2026-09-16):
 *
 *   - **A group follows the fire compartment.** It never spans two. That is
 *     what makes the panel's display mean something: "group 3 has alarmed"
 *     answers "which compartment is burning" only if the two coincide.
 *   - **At most 32 detectors in a group.** The loop limit, and the point past
 *     which a group stops localising anything.
 *
 * A compartment with more than 32 is cut into as few groups as the limit
 * allows, balanced, and cut by POSITION — a group scattered across a
 * compartment tells the panel nothing about where to go.
 *
 * ## Balanced rather than filled
 *
 * Forty detectors become 20 + 20, not 32 + 8. The limit is a ceiling, not a
 * target: a group of eight next to a group of thirty-two is the same
 * compartment answered at two very different resolutions, and the eight will
 * be the ones somebody has to explain.
 */

import type { PlanPoint } from './detectorLayout';

/** One detector, before it belongs to anything. */
export interface UngroupedDetector {
  /** Stable within a run — the room it is in, plus its index there. */
  key: string;
  /** Which compartment's rooms it hangs in. */
  compartmentKey: string;
  at: PlanPoint;
}

export interface DetectorGroup {
  /** `<compartment>.<n>`, e.g. "00.2.1". One group, one compartment. */
  key: string;
  compartmentKey: string;
  detectors: UngroupedDetector[];
}

/** The loop limit. A group larger than this is not a group, it is a floor. */
export const MAX_DETECTORS_PER_GROUP = 32;

/**
 * Split one compartment's detectors into position-coherent chunks.
 *
 * Sorted along the compartment's LONGER extent before chunking: down a
 * corridor that is the order somebody walks it, and across a hall it is at
 * least a line rather than a scatter.
 */
function chunkByPosition(
  detectors: readonly UngroupedDetector[],
  chunks: number,
): UngroupedDetector[][] {
  if (chunks <= 1) return [[...detectors]];

  const xs = detectors.map((d) => d.at.x);
  const ys = detectors.map((d) => d.at.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const along = spanX >= spanY
    ? (d: UngroupedDetector) => d.at.x
    : (d: UngroupedDetector) => d.at.y;

  const sorted = [...detectors].sort((a, b) => along(a) - along(b));
  const size = Math.ceil(sorted.length / chunks);
  const out: UngroupedDetector[][] = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}

/**
 * Group the detectors of a storey.
 *
 * Compartments come out in the order they are first seen, so the numbering
 * follows the proposal's own order rather than a hash of the keys — the stair
 * is compartment 1 and its group is 1.1, on every floor.
 */
export function groupDetectors(
  detectors: readonly UngroupedDetector[],
  maxPerGroup: number = MAX_DETECTORS_PER_GROUP,
): DetectorGroup[] {
  if (!(maxPerGroup >= 1)) return [];

  const byCompartment = new Map<string, UngroupedDetector[]>();
  for (const detector of detectors) {
    const list = byCompartment.get(detector.compartmentKey);
    if (list) list.push(detector);
    else byCompartment.set(detector.compartmentKey, [detector]);
  }

  const groups: DetectorGroup[] = [];
  for (const [compartmentKey, members] of byCompartment) {
    const chunks = Math.max(1, Math.ceil(members.length / maxPerGroup));
    const parts = chunkByPosition(members, chunks);
    parts.forEach((part, index) => {
      groups.push({
        key: `${compartmentKey}.${index + 1}`,
        compartmentKey,
        detectors: part,
      });
    });
  }
  return groups;
}

/** One line per group, for a report or a toast. */
export function describeGroups(groups: readonly DetectorGroup[]): string[] {
  return groups.map((g) => `${g.key}: ${g.detectors.length} Melder`);
}
