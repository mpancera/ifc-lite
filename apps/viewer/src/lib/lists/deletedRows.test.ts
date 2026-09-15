/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A list result is a snapshot, and a deleted entity is the one change a
 * snapshot cannot survive: the row answers to nothing, selects an id the model
 * no longer has, and is counted in every total.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ListRow } from '@ifc-lite/lists';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import { dropDeletedRows } from './deletedRows.js';

function row(modelId: string, entityId: number): ListRow {
  return { modelId, entityId, values: [`#${entityId}`] };
}

/** Only the two methods this reads. */
function view(...deleted: number[]): MutablePropertyView {
  const set = new Set(deleted);
  return {
    getTombstones: () => set,
    isDeleted: (id: number) => set.has(id),
  } as unknown as MutablePropertyView;
}

describe('dropDeletedRows', () => {
  const rows = [row('m1', 1), row('m1', 2), row('m1', 3)];

  it('drops the row of an entity that was deleted', () => {
    const live = dropDeletedRows(rows, new Map([['m1', view(2)]]));

    assert.deepEqual(live.map((r) => r.entityId), [1, 3]);
  });

  it('leaves a list with no deletions untouched, by identity', () => {
    // The common case by far, and it feeds several memos downstream: a fresh
    // array every render would re-sort and re-convert the whole table.
    assert.equal(dropDeletedRows(rows, new Map([['m1', view()]])), rows);
    assert.equal(dropDeletedRows(rows, new Map()), rows);
  });

  it('only drops rows of the model the entity was deleted from', () => {
    // Express ids collide across a federation; deleting #2 in one model must
    // not remove #2 in another.
    const federated = [row('m1', 2), row('m2', 2)];
    const live = dropDeletedRows(federated, new Map([['m1', view(2)]]));

    assert.deepEqual(live.map((r) => r.modelId), ['m2']);
  });

  it('maps a single-model row to the legacy view', () => {
    // A one-model session writes rows under 'default' while the store keys the
    // view as 'legacy'. Without this nothing matches in exactly the ordinary
    // case — which is the case the report came from.
    const live = dropDeletedRows([row('default', 7)], new Map([['legacy', view(7)]]));

    assert.deepEqual(live, []);
  });

  it('keeps rows of a model that has no overlay at all', () => {
    const live = dropDeletedRows([row('m3', 9)], new Map([['m1', view(1)]]));

    assert.deepEqual(live.map((r) => r.entityId), [9]);
  });
});
