/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `$INSUNITS` to metres. The codes are from the DXF reference; only the ones
 * a floor plan can plausibly carry are listed, everything else is unknown.
 */
const INSUNITS_TO_METRES: Record<number, number> = {
  1: 0.0254, // inches
  2: 0.3048, // feet
  4: 0.001, // millimetres
  5: 0.01, // centimetres
  6: 1, // metres
  7: 1000, // kilometres
  14: 0.1, // decimetres
};

export const INSUNITS_NAMES: Record<number, string> = {
  0: 'unitless',
  1: 'inches',
  2: 'feet',
  4: 'millimetres',
  5: 'centimetres',
  6: 'metres',
  7: 'kilometres',
  14: 'decimetres',
};

/** Metres per drawing unit for a `$INSUNITS` code, or undefined when unknown or unitless. */
export function metresPerInsunit(code: number): number | undefined {
  return INSUNITS_TO_METRES[code];
}

/**
 * Guess the unit of a unitless drawing from its extent. A storey is tens of
 * metres across: an extent in the tens of thousands is millimetres, in the
 * thousands centimetres, below that metres. Mirrors the rule the DXF importer
 * applies, so both report the same thing.
 */
export function estimateMetresPerUnit(extent: number): { metresPerUnit: number; assumed: string } {
  if (extent > 5000) return { metresPerUnit: 0.001, assumed: 'millimetres' };
  if (extent > 500) return { metresPerUnit: 0.01, assumed: 'centimetres' };
  return { metresPerUnit: 1, assumed: 'metres' };
}
