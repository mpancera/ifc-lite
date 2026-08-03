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

// ── project identity ──

import { isSameProject } from './referenceIndex.js';
import type { ReferenceModelIndex } from './referenceIndex.js';

const PROJECT_A = { globalId: 'gid-project-A', name: 'MOD' };
const PROJECT_B = { globalId: 'gid-project-B', name: 'Anderes Haus' };

function indexFor(project: typeof PROJECT_A | undefined, anchors: string[] = ['gid-storey']): ReferenceModelIndex {
  return {
    globalIds: anchors,
    anchors: anchors.map((globalId) => ({
      globalId, ifcType: 'IfcBuildingStorey', name: '', geometryHash: null,
    })),
    project,
  };
}

const allAnchorsPresent = () => true;
const noAnchorsPresent = () => false;

test('a newer version of the same project matches', () => {
  assert.equal(isSameProject(indexFor(PROJECT_A), PROJECT_A, allAnchorsPresent), true);
});

test('a different project does not match, even with everything else intact', () => {
  // The case that made the prompt appear for every file: product types and
  // systems reference nothing in the architecture model, so reconciliation
  // alone always finds something that "still applies".
  assert.equal(isSameProject(indexFor(PROJECT_A), PROJECT_B, allAnchorsPresent), false);
});

test('a snapshot without project identity falls back to its anchors', () => {
  // Older snapshots predate the project field and must still be offerable.
  assert.equal(isSameProject(indexFor(undefined), PROJECT_A, allAnchorsPresent), true);
  assert.equal(isSameProject(indexFor(undefined), PROJECT_A, noAnchorsPresent), false);
});

test('a file without an IfcProject falls back to anchors too', () => {
  assert.equal(isSameProject(indexFor(PROJECT_A), undefined, allAnchorsPresent), true);
  assert.equal(isSameProject(indexFor(PROJECT_A), undefined, noAnchorsPresent), false);
});

test('a snapshot with neither identity nor anchors is never offered', () => {
  assert.equal(isSameProject(indexFor(undefined, []), undefined, allAnchorsPresent), false);
  assert.equal(isSameProject(undefined, PROJECT_A, allAnchorsPresent), false);
});
