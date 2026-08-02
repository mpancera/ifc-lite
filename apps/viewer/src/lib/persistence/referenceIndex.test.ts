/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareAnchor, type ReferenceAnchor } from './referenceIndex.js';

const room: ReferenceAnchor = {
  globalId: 'gid-room', ifcType: 'IfcSpace', name: 'Buero 0.14', geometryHash: '12345',
};
const storey: ReferenceAnchor = {
  globalId: 'gid-storey', ifcType: 'IfcBuildingStorey', name: 'E00', geometryHash: null,
};

test('an anchor with the same geometry is unchanged', () => {
  assert.equal(compareAnchor(room, { exists: true, geometryHash: '12345' }), 'unchanged');
});

test('an anchor that kept its id but changed shape is reshaped', () => {
  // The case the existence check cannot see: an architect who re-plans a room
  // KEEPS its GlobalId — that is what GlobalIds are for — and changes its
  // geometry. Reported as unchanged, it would silently restore a detector that
  // now sits inside a new wall.
  assert.equal(compareAnchor(room, { exists: true, geometryHash: '99999' }), 'reshaped');
});

test('an anchor that is gone is missing', () => {
  assert.equal(compareAnchor(room, { exists: false, geometryHash: null }), 'missing');
});

test('an anchor without geometry on either side is unchanged', () => {
  // A storey has no mesh; its identity is the whole story.
  assert.equal(compareAnchor(storey, { exists: true, geometryHash: null }), 'unchanged');
});

test('a one-sided geometry hash reports unknown rather than guessing', () => {
  // Claiming "unchanged" when the check could not run is the dangerous
  // direction — it is the answer that lets bad data through silently.
  assert.equal(compareAnchor(room, { exists: true, geometryHash: null }), 'unknown');
  assert.equal(compareAnchor(storey, { exists: true, geometryHash: '5' }), 'unknown');
});
