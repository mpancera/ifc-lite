/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { libraryTypeKey } from './libraryTypeKey.js';
import type { CatalogEntry } from './types.js';

function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'fire.smoke-detector',
    label: 'Rauchmelder',
    discipline: 'fire',
    category: 'detector',
    ifc: { entity: 'IfcSensor', predefinedType: 'SMOKESENSOR' },
    geometry: { width: 0.1, depth: 0.1, height: 0.05 },
    mounting: 'ceiling',
    provenance: { source: 'local-seed' },
    ...over,
  };
}

describe('the identity of a library entry', () => {
  it('prefers the AAS globalAssetId over everything else', () => {
    const key = libraryTypeKey(entry({
      globalAssetId: 'https://example.invalid/ids/asset/4711',
      aas: { address: 'https://example.invalid/aas/other' },
      exampleUrl: 'https://data-dictionary.ch/public/elementbeispiele/x.ifc',
    }));
    assert.equal(key, 'https://example.invalid/ids/asset/4711');
  });

  it('falls back to the type AAS it belongs to', () => {
    const key = libraryTypeKey(entry({ aas: { address: 'https://example.invalid/aas/4711' } }));
    assert.equal(key, 'https://example.invalid/aas/4711');
  });

  it('uses an example\'s published address, without the file extension', () => {
    // The identity is of the element, not of one encoding of it — so a later
    // `.ifcx` of the same example must not read as a different product.
    const key = libraryTypeKey(entry({
      exampleUrl: 'https://data-dictionary.ch/public/elementbeispiele/handfeuerloescher.ifc',
      provenance: { source: 'dictionary-example' },
    }));
    assert.equal(key, 'https://data-dictionary.ch/public/elementbeispiele/handfeuerloescher');
  });

  it('namespaces a catalogue entry that brings no identity of its own', () => {
    assert.equal(
      libraryTypeKey(entry()),
      'urn:ifclite:catalog:local-seed:fire.smoke-detector',
    );
    // Same id, different catalogue — must NOT collide, which is the whole
    // reason the bare id is not the key.
    assert.notEqual(
      libraryTypeKey(entry({ provenance: { source: 'file-import' } })),
      libraryTypeKey(entry()),
    );
  });

  it('ignores blank identifiers rather than writing an empty key', () => {
    const key = libraryTypeKey(entry({ globalAssetId: '   ', aas: { address: '' } }));
    assert.equal(key, 'urn:ifclite:catalog:local-seed:fire.smoke-detector');
  });

  it('is stable — the same entry always answers the same', () => {
    const e = entry({ exampleUrl: 'https://data-dictionary.ch/public/elementbeispiele/co2.ifc' });
    assert.equal(libraryTypeKey(e), libraryTypeKey(e));
  });
});
