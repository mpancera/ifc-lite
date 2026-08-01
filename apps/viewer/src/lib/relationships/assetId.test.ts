/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeIdSegment, buildAssetIdPrefix, nextAssetId } from './assetId.js';

test('sanitizeIdSegment: uppercases and collapses punctuation/spaces to hyphens', () => {
  assert.equal(sanitizeIdSegment('Grosspeter Tower'), 'GROSSPETER-TOWER');
  assert.equal(sanitizeIdSegment('  o03  '), 'O03');
  assert.equal(sanitizeIdSegment('Büro 1.2'), 'B-RO-1-2');
});

test('sanitizeIdSegment: falls back to UNK for empty/unnameable input', () => {
  assert.equal(sanitizeIdSegment(''), 'UNK');
  assert.equal(sanitizeIdSegment('   '), 'UNK');
  assert.equal(sanitizeIdSegment('###'), 'UNK');
});

test('buildAssetIdPrefix: joins five sanitized segments with dots', () => {
  const prefix = buildAssetIdPrefix({
    site: 'Grosspeteranlage 29', building: 'Tower', floor: 'E00', space: 'Büro', assetType: 'detector',
  });
  assert.equal(prefix, 'GROSSPETERANLAGE-29.TOWER.E00.B-RO.DETECTOR');
});

test('nextAssetId: starts at 001 when no existing tags match the prefix', () => {
  const id = nextAssetId(
    { site: 'S', building: 'B', floor: 'F', space: 'R', assetType: 'DETECTOR' },
    ['S.B.F.OTHER.DETECTOR.001', 'unrelated-tag'],
  );
  assert.equal(id, 'S.B.F.R.DETECTOR.001');
});

test('nextAssetId: continues from the highest existing counter for the same prefix', () => {
  const parts = { site: 'S', building: 'B', floor: 'F', space: 'R', assetType: 'DETECTOR' };
  const id = nextAssetId(parts, ['S.B.F.R.DETECTOR.001', 'S.B.F.R.DETECTOR.007', 'S.B.F.R.DETECTOR.003']);
  assert.equal(id, 'S.B.F.R.DETECTOR.008');
});

test('nextAssetId: ignores tags with a different asset type in the same space', () => {
  const parts = { site: 'S', building: 'B', floor: 'F', space: 'R', assetType: 'CAMERA' };
  const id = nextAssetId(parts, ['S.B.F.R.DETECTOR.005']);
  assert.equal(id, 'S.B.F.R.CAMERA.001');
});

test('nextAssetId: respects a custom counter width', () => {
  const id = nextAssetId(
    { site: 'S', building: 'B', floor: 'F', space: 'R', assetType: 'DETECTOR' },
    [],
    2,
  );
  assert.equal(id, 'S.B.F.R.DETECTOR.01');
});
