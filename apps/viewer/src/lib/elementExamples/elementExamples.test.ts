/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ELEMENT_EXAMPLES_URL,
  exampleFileUrl,
  parseElementExamples,
} from './elementExamples.js';

/**
 * A slice of a real response from
 * `https://data-dictionary.ch/public/elementbeispiele`, field names and all.
 * Copied rather than invented, so the German keys this parser has to read are
 * the ones the endpoint actually sends.
 */
const REAL_PAYLOAD = {
  elementbeispiele: [
    {
      id: 'handfeuerloescher',
      name: 'Handfeuerlöscher',
      klasse: 'IfcFireSuppressionTerminal',
      predefinedType: 'USERDEFINED',
      organisation: 'admp',
      geaendert: '2026-09-14',
      veroeffentlicht: true,
      teile: 5,
    },
    {
      id: 'sensor-co2',
      name: 'CO2-Sensor',
      klasse: 'IfcSensor',
      predefinedType: 'CO2SENSOR',
      organisation: 'admp',
      geaendert: '2026-09-05',
      veroeffentlicht: true,
      teile: 1,
    },
  ],
};

describe('parseElementExamples', () => {
  it('reads the dictionary’s German fields into this repository’s vocabulary', () => {
    const catalog = parseElementExamples(REAL_PAYLOAD, 'https://example.test/list');
    assert.deepEqual(catalog?.entries, [
      {
        id: 'handfeuerloescher',
        name: 'Handfeuerlöscher',
        entity: 'IfcFireSuppressionTerminal',
        predefinedType: 'USERDEFINED',
        organisation: 'admp',
        changed: '2026-09-14',
        parts: 5,
      },
      {
        id: 'sensor-co2',
        name: 'CO2-Sensor',
        entity: 'IfcSensor',
        predefinedType: 'CO2SENSOR',
        organisation: 'admp',
        changed: '2026-09-05',
        parts: 1,
      },
    ]);
  });

  it('skips an unusable entry instead of failing the whole list', () => {
    // A catalogue is a living document. One malformed row should cost that
    // row, not the panel.
    const catalog = parseElementExamples(
      {
        elementbeispiele: [
          { name: 'ohne Kennung', klasse: 'IfcSensor' },
          { id: 'ohne-klasse', name: 'nicht platzierbar' },
          null,
          'unsinn',
          REAL_PAYLOAD.elementbeispiele[1],
        ],
      },
      'https://example.test/list',
    );
    assert.deepEqual(catalog?.entries.map((e) => e.id), ['sensor-co2']);
  });

  it('falls back to the id when a row has no name', () => {
    const catalog = parseElementExamples(
      { elementbeispiele: [{ id: 'namenlos', klasse: 'IfcSensor' }] },
      'https://example.test/list',
    );
    assert.equal(catalog?.entries[0].name, 'namenlos');
    assert.equal(catalog?.entries[0].predefinedType, null);
    assert.equal(catalog?.entries[0].parts, 0);
  });

  it('rejects a payload that is not the list at all', () => {
    // A `null` here is what makes the caller say "unknown form" rather than
    // show an empty catalogue, which would read as "there are none".
    assert.equal(parseElementExamples({}, 'x'), null);
    assert.equal(parseElementExamples([], 'x'), null);
    assert.equal(parseElementExamples(null, 'x'), null);
  });
});

describe('exampleFileUrl', () => {
  it('builds the file address next to the list, with or without a trailing slash', () => {
    assert.equal(
      exampleFileUrl('https://example.test/public/elementbeispiele', 'sensor-co2'),
      'https://example.test/public/elementbeispiele/sensor-co2.ifc',
    );
    assert.equal(
      exampleFileUrl('https://example.test/public/elementbeispiele/', 'sensor-co2'),
      'https://example.test/public/elementbeispiele/sensor-co2.ifc',
    );
  });

  it('escapes an id rather than letting it steer the path', () => {
    // Ids come off the network. One containing `../` must not climb out of
    // the collection.
    assert.equal(
      exampleFileUrl(DEFAULT_ELEMENT_EXAMPLES_URL, '../../api/geheim'),
      'https://data-dictionary.ch/public/elementbeispiele/..%2F..%2Fapi%2Fgeheim.ifc',
    );
  });
});
