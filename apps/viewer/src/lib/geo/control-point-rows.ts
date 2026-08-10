/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning a half-filled table of reference points into something solvable.
 *
 * Kept out of the component because the index bookkeeping is the part that can
 * be quietly wrong: the solver only ever sees the COMPLETE rows, so the
 * residual it reports as `[0]` belongs to whichever table row happened to be
 * the first complete one — not to the first row. Getting that mapping backwards
 * would blame the wrong point, which is worse than reporting no residual at
 * all, because it reads as authoritative.
 */

import type { ControlPointPair } from './solve-georeference';

/** One table row. Fields are strings: a half-typed number has to survive a
 *  re-render, and a field cleared to retype must not read as 0. */
export interface ControlPointRow {
  id: string;
  label: string;
  localX: string;
  localY: string;
  easting: string;
  northing: string;
}

/**
 * A finite number, or `null` for anything that is not one yet.
 *
 * Accepts a comma as decimal separator: the coordinates come off Swiss and
 * German survey listings and out of spreadsheets, where a comma is what the
 * locale produces. Refusing it would reject a correctly copied coordinate.
 */
export function parseCoordinateField(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ControlPointSelection {
  /** Complete rows only, in table order, ready for `solveGeoreference`. */
  pairs: ControlPointPair[];
  /** `rowIds[i]` is the table row that produced `pairs[i]`. */
  rowIds: string[];
}

/**
 * Collect the rows that carry all four coordinates, keeping a parallel list of
 * which row each one came from so a solved residual can be shown against it.
 */
export function rowsToPairs(rows: readonly ControlPointRow[]): ControlPointSelection {
  const pairs: ControlPointPair[] = [];
  const rowIds: string[] = [];

  for (const row of rows) {
    const x = parseCoordinateField(row.localX);
    const y = parseCoordinateField(row.localY);
    const easting = parseCoordinateField(row.easting);
    const northing = parseCoordinateField(row.northing);
    if (x === null || y === null || easting === null || northing === null) continue;

    pairs.push({
      local: { x, y },
      map: { easting, northing },
      label: row.label.trim() || undefined,
    });
    rowIds.push(row.id);
  }

  return { pairs, rowIds };
}
