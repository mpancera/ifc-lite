/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The spreadsheet behaviour of the editable list: an active cell, typing into
 * it, and copy/paste across a rectangle.
 *
 * Two things are worth knowing about the design.
 *
 * **Committed values are patched in, not re-queried.** Re-running the list after
 * every keystroke would be correct and unusable: the row would re-sort and
 * re-group under the cursor, so the next cell you meant to type into is no
 * longer where you are looking. Instead a committed value is remembered by
 * `modelId:entityId:column` and painted over the executed result. The overlay is
 * the source of truth either way — the next explicit Run reconciles everything,
 * including values that changed as a *consequence* (a Smart Property that
 * depends on the cell just edited).
 *
 * **Row indices are display indices.** Paste lands where the user is looking,
 * which is the sorted and grouped order, not the order the engine returned.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ColumnDefinition, ListRow } from '@ifc-lite/lists';
import { cellEditability } from '@/lib/lists/editTarget';
import {
  describePastePlan, parseClipboardGrid, planPaste, serializeClipboardGrid,
} from '@/lib/lists/clipboardGrid';
import type { CellEditRequest, CellEditResult } from '@/hooks/useListCellEdit';

export interface CellAddress { rowIdx: number; colIdx: number }

type CommitCell = (request: CellEditRequest) => CellEditResult;

function patchKey(row: ListRow, colIdx: number): string {
  return `${row.modelId}:${row.entityId}:${colIdx}`;
}

/** An inclusive rectangle of cells, normalised so `from` is the top-left. */
export interface CellRange {
  fromRow: number; toRow: number; fromCol: number; toCol: number;
}

/** The rectangle spanned by an anchor and the cell the selection was dragged to. */
export function rangeBetween(anchor: CellAddress, focus: CellAddress): CellRange {
  return {
    fromRow: Math.min(anchor.rowIdx, focus.rowIdx),
    toRow: Math.max(anchor.rowIdx, focus.rowIdx),
    fromCol: Math.min(anchor.colIdx, focus.colIdx),
    toCol: Math.max(anchor.colIdx, focus.colIdx),
  };
}

export function rangeContains(range: CellRange | null, rowIdx: number, colIdx: number): boolean {
  if (!range) return false;
  return rowIdx >= range.fromRow && rowIdx <= range.toRow
    && colIdx >= range.fromCol && colIdx <= range.toCol;
}

export interface EditableListGrid {
  active: CellAddress | null;
  /** The selected rectangle; a single cell selection is a 1×1 range. */
  range: CellRange | null;
  editing: boolean;
  /** Per column, whether it accepts input — drives the cursor and the styling. */
  editableColumns: boolean[];
  /** Draft text while a cell is open; `null` when nothing is being edited. */
  draft: string | null;
  /** Last refusal or paste summary, for the caller to surface. */
  notice: string | null;
  clearNotice: () => void;
  /** Committed value for this cell, or `undefined` to show the executed one. */
  patchFor: (row: ListRow, colIdx: number) => unknown;
  beginEdit: (address: CellAddress, seed?: string) => void;
  setDraft: (text: string) => void;
  cancelEdit: () => void;
  /**
   * Commit `text` into the active cell; `advance` moves on afterwards.
   *
   * The text is passed in rather than read from state on purpose: the open
   * editor is the only thing that knows the current keystroke, and reading it
   * back through a ref meant a second handler firing on the same key could
   * commit a value that was already one render stale.
   */
  commitDraft: (text: string, advance?: 'down' | 'right' | 'none') => void;
  /** Click a cell. `extend` (shift-click) grows the range from the anchor. */
  selectCell: (address: CellAddress, extend?: boolean) => void;
  /** Handles the keys a grid owns; returns whether it consumed the event. */
  handleKeyDown: (event: React.KeyboardEvent) => boolean;
  /** Wired to the container's onCopy/onPaste. */
  handleCopy: (event: React.ClipboardEvent) => void;
  handlePaste: (event: React.ClipboardEvent) => void;

