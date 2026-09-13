/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listFromSelection } from './selectionList.js';

describe('listFromSelection', () => {
  it('keeps the models apart, because express ids collide across files', () => {
    const list = listFromSelection([
      { modelId: 'a', expressId: 41 },
      { modelId: 'b', expressId: 41 },
    ], 1, 'fixed');
    assert.deepEqual(list?.expressIdsByModel, { a: [41], b: [41] });
  });

  it('counts an element once even if the selection carries it twice', () => {
    const list = listFromSelection([
      { modelId: 'a', expressId: 41 },
      { modelId: 'a', expressId: 41 },
    ], 1, 'fixed');
    assert.deepEqual(list?.expressIdsByModel, { a: [41] });
    assert.equal(list?.name, 'Auswahl (1)');
  });

  it('answers null for an empty selection rather than an empty list', () => {
    assert.equal(listFromSelection([], 1, 'fixed'), null);
  });

  it('ignores the entity-type scope, so the snapshot is the whole scope', () => {
    const list = listFromSelection([{ modelId: 'a', expressId: 7 }], 1, 'fixed');
    assert.deepEqual(list?.entityTypes, []);
    assert.deepEqual(list?.conditions, []);
  });

  it('brings the storey along — the column the selection count cannot show', () => {
    const list = listFromSelection([{ modelId: 'a', expressId: 7 }], 1, 'fixed');
    assert.ok(list?.columns.some((c) => c.source === 'spatial' && c.propertyName === 'Storey'));
  });
});
