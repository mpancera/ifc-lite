/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectedEntityRefs, type SelectionChannels } from './selectedRefs.js';

const empty: SelectionChannels = {
  selectedEntity: null,
  selectedEntities: [],
  selectedEntitiesSet: new Set<string>(),
};

describe('selectedEntityRefs', () => {
  it('reads the channel Ctrl-click fills — the one a multi-select actually uses', () => {
    const refs = selectedEntityRefs({
      ...empty,
      selectedEntitiesSet: new Set(['m1:41', 'm1:57', 'm1:63']),
      // Multi-select also parks the last pick here; it must not shrink the answer.
      selectedEntity: { modelId: 'm1', expressId: 63 },
    });
    assert.deepEqual(refs.map((r) => r.expressId).sort((a, b) => a - b), [41, 57, 63]);
  });

  it('reads the array channel too, and does not count a ref twice', () => {
    const refs = selectedEntityRefs({
      selectedEntitiesSet: new Set(['m1:41']),
      selectedEntities: [{ modelId: 'm1', expressId: 41 }, { modelId: 'm1', expressId: 42 }],
      selectedEntity: { modelId: 'm1', expressId: 42 },
    });
    assert.equal(refs.length, 2);
  });

  it('falls back to the primary, because a plain click reaches neither set', () => {
    const refs = selectedEntityRefs({ ...empty, selectedEntity: { modelId: 'm1', expressId: 7 } });
    assert.deepEqual(refs, [{ modelId: 'm1', expressId: 7 }]);
  });

  it('keeps the models apart, so a federated pick is not silently merged', () => {
    const refs = selectedEntityRefs({ ...empty, selectedEntitiesSet: new Set(['m1:41', 'm2:41']) });
    assert.deepEqual(refs.map((r) => r.modelId), ['m1', 'm2']);
  });

  it('drops a malformed key instead of handing on express id -1', () => {
    // `stringToEntityRef` answers -1 rather than throwing; an edit acting on
    // that would go to whatever entity -1 resolves to.
    assert.deepEqual(selectedEntityRefs({ ...empty, selectedEntitiesSet: new Set(['nonsense']) }), []);
  });

  it('answers empty for an empty selection', () => {
    assert.deepEqual(selectedEntityRefs(empty), []);
  });
});