  // ── Fill handle ──
  /** Rows the in-progress fill drag would write, or `null` when idle. */
  fillPreview: CellRange | null;
  /** Grab the handle at the bottom-right of the selection. */
  beginFill: () => void;
  /** Drag reached this row. */
  extendFill: (rowIdx: number) => void;
  /** Release: repeat the selection's values down the dragged rows. */
  endFill: () => void;
}

export interface EditableListGridOptions {
  enabled: boolean;
  /** Rows in display order — sorted, grouped, filtered. */
  rows: ListRow[];
  columns: ColumnDefinition[];
  /** The value shown in a cell right now, patches included. */
  displayedValue: (rowIdx: number, colIdx: number) => unknown;
  commitCell: CommitCell;
}

export function useEditableListGrid(options: EditableListGridOptions): EditableListGrid {
  const { enabled, rows, columns, displayedValue, commitCell } = options;

  // `active` is the cell you type into; `anchor` is where the current
  // selection started. They differ only while a range is being extended —
  // shift-click and shift-arrow move `active` and keep `anchor` put, exactly
  // as a spreadsheet does.
  const [active, setActive] = useState<CellAddress | null>(null);
  const [anchor, setAnchor] = useState<CellAddress | null>(null);
  const [draft, setDraftState] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [patches, setPatches] = useState<Map<string, unknown>>(() => new Map());
  // Read inside callbacks that must not re-create on every keystroke.
  // Mirrors `draft`, but written eagerly by the actions above so callbacks can
  // ask "is a cell open" without waiting for a render.
  const draftRef = useRef<string | null>(null);

  /** Per column: the write target, or the reason there is none. Computed once
   *  so the render path never re-derives the rules per cell. */
  const columnRules = useMemo(() => columns.map((column) => cellEditability(column)), [columns]);
  const editableCols = useMemo(() => columnRules.map((rule) => rule.editable), [columnRules]);

  const patchFor = useCallback(
    (row: ListRow, colIdx: number) => patches.get(patchKey(row, colIdx)),
    [patches]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const range = useMemo(
    () => (active && anchor ? rangeBetween(anchor, active) : null),
    [active, anchor]);

  const selectCell = useCallback((address: CellAddress, extend = false) => {
    setActive(address);
    if (!extend) setAnchor(address);
    draftRef.current = null;
    setDraftState(null);
  }, []);

  const beginEdit = useCallback((address: CellAddress, seed?: string) => {
    if (!enabled) return;
    const rule = columnRules[address.colIdx];
    if (!rule || !rule.editable) {
      // Say why rather than doing nothing — a cell that ignores a double-click
      // is indistinguishable from a broken one.
      setActive(address);
      setAnchor(address);
      setNotice(rule ? rule.reason : null);
      return;
    }
    // Opening a cell collapses any range to it: what you type goes in one place.
    setActive(address);
    setAnchor(address);
    const current = displayedValue(address.rowIdx, address.colIdx);
    const opening = seed ?? (current === null || current === undefined ? '' : String(current));
    // Set the ref alongside the state so the "is a cell open" guard is true
    // immediately, not one render later.
    draftRef.current = opening;
    setDraftState(opening);
  }, [enabled, columnRules, displayedValue]);

  const setDraft = useCallback((text: string) => { draftRef.current = text; setDraftState(text); }, []);
  const cancelEdit = useCallback(() => { draftRef.current = null; setDraftState(null); }, []);

  /** Write one cell and remember what it now shows. Returns success. */
  const writeCell = useCallback((rowIdx: number, colIdx: number, raw: string): boolean => {
    const row = rows[rowIdx];
    const column = columns[colIdx];
    if (!row || !column) return false;

    const result = commitCell({
      modelId: row.modelId,
      entityId: row.entityId,
      column,
      raw,
      previous: displayedValue(rowIdx, colIdx),
    });

    if (!result.ok) {
      setNotice(result.reason);
      return false;
    }
    if (result.changed) {
      setPatches((prev) => new Map(prev).set(patchKey(row, colIdx), raw));
    }
    return true;
  }, [rows, columns, commitCell, displayedValue]);

  const commitDraft = useCallback((text: string, advance: 'down' | 'right' | 'none' = 'down') => {
    const address = active;
    // Closing first makes a second delivery of the same key a no-op rather
    // than a second write.
    if (draftRef.current === null) return;
    draftRef.current = null;
    setDraftState(null);
    if (!address) return;

    writeCell(address.rowIdx, address.colIdx, text);

    if (advance === 'down' && address.rowIdx + 1 < rows.length) {
      const next = { rowIdx: address.rowIdx + 1, colIdx: address.colIdx };
      setActive(next); setAnchor(next);
    } else if (advance === 'right' && address.colIdx + 1 < columns.length) {
      const next = { rowIdx: address.rowIdx, colIdx: address.colIdx + 1 };
      setActive(next); setAnchor(next);
    }
  }, [active, rows.length, columns.length, writeCell]);

  /** Move the active cell; `extend` keeps the anchor so the range grows. */
  const move = useCallback((dRow: number, dCol: number, extend = false) => {
    setActive((current) => {
      if (!current) return current;
      const next = {
        rowIdx: Math.min(Math.max(current.rowIdx + dRow, 0), Math.max(rows.length - 1, 0)),
        colIdx: Math.min(Math.max(current.colIdx + dCol, 0), Math.max(columns.length - 1, 0)),
      };
      if (!extend) setAnchor(next);
      return next;
    });
  }, [rows.length, columns.length]);

  /** Empty every writable cell in the selection. */
  const clearRange = useCallback(() => {
    if (!range) return;
    for (let r = range.fromRow; r <= range.toRow; r++) {
      for (let c = range.fromCol; c <= range.toCol; c++) {
        if (editableCols[c]) writeCell(r, c, '');
      }
    }
  }, [range, editableCols, writeCell]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent): boolean => {
    if (!enabled || !active) return false;

    // While a cell is open the editor input owns its own keys — see the
    // `onKeyDown` there. Handling them here as well meant one keystroke could
    // be delivered twice.
    if (draftRef.current !== null) return false;

    // Shift extends the selection instead of moving it, which is the only way
    // to grow a range from the keyboard.
    const extend = event.shiftKey;
    switch (event.key) {
      case 'ArrowDown': move(1, 0, extend); return true;
      case 'ArrowUp': move(-1, 0, extend); return true;
      case 'ArrowRight': move(0, 1, extend); return true;
      case 'ArrowLeft': move(0, -1, extend); return true;
      case 'Enter':
      case 'F2':
        beginEdit(active); return true;
      case 'Delete':
      case 'Backspace':
        clearRange(); return true;
      default:
        break;
    }

    // Typing a printable character replaces the cell, the way a spreadsheet
    // does — no need to open the editor first.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      beginEdit(active, event.key);
      return true;
    }
    return false;
  }, [enabled, active, move, beginEdit, clearRange]);

  // ── Fill handle ──
  // Dragging the corner repeats the selection downwards. It reuses `planPaste`
  // rather than growing a second copy of the same rules: tiling, the table
  // bounds and the read-only accounting all have to behave identically to a
  // paste, because to the model they ARE one.
  const [fillSource, setFillSource] = useState<CellRange | null>(null);
  const [fillToRow, setFillToRow] = useState<number | null>(null);
  // The drag is also held in a ref: `mousedown` and the first `mouseenter`
  // arrive in the same tick, so a hover asking "is a drag running" through
  // state would still see `null` and drop the row it was over.
  const fillSourceRef = useRef<CellRange | null>(null);

  const fillPreview = useMemo(() => {
    if (!fillSource || fillToRow === null || fillToRow <= fillSource.toRow) return null;
    return { ...fillSource, toRow: fillToRow };
  }, [fillSource, fillToRow]);

  const beginFill = useCallback(() => {
    if (!enabled || !range) return;
    fillSourceRef.current = range;
    setFillSource(range);
    setFillToRow(range.toRow);
  }, [enabled, range]);

  const extendFill = useCallback((rowIdx: number) => {
    // Every cell reports hover; only a running drag cares.
    const source = fillSourceRef.current;
    if (!source) return;
    setFillToRow(Math.max(rowIdx, source.toRow));
  }, []);

  const endFill = useCallback(() => {
    const source = fillSourceRef.current;
    const toRow = fillToRow;
    fillSourceRef.current = null;
    setFillSource(null);
    setFillToRow(null);
    if (!source || toRow === null || toRow <= source.toRow) return;

    // The dragged rows only — the source keeps the values it already has.
    const grid: string[][] = [];
    for (let r = source.fromRow; r <= source.toRow; r++) {
      const line: string[] = [];
      for (let c = source.fromCol; c <= source.toCol; c++) {
        const value = displayedValue(r, c);
        line.push(value === null || value === undefined ? '' : String(value));
      }
      grid.push(line);
    }

    const plan = planPaste({
      grid,
      target: { ...source, fromRow: source.toRow + 1, toRow },
      rowCount: rows.length,
      colCount: columns.length,
      isEditableColumn: (colIdx) => editableCols[colIdx] ?? false,
    });

    let written = 0;
    for (const cell of plan.cells) {
      if (writeCell(cell.rowIdx, cell.colIdx, cell.value)) written++;
    }
    const summary = describePastePlan(plan);
    if (summary) setNotice(summary);
    else if (written > 0) setNotice(`${written} Werte übernommen.`);
  }, [fillToRow, displayedValue, rows.length, columns.length, editableCols, writeCell]);

  const handleCopy = useCallback((event: React.ClipboardEvent) => {
    if (!enabled || !range) return;
    // The whole rectangle, in the tab/newline shape a spreadsheet expects, so
    // a column of values can be lifted out, fixed elsewhere and pasted back.
    const grid: string[][] = [];
    for (let r = range.fromRow; r <= range.toRow; r++) {
      const line: string[] = [];
      for (let c = range.fromCol; c <= range.toCol; c++) {
        const value = displayedValue(r, c);
        line.push(value === null || value === undefined ? '' : String(value));
      }
      grid.push(line);
    }
    event.clipboardData.setData('text/plain', serializeClipboardGrid(grid));
    event.preventDefault();
  }, [enabled, range, displayedValue]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    if (!enabled || !range) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();

    // The SELECTION is the target, not the cell the selection happens to end
    // on. Anchoring at `active` put a paste at the corner the range was dragged
    // to — below and right of what was marked — and a single copied value
    // reached one cell instead of filling the block.
    const plan = planPaste({
      grid: parseClipboardGrid(text),
      target: range,
      rowCount: rows.length,
      colCount: columns.length,
      isEditableColumn: (colIdx) => editableCols[colIdx] ?? false,
    });

    let written = 0;
    for (const cell of plan.cells) {
      if (writeCell(cell.rowIdx, cell.colIdx, cell.value)) written++;
    }

    const summary = describePastePlan(plan);
    if (summary) setNotice(summary);
    else if (written > 0) setNotice(`${written} Werte übernommen.`);
  }, [enabled, range, rows.length, columns.length, editableCols, writeCell]);

  return {
    active, range, editing: draft !== null, editableColumns: editableCols, draft, notice, clearNotice,
    patchFor, beginEdit, setDraft, cancelEdit, commitDraft, selectCell,
    handleKeyDown, handleCopy, handlePaste,
    fillPreview, beginFill, extendFill, endFill,
  };
}
