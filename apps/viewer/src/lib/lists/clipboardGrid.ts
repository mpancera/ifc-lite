/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Excel-shaped clipboard handling for the editable list.
 *
 * Spreadsheets exchange a rectangle as tab-separated columns and newline-
 * separated rows, and that is what lands on the clipboard when someone copies
 * from Excel. Reading and writing that same shape is what makes "copy a column
 * out, fix it, paste it back" work at all.
 *
 * Pure — no DOM, no clipboard API, no store. The caller supplies the shape of
 * the table and which cells accept writes; this decides what a paste would do,
 * so the answer can be shown before anything is committed.
 */

/** Parse a clipboard payload into a rectangle of raw cell strings. */
export function parseClipboardGrid(text: string): string[][] {
  if (text === '') return [];
  // A copied range ends with a line break; that trailing empty line is part of
  // the format, not an extra row of blanks to paste over real values.
  const body = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  return body.split('\n').map((line) => line.split('\t'));
}

/** Render a rectangle in the same shape, so it pastes back into a spreadsheet. */
export function serializeClipboardGrid(grid: readonly (readonly string[])[]): string {
  return grid.map((row) => row.join('\t')).join('\n');
}

export interface PasteCell {
  rowIdx: number;
  colIdx: number;
  value: string;
}

export interface PastePlan {
  /** Writes to perform, in row-major order. */
  cells: PasteCell[];
  /** Cells the clipboard covered that fall outside the table. */
  skippedOutOfRange: number;
  /** Cells the clipboard covered that landed on a read-only column. */
  skippedReadOnly: number;
}

export interface PastePlanRequest {
  grid: readonly (readonly string[])[];
  anchorRow: number;
  anchorCol: number;
  rowCount: number;
  colCount: number;
  /** Whether the column at this index accepts writes. */
  isEditableColumn: (colIdx: number) => boolean;
}

/**
 * What pasting this clipboard at this anchor would change.
 *
 * Anything past the last row or column is dropped rather than growing the
 * table: a list is a view onto elements that already exist, so there is no
 * meaningful "new row". Read-only columns are counted separately from
 * out-of-range ones so the UI can tell the two apart — "3 cells outside the
 * table" and "3 cells in columns that cannot be written" call for different
 * corrections.
 *
 * A single copied cell fills the whole width the clipboard would have covered
 * only if the caller passes a 1×1 grid and handles repetition itself; this
 * function pastes exactly what it is given.
 */
export function planPaste(request: PastePlanRequest): PastePlan {
  const cells: PasteCell[] = [];
  let skippedOutOfRange = 0;
  let skippedReadOnly = 0;

  for (let r = 0; r < request.grid.length; r++) {
    const rowIdx = request.anchorRow + r;
    const source = request.grid[r];
    for (let c = 0; c < source.length; c++) {
      const colIdx = request.anchorCol + c;
      if (rowIdx >= request.rowCount || colIdx >= request.colCount) {
        skippedOutOfRange++;
        continue;
      }
      if (!request.isEditableColumn(colIdx)) {
        skippedReadOnly++;
        continue;
      }
      cells.push({ rowIdx, colIdx, value: source[c] });
    }
  }

  return { cells, skippedOutOfRange, skippedReadOnly };
}

/**
 * A one-line account of a plan, or `null` when everything applied cleanly.
 *
 * Silently dropping part of a paste is the failure mode that matters here:
 * someone pastes 40 values, 12 land, and nothing says so.
 */
export function describePastePlan(plan: PastePlan): string | null {
  const parts: string[] = [];
  if (plan.skippedReadOnly > 0) {
    parts.push(`${plan.skippedReadOnly} in nicht bearbeitbaren Spalten`);
  }
  if (plan.skippedOutOfRange > 0) {
    parts.push(`${plan.skippedOutOfRange} ausserhalb der Tabelle`);
  }
  if (parts.length === 0) return null;
  return `${plan.cells.length} Werte übernommen, übersprungen: ${parts.join(', ')}.`;
}
