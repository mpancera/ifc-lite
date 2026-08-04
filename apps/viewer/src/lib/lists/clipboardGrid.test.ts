/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describePastePlan, parseClipboardGrid, planPaste, serializeClipboardGrid,
} from './clipboardGrid.js';

describe('parseClipboardGrid', () => {
  it('reads tab-separated columns and newline-separated rows', () => {
    assert.deepEqual(parseClipboardGrid('a\tb\nc\td'), [['a', 'b'], ['c', 'd']]);
  });

  it('drops the trailing line break a copied range carries', () => {
    // Excel ends the payload with a newline; treating it as a row would paste
    // a line of blanks over real values.
    assert.deepEqual(parseClipboardGrid('a\nb\n'), [['a'], ['b']]);
  });

  it('handles Windows line endings', () => {
    assert.deepEqual(parseClipboardGrid('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
  });

  it('keeps an empty cell in the middle of a row', () => {
    assert.deepEqual(parseClipboardGrid('a\t\tc'), [['a', '', 'c']]);
  });

  it('reads a single value as a 1×1 rectangle', () => {
    assert.deepEqual(parseClipboardGrid('06'), [['06']]);
  });

  it('reads nothing from an empty payload', () => {
    assert.deepEqual(parseClipboardGrid(''), []);
  });
});

describe('serializeClipboardGrid', () => {
  it('round-trips through parse', () => {
    const grid = [['a', 'b'], ['c', '']];
    assert.deepEqual(parseClipboardGrid(serializeClipboardGrid(grid)), grid);
  });
});

describe('planPaste · onto a single cell', () => {
  const allEditable = () => true;
  const at = (rowIdx: number, colIdx: number) =>
    ({ fromRow: rowIdx, toRow: rowIdx, fromCol: colIdx, toCol: colIdx });

  it('lands each value at its offset from the selected cell', () => {
    const plan = planPaste({
      grid: [['x', 'y'], ['z', 'w']],
      target: at(1, 2), rowCount: 5, colCount: 5, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells, [
      { rowIdx: 1, colIdx: 2, value: 'x' },
      { rowIdx: 1, colIdx: 3, value: 'y' },
      { rowIdx: 2, colIdx: 2, value: 'z' },
      { rowIdx: 2, colIdx: 3, value: 'w' },
    ]);
  });

  it('drops what falls past the last row instead of growing the table', () => {
    // A list is a view onto elements that already exist; there is no new row
    // to create.
    const plan = planPaste({
      grid: [['a'], ['b'], ['c']],
      target: at(1, 0), rowCount: 2, colCount: 1, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells, [{ rowIdx: 1, colIdx: 0, value: 'a' }]);
    assert.equal(plan.skippedOutOfRange, 2);
  });

  it('drops what falls past the last column', () => {
    const plan = planPaste({
      grid: [['a', 'b', 'c']],
      target: at(0, 1), rowCount: 1, colCount: 2, isEditableColumn: allEditable,
    });

    assert.equal(plan.cells.length, 1);
    assert.equal(plan.skippedOutOfRange, 2);
  });

  it('counts read-only columns apart from out-of-range cells', () => {
    // The two need different corrections, so one combined number would not
    // tell anyone what to do.
    const plan = planPaste({
      grid: [['a', 'b', 'c']],
      target: at(0, 0), rowCount: 1, colCount: 2,
      isEditableColumn: (c) => c === 0,
    });

    assert.deepEqual(plan.cells, [{ rowIdx: 0, colIdx: 0, value: 'a' }]);
    assert.equal(plan.skippedReadOnly, 1);
    assert.equal(plan.skippedOutOfRange, 1);
  });

  it('pastes an empty string, which is how a value gets cleared', () => {
    const plan = planPaste({
      grid: [['']],
      target: at(0, 0), rowCount: 1, colCount: 1, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells, [{ rowIdx: 0, colIdx: 0, value: '' }]);
  });

  it('plans nothing from an empty clipboard', () => {
    const plan = planPaste({
      grid: [], target: at(0, 0), rowCount: 3, colCount: 3, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells, []);
  });
});

describe('planPaste · onto a selected range', () => {
  const allEditable = () => true;

  it('fills every selected cell from a single copied value', () => {
    // The case that was broken: mark a block, paste one value, and only the
    // corner changed.
    const plan = planPaste({
      grid: [['EI30']],
      target: { fromRow: 0, toRow: 2, fromCol: 1, toCol: 2 },
      rowCount: 10, colCount: 10, isEditableColumn: allEditable,
    });

    assert.equal(plan.cells.length, 6);
    assert.ok(plan.cells.every((c) => c.value === 'EI30'));
    assert.deepEqual(plan.cells[0], { rowIdx: 0, colIdx: 1, value: 'EI30' });
    assert.deepEqual(plan.cells[5], { rowIdx: 2, colIdx: 2, value: 'EI30' });
  });

  it('starts at the top-left of the selection, not the cell it was dragged to', () => {
    // Shift-click leaves the active cell at the far corner; anchoring there
    // pasted below and right of what was marked.
    const plan = planPaste({
      grid: [['v']],
      target: { fromRow: 2, toRow: 4, fromCol: 0, toCol: 0 },
      rowCount: 10, colCount: 3, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells.map((c) => c.rowIdx), [2, 3, 4]);
  });

  it('repeats a shorter clipboard down the selection', () => {
    const plan = planPaste({
      grid: [['a'], ['b']],
      target: { fromRow: 0, toRow: 5, fromCol: 0, toCol: 0 },
      rowCount: 10, colCount: 1, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells.map((c) => c.value), ['a', 'b', 'a', 'b', 'a', 'b']);
  });

  it('repeats across a selection that is not a whole multiple', () => {
    const plan = planPaste({
      grid: [['a'], ['b']],
      target: { fromRow: 0, toRow: 2, fromCol: 0, toCol: 0 },
      rowCount: 10, colCount: 1, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells.map((c) => c.value), ['a', 'b', 'a']);
  });

  it('lets a clipboard larger than the selection paint its own extent', () => {
    // Copy 40 values, click one cell, paste — all 40 land. The selection only
    // ever grows the target, never clips it.
    const plan = planPaste({
      grid: [['a'], ['b'], ['c']],
      target: { fromRow: 0, toRow: 0, fromCol: 0, toCol: 0 },
      rowCount: 10, colCount: 1, isEditableColumn: allEditable,
    });

    assert.equal(plan.cells.length, 3);
  });

  it('repeats a ragged clipboard row across its own width', () => {
    const plan = planPaste({
      grid: [['a', 'b'], ['c']],
      target: { fromRow: 0, toRow: 1, fromCol: 0, toCol: 3 },
      rowCount: 10, colCount: 10, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells.filter((c) => c.rowIdx === 0).map((c) => c.value), ['a', 'b', 'a', 'b']);
    assert.deepEqual(plan.cells.filter((c) => c.rowIdx === 1).map((c) => c.value), ['c', 'c', 'c', 'c']);
  });

  it('still refuses read-only columns inside the selection', () => {
    const plan = planPaste({
      grid: [['x']],
      target: { fromRow: 0, toRow: 0, fromCol: 0, toCol: 2 },
      rowCount: 5, colCount: 5, isEditableColumn: (c) => c !== 1,
    });

    assert.deepEqual(plan.cells.map((c) => c.colIdx), [0, 2]);
    assert.equal(plan.skippedReadOnly, 1);
  });
});

describe('describePastePlan', () => {
  it('says nothing when everything applied', () => {
    assert.equal(describePastePlan({ cells: [], skippedOutOfRange: 0, skippedReadOnly: 0 }), null);
  });

  it('reports both kinds of skip', () => {
    // Silently dropping part of a paste is the failure that matters: 40 values
    // pasted, 12 land, nothing says so.
    const text = describePastePlan({
      cells: [{ rowIdx: 0, colIdx: 0, value: 'a' }],
      skippedOutOfRange: 2,
      skippedReadOnly: 3,
    });

    assert.ok(text);
    assert.match(text!, /1 Werte übernommen/);
    assert.match(text!, /3 in nicht bearbeitbaren Spalten/);
    assert.match(text!, /2 ausserhalb der Tabelle/);
  });
});
