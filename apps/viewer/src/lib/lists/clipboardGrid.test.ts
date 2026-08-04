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

describe('planPaste', () => {
  const allEditable = () => true;

  it('lands each value at its offset from the anchor', () => {
    const plan = planPaste({
      grid: [['x', 'y'], ['z', 'w']],
      anchorRow: 1, anchorCol: 2, rowCount: 5, colCount: 5, isEditableColumn: allEditable,
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
      anchorRow: 1, anchorCol: 0, rowCount: 2, colCount: 1, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells, [{ rowIdx: 1, colIdx: 0, value: 'a' }]);
    assert.equal(plan.skippedOutOfRange, 2);
  });

  it('drops what falls past the last column', () => {
    const plan = planPaste({
      grid: [['a', 'b', 'c']],
      anchorRow: 0, anchorCol: 1, rowCount: 1, colCount: 2, isEditableColumn: allEditable,
    });

    assert.equal(plan.cells.length, 1);
    assert.equal(plan.skippedOutOfRange, 2);
  });

  it('counts read-only columns apart from out-of-range cells', () => {
    // The two need different corrections, so one combined number would not
    // tell anyone what to do.
    const plan = planPaste({
      grid: [['a', 'b', 'c']],
      anchorRow: 0, anchorCol: 0, rowCount: 1, colCount: 2,
      isEditableColumn: (c) => c === 0,
    });

    assert.deepEqual(plan.cells, [{ rowIdx: 0, colIdx: 0, value: 'a' }]);
    assert.equal(plan.skippedReadOnly, 1);
    assert.equal(plan.skippedOutOfRange, 1);
  });

  it('pastes an empty string, which is how a value gets cleared', () => {
    const plan = planPaste({
      grid: [['']],
      anchorRow: 0, anchorCol: 0, rowCount: 1, colCount: 1, isEditableColumn: allEditable,
    });

    assert.deepEqual(plan.cells, [{ rowIdx: 0, colIdx: 0, value: '' }]);
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
