/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalSeedCatalogProvider } from './localSeedCatalog.js';

test('every entry has a unique id', () => {
  const entries = new LocalSeedCatalogProvider().listEntries();
  const ids = new Set(entries.map((e) => e.id));
  assert.equal(ids.size, entries.length);
});

test('every entry has a positive geometry hint and a non-empty IFC entity', () => {
  const entries = new LocalSeedCatalogProvider().listEntries();
  for (const entry of entries) {
    assert.ok(entry.ifc.entity.startsWith('Ifc'), `${entry.id}: ifc.entity should start with "Ifc"`);
    assert.ok(entry.geometry.width > 0 && entry.geometry.depth > 0 && entry.geometry.height > 0, `${entry.id}: geometry must be positive`);
  }
});

test('USERDEFINED entries always carry an objectType', () => {
  const entries = new LocalSeedCatalogProvider().listEntries();
  for (const entry of entries) {
    if (entry.ifc.predefinedType === 'USERDEFINED') {
      assert.ok(entry.ifc.objectType, `${entry.id}: USERDEFINED requires ifc.objectType`);
    }
  }
});

test('provider id matches its declared source kind', () => {
  const provider = new LocalSeedCatalogProvider();
  assert.equal(provider.id, 'local-seed');
});
