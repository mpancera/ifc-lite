/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Paper scale.
 *
 * A PDF has no unit: a point is 1/72 inch on paper, and how many metres that
 * is depends on the scale the sheet was plotted at. The scale is often only in
 * the file name ("Floor plan 1_100.pdf"), sometimes in the title block, and
 * sometimes nowhere. This module reads what is there and says where it came
 * from; deciding is the caller's job, and calibration by hand always wins.
 */

import type { UnitResolution } from '../types.js';

/** Denominators a building plan is plotted at. Anything else is a version number or a date. */
const PLAUSIBLE_DENOMINATORS = new Set([1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000]);

const SCALE_PATTERN = /(?:^|[^\d])1\s*[:_-]\s*(\d{1,5})(?!\d)/g;

export interface ScaleHint {
  denominator: number;
  source: 'filename' | 'titleblock';
  /** The characters that matched, for the protocol. */
  match: string;
}

/** Every plausible "1:n" in the file name and in the sheet's texts. */
export function findScaleHints(input: { fileName?: string; texts?: readonly string[] }): ScaleHint[] {
  const hints: ScaleHint[] = [];
  if (input.fileName) {
    for (const h of scan(input.fileName, 'filename')) hints.push(h);
  }
  for (const t of input.texts ?? []) {
    for (const h of scan(t, 'titleblock')) hints.push(h);
  }
  return hints;
}

function* scan(text: string, source: ScaleHint['source']): Generator<ScaleHint> {
  SCALE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCALE_PATTERN.exec(text)) !== null) {
    const denominator = Number(m[1]);
    if (PLAUSIBLE_DENOMINATORS.has(denominator)) {
      yield { denominator, source, match: m[0].replace(/^[^\d]/, '') };
    }
  }
}

/** Metres per PDF point at a paper scale of 1:denominator. */
export function metresPerPoint(denominator: number): number {
  return (denominator * 0.0254) / 72;
}

/**
 * Resolve the unit of a PDF page. Calibration (a measured distance) beats a
 * title block, which beats the file name; with nothing, the unit is 0 and the
 * caller must ask for calibration.
 */
export function resolvePdfUnits(input: {
  fileName?: string;
  texts?: readonly string[];
  /** Metres per point measured by the user, when they calibrated. */
  calibrationMetresPerPoint?: number;
}): UnitResolution {
  if (input.calibrationMetresPerPoint !== undefined && input.calibrationMetresPerPoint > 0) {
    return { source: 'calibration', metresPerUnit: input.calibrationMetresPerPoint };
  }
  const hints = findScaleHints(input);
  const fromSheet = hints.find((h) => h.source === 'titleblock');
  if (fromSheet) {
    return { source: 'titleblock', metresPerUnit: metresPerPoint(fromSheet.denominator), scaleDenominator: fromSheet.denominator };
  }
  const fromName = hints.find((h) => h.source === 'filename');
  if (fromName) {
    return { source: 'filename', metresPerUnit: metresPerPoint(fromName.denominator), scaleDenominator: fromName.denominator };
  }
  return { source: 'unknown', metresPerUnit: 0 };
}
