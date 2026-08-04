/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rangeBetween, rangeContains } from './useEditableListGrid.js';

describe('rangeBetween', () => {
  it('normalises a selection dragged down and right', () => {
    assert.deepEqual(
      rangeBetween({ rowIdx: 1, colIdx: 2 }, { rowIdx: 4, colIdx: 5 }),
      { fromRow: 1, toRow: 4, fromCol: 2, toCol: 5 },
    );
  });

  it('normalises one dragged up and left, so both directions select the same block', () => {
    assert.deepEqual(
      rangeBetween({ rowIdx: 4, colIdx: 5 }, { rowIdx: 1, colIdx: 2 }),
      { fromRow: 1, toRow: 4, fromCol: 2, toCol: 5 },
    );
  });

  it('makes a single cell a 1×1 range', () => {
    assert.deepEqual(
      rangeBetween({ rowIdx: 3, colIdx: 3 }, { rowIdx: 3, colIdx: 3 }),
      { fromRow: 3, toRow: 3, fromCol: 3, toCol: 3 },
    );
  });
});

describe('rangeContains', () => {
  const range = { fromRow: 1, toRow: 3, fromCol: 2, toCol: 4 };

  it('includes the corners', () => {
    // Inclusive on both ends — an off-by-one here would drop a whole edge of
    // the selection from a copy.
    assert.equal(rangeContains(range, 1, 2), true);
    assert.equal(rangeContains(range, 3, 4), true);
  });

  it('excludes cells just outside', () => {
    assert.equal(rangeContains(range, 0, 2), false);
    assert.equal(rangeContains(range, 4, 2), false);
    assert.equal(rangeContains(range, 1, 1), false);
    assert.equal(rangeContains(range, 1, 5), false);
  });

  it('contains nothing when there is no selection', () => {
    assert.equal(rangeContains(null, 0, 0), false);
  });
});
