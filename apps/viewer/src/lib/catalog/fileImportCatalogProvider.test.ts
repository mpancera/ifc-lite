/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// fake-indexeddb installs a Node-compatible IDB implementation on
// `globalThis.indexedDB` when imported via the `/auto` entry point.
import 'fake-indexeddb/auto';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogImport, FileImportCatalogProvider } from './fileImportCatalogProvider.js';

function validEntryJson(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fire.smoke-detector',
    label: 'Rauchmelder',
    discipline: 'fire',
    category: 'detector',
    ifc: { entity: 'IfcSensor', predefinedType: 'SMOKESENSOR' },
    geometry: { width: 0.1, depth: 0.1, height: 0.05 },
    mounting: 'ceiling',
    ...overrides,
  };
}

test('parseCatalogImport: accepts a bare array of valid entries', () => {
  const result = parseCatalogImport(JSON.stringify([validEntryJson()]));
  assert.equal(result.entries.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.entries[0].provenance.source, 'file-import');
});

test('parseCatalogImport: accepts an { entries: [...] } wrapper object', () => {
  const result = parseCatalogImport(JSON.stringify({ entries: [validEntryJson()] }));
  assert.equal(result.entries.length, 1);
});

test('parseCatalogImport: rejects invalid JSON', () => {
  assert.throws(() => parseCatalogImport('{not json'), /Not valid JSON/);
});

test('parseCatalogImport: rejects a JSON value that is neither an array nor { entries }', () => {
  assert.throws(() => parseCatalogImport(JSON.stringify({ foo: 'bar' })), /Expected a JSON array/);
});

test('parseCatalogImport: collects per-entry errors without failing the whole import', () => {
  const result = parseCatalogImport(JSON.stringify([
    validEntryJson(),
    validEntryJson({ id: 'bad.discipline', discipline: 'not-a-real-discipline' }),
    validEntryJson({ id: 'bad.geometry', geometry: { width: -1, depth: 0.1, height: 0.1 } }),
  ]));
  assert.equal(result.entries.length, 1);
  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].entryId, 'bad.discipline');
  assert.equal(result.errors[1].entryId, 'bad.geometry');
});

test('parseCatalogImport: drops a duplicate id and reports it as an error', () => {
  const result = parseCatalogImport(JSON.stringify([validEntryJson(), validEntryJson()]));
  assert.equal(result.entries.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /duplicate id/);
});

test('parseCatalogImport: preserves a valid declared provenance.source instead of overwriting it', () => {
  const result = parseCatalogImport(JSON.stringify([
    validEntryJson({ provenance: { source: 'aas', sourceRef: 'urn:aas:123' } }),
  ]));
  assert.equal(result.entries[0].provenance.source, 'aas');
  assert.equal(result.entries[0].provenance.sourceRef, 'urn:aas:123');
});

test('parseCatalogImport: normalises an unrecognised provenance.source to file-import', () => {
  const result = parseCatalogImport(JSON.stringify([
    validEntryJson({ provenance: { source: 'made-up-source' } }),
  ]));
  assert.equal(result.entries[0].provenance.source, 'file-import');
});

test('FileImportCatalogProvider: importFromFile persists to IndexedDB, listEntries reads it back', async () => {
  const provider = new FileImportCatalogProvider();
  await provider.clear();
  const file = new File([JSON.stringify([validEntryJson()])], 'catalog.json', { type: 'application/json' });

  const result = await provider.importFromFile(file);
  assert.equal(result.entries.length, 1);

  const listed = await provider.listEntries();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'fire.smoke-detector');
});

test('FileImportCatalogProvider: a second import replaces the first, not merges', async () => {
  const provider = new FileImportCatalogProvider();
  await provider.clear();
  await provider.importFromFile(new File([JSON.stringify([validEntryJson({ id: 'a' })])], 'a.json'));
  await provider.importFromFile(new File([JSON.stringify([validEntryJson({ id: 'b' })])], 'b.json'));

  const listed = await provider.listEntries();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'b');
});

test('FileImportCatalogProvider: clear() empties the store', async () => {
  const provider = new FileImportCatalogProvider();
  await provider.importFromFile(new File([JSON.stringify([validEntryJson()])], 'catalog.json'));
  await provider.clear();
  const listed = await provider.listEntries();
  assert.equal(listed.length, 0);
});
