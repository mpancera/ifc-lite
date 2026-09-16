/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ElementExample } from './elementExamples.js';
import { exampleToCatalogEntry, examplesToCatalogEntries } from './exampleCatalogEntries.js';

const LIST = 'https://data-dictionary.ch/public/elementbeispiele';

function example(over: Partial<ElementExample> = {}): ElementExample {
  return {
    id: 'handfeuerloescher',
    name: 'Handfeuerlöscher',
    entity: 'IfcFireSuppressionTerminal',
    predefinedType: 'USERDEFINED',
    organisation: 'admp',
    changed: '2026-09-14',
    parts: 5,
    ...over,
  };
}

describe('an example as a library entry', () => {
  it('carries the file to place in the one field that changes what placing does', () => {
    const entry = exampleToCatalogEntry(example(), LIST);
    assert.equal(
      entry.exampleUrl,
      'https://data-dictionary.ch/public/elementbeispiele/handfeuerloescher.ifc',
    );
    assert.equal(entry.provenance.source, 'dictionary-example');
  });

  it('prefixes the id so it cannot collide with a company catalogue', () => {
    // The two lists are appended, not merged. An example whose id happened to
    // match a real article would otherwise take its place in the picker.
    assert.equal(exampleToCatalogEntry(example(), LIST).id, 'beispiel.handfeuerloescher');
  });

  it('declares its extent as a placeholder, not as a measurement', () => {
    // The real extent is only known once the file is fetched, which happens at
    // placement. Everything here drives the preview box and nothing in the file.
    const entry = exampleToCatalogEntry(example(), LIST);
    assert.deepEqual(entry.geometry, { width: 0.2, depth: 0.2, height: 0.3 });
  });

  it('reads the trade off the class, and says "other" when it cannot', () => {
    const trade = (entity: string, predefined: string | null) =>
      exampleToCatalogEntry(example({ entity, predefinedType: predefined }), LIST).discipline;

    assert.equal(trade('IfcFireSuppressionTerminal', 'USERDEFINED'), 'fire');
    assert.equal(trade('IfcAlarm', 'BREAKGLASSBUTTON'), 'fire');
    assert.equal(trade('IfcSensor', 'SMOKESENSOR'), 'fire');
    assert.equal(trade('IfcAudioVisualAppliance', 'CAMERA'), 'security');
    assert.equal(trade('IfcSensor', 'MOVEMENTSENSOR'), 'intrusion');
    assert.equal(trade('IfcSensor', 'TEMPERATURESENSOR'), 'automation');
    // Not guessed at: a class this rule does not recognise lands in `other`
    // rather than in whichever trade most examples happen to be today.
    assert.equal(trade('IfcFurniture', null), 'other');
  });

  it('keeps the Fachklasse as the IFC mapping', () => {
    const entry = exampleToCatalogEntry(example(), LIST);
    assert.equal(entry.ifc.entity, 'IfcFireSuppressionTerminal');
    assert.equal(entry.ifc.predefinedType, 'USERDEFINED');
    // A class with no predefined type must not invent one.
    const plain = exampleToCatalogEntry(example({ predefinedType: null }), LIST);
    assert.equal(plain.ifc.predefinedType, undefined);
  });

  it('converts a whole list', () => {
    const entries = examplesToCatalogEntries(
      [example(), example({ id: 'sensor-co2', name: 'CO2-Sensor' })],
      LIST,
    );
    assert.deepEqual(entries.map((e) => e.id), ['beispiel.handfeuerloescher', 'beispiel.sensor-co2']);
  });
});
