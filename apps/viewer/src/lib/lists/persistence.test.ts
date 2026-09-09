/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ListDefinition, ColumnDefinition } from '@ifc-lite/lists';
import { loadListDefinitions, saveListDefinitions, migrateListDefinition } from './persistence.js';

const STORAGE_KEY = 'ifc-lite-lists';

describe('list definitions persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a saved list back through load', () => {
    const defs = [{ id: 'a', name: 'A' } as never];
    saveListDefinitions(defs);
    assert.deepStrictEqual(loadListDefinitions(), defs);
  });

  it('returns [] when nothing is stored', () => {
    assert.deepStrictEqual(loadListDefinitions(), []);
  });

  it('returns [] for corrupt (non-JSON) localStorage rather than throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not json{');
    assert.doesNotThrow(() => loadListDefinitions());
    assert.deepStrictEqual(loadListDefinitions(), []);
  });

  it('returns [] for well-formed JSON that is not an array, so callers can still spread it', () => {
    // A hand-edited or half-written entry: valid JSON, but an object instead
    // of an array. `listSlice.addListDefinition` does
    // `[...get().listDefinitions, definition]` - if this ever comes back
    // as a non-array, that spread throws "is not iterable" on the very
    // first list the user tries to create, bricking the List panel at boot.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    const defs = loadListDefinitions();
    assert.ok(Array.isArray(defs), 'expected an array even for object-shaped stored JSON');
    assert.doesNotThrow(() => [...defs, { id: 'x' } as never]);
  });

  it('returns [] for a stored JSON primitive (e.g. a stray number or string)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
    const defs = loadListDefinitions();
    assert.ok(Array.isArray(defs));
  });
});


function listWith(...columns: ColumnDefinition[]): ListDefinition {
  return {
    id: 'l1',
    name: 'Melderliste',
    entityTypes: [],
    conditions: [],
    columns,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('migrateListDefinition · Container → Contained in', () => {
  it('renames the heading a list saved under the old default', () => {
    const before = listWith({
      id: 'c1', source: 'spatial', propertyName: 'Container', label: 'Container',
    });
    const after = migrateListDefinition(before);

    assert.equal(after.columns[0].label, 'Contained in');
    // The engine resolves against propertyName, so it must survive untouched.
    assert.equal(after.columns[0].propertyName, 'Container');
  });

  it('names a column that had no label at all', () => {
    // Without a label the table falls back to `propertyName`, which is still
    // the old wording — so an absent label needs the rename just as much.
    const after = migrateListDefinition(listWith({
      id: 'c1', source: 'spatial', propertyName: 'Container',
    }));

    assert.equal(after.columns[0].label, 'Contained in');
  });

  it('leaves a heading the author typed themselves alone', () => {
    const after = migrateListDefinition(listWith({
      id: 'c1', source: 'spatial', propertyName: 'Container', label: 'Verortung',
    }));

    assert.equal(after.columns[0].label, 'Verortung');
  });

  it('ignores a non-spatial column that happens to be named Container', () => {
    const after = migrateListDefinition(listWith({
      id: 'c1', source: 'property', psetName: 'Pset_Custom',
      propertyName: 'Container', label: 'Container',
    }));

    assert.equal(after.columns[0].label, 'Container');
  });

  it('touches neither the Room nor the Storey column', () => {
    const after = migrateListDefinition(listWith(
      { id: 'c1', source: 'spatial', propertyName: 'Room', label: 'Room' },
      { id: 'c2', source: 'spatial', propertyName: 'Storey', label: 'Storey' },
    ));

    assert.deepEqual(after.columns.map((c) => c.label), ['Room', 'Storey']);
  });

  it('returns the very same object when nothing needs migrating', () => {
    // Every load runs this; a fresh object each time would re-render the whole
    // list panel for nothing.
    const before = listWith({ id: 'c1', source: 'attribute', propertyName: 'Name' });

    assert.equal(migrateListDefinition(before), before);
  });
});
