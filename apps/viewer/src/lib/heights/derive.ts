/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deriving the height system from a loaded model.
 *
 * Pure: raw storey readings in, a {@link HeightSystem} out. The caller does the
 * IFC extraction; this decides what the numbers MEAN, which is where the three
 * findings from two real models live:
 *
 * 1. The elevations sit in `IfcBuildingStorey.Elevation` — deprecated, and the
 *    only attribute either model actually populates. `ElevationOfFFLRelative`
 *    and `ElevationOfSSLRelative` were absent from both. So that attribute is
 *    the primary source and the pset is a supplement, not the other way round.
 * 2. The length unit differs per model — one in millimetres, one in
 *    CENTIMETRES. Reading either naively puts the storeys out by a factor of
 *    100 or 1000, and the result looks entirely plausible.
 * 3. Naming conventions differ (`U01/E00/O01` against `UG/EG/Roof`), so names
 *    are display, never keys.
 */

import type {
  ElevationSource, HeightSystem, ReferenceLevel, Storey, StoreyWithHeight,
} from './types.js';

/** One storey as read out of a model, still in the FILE's length unit. */
export interface RawStorey {
  /** Stable across re-derivation — the express id, or `modelId:expressId`. */
  id: string;
  name: string;
  /** In the file's own unit, NOT metres. Scaling happens here. */
  elevation: number;
  source: ElevationSource;
}

export interface DeriveInput {
  fileName: string;
  documentId?: string;
  storeys: readonly RawStorey[];
  /**
   * Metres per file unit — `0.001` for millimetres, `0.01` for centimetres.
   * Must come from the file's `IFCUNITASSIGNMENT`.
   */
  lengthUnitScale: number;
  /**
   * The unit's name, or `null` when it could not be determined.
   *
   * `null` ABORTS the derivation. Assuming metres would be the most expensive
   * silent failure available here: every storey off by a constant factor, no
   * error anywhere, and a plausible-looking list.
   */
  lengthUnitName: string | null;
  /** Height of ±0.00 above sea level, in metres. Omit when unknown. */
  datumAboveSeaLevel?: number;
  /** Defaults to {@link DEFAULT_REFERENCE_LEVELS}. */
  referenceLevels?: readonly ReferenceLevel[];
  /** Injectable for tests. */
  now?: () => Date;
}

export type DeriveResult =
  | { ok: true; system: HeightSystem }
  | { ok: false; reason: string };

/**
 * What a Swiss/German project starts from.
 *
 * Marc thinks in OK-Fertigboden, and it is also the figure that matters in
 * operation — so it is the zero, and the structural floor sits below it. Both
 * are editable; these are a starting point, not a rule.
 */
export const DEFAULT_REFERENCE_LEVELS: readonly ReferenceLevel[] = [
  { key: 'ffl', label: 'OK-Fertigboden', offset: 0 },
  { key: 'ssl', label: 'UK-Rohboden', offset: -0.3 },
];

/**
 * Build the height system, or refuse with a reason.
 *
 * Refuses rather than guesses on: an unknown length unit, a non-finite or
 * non-positive scale, and a model with no storeys at all. Each of those
 * produces numbers that look usable and are not.
 */
export function deriveHeightSystem(input: DeriveInput): DeriveResult {
  if (input.lengthUnitName === null) {
    return {
      ok: false,
      reason: 'Die Längeneinheit des Modells liess sich nicht bestimmen. '
        + 'Ohne sie wären alle Koten um einen konstanten Faktor falsch — '
        + 'ein Fehler, den man der Liste nicht ansieht.',
    };
  }
  if (!Number.isFinite(input.lengthUnitScale) || input.lengthUnitScale <= 0) {
    return { ok: false, reason: `Unbrauchbarer Einheitenfaktor: ${input.lengthUnitScale}.` };
  }
  if (input.storeys.length === 0) {
    return { ok: false, reason: 'Das Modell enthält keine Geschosse (IfcBuildingStorey).' };
  }

  const storeys: Storey[] = input.storeys
    .map((raw): Storey => ({
      id: raw.id,
      name: raw.name,
      elevation: raw.elevation * input.lengthUnitScale,
      source: raw.source,
    }))
    // Ascending by elevation. Ties keep their input order, which is the only
    // stable answer when two storeys genuinely sit at the same level (a split
    // level, a mezzanine modelled flat).
    .sort((a, b) => a.elevation - b.elevation);

  const now = (input.now ?? (() => new Date()))();

  return {
    ok: true,
    system: {
      formatVersion: 1,
      derivedFrom: {
        ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
        fileName: input.fileName,
        sourceLengthUnit: input.lengthUnitName,
      },
      updatedAt: now.toISOString(),
      ...(input.datumAboveSeaLevel !== undefined
        ? { datumAboveSeaLevel: input.datumAboveSeaLevel }
        : {}),
      referenceLevels: [...(input.referenceLevels ?? DEFAULT_REFERENCE_LEVELS)],
      storeys,
    },
  };
}

/**
 * Add each storey's height — the distance to the one above.
 *
 * The topmost gets `null`, not 0. A raw storey list says nothing about where
 * the building ends, and 0 would be a claim rather than an absence. Every
 * consumer that extrudes to "storey height" has to handle the null explicitly,
 * which is the point.
 */
export function withStoreyHeights(storeys: readonly Storey[]): StoreyWithHeight[] {
  const ordered = [...storeys].sort((a, b) => a.elevation - b.elevation);

  return ordered.map((storey, i) => {
    const above = ordered[i + 1];
    return {
      ...storey,
      height: above ? above.elevation - storey.elevation : null,
    };
  });
}

/**
 * The levels that apply to a storey: its own when it has any, the system's
 * otherwise.
 *
 * An EMPTY array on the storey means "this storey deliberately has none", not
 * "fall back" — otherwise there would be no way to express the exception.
 */
export function levelsFor(
  storey: Storey,
  system: Pick<HeightSystem, 'referenceLevels'>,
): readonly ReferenceLevel[] {
  return storey.levels ?? system.referenceLevels;
}

/**
 * The absolute elevation of a named level on a storey, in metres.
 *
 * `null` when the storey does not carry that level — a caller asking for
 * OK-Fertigboden on a storey that has none must not silently get the storey
 * elevation back.
 */
export function levelElevation(
  storey: Storey,
  system: Pick<HeightSystem, 'referenceLevels'>,
  key: string,
): number | null {
  const level = levelsFor(storey, system).find((l) => l.key === key);
  return level ? storey.elevation + level.offset : null;
}
