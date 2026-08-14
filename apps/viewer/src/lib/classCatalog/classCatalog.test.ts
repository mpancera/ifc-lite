/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClassCatalog, searchClassCatalog, describeClass, type ClassCatalog,
} from './classCatalog.js';

/** The dictionary's own shape: a top-level object whose `classes` is a MAP. */
const payload = {
  schema: 'local-classes/1',
  classCount: 3,
  classes: {
    'IfcSensor.FIRESENSOR': {
      id: 'IfcSensor.FIRESENSOR',
      entity: 'IfcSensor',
      predefinedType: 'FIRESENSOR',
      objectType: null,
      label: 'Rauchmelder',
      definition: 'Melder für Rauch.',
      status: 'active',
      synonyms: ['Brandmelder', 'smoke detector'],
    },
    'IfcDoor.DOOR': {
      id: 'IfcDoor.DOOR',
      entity: 'IfcDoor',
      predefinedType: 'DOOR',
      objectType: null,
      label: 'Tür',
      definition: 'Eine Tür.',
      status: 'active',
      synonyms: [],
    },
    'IfcDoorPanel.LEAF': {
      id: 'IfcDoorPanel.LEAF',
      entity: 'IfcDoorPanel',
      predefinedType: 'LEAF',
      objectType: null,
      label: 'Türblatt',
      definition: 'Das Blatt einer Tür.',
      status: 'proposed',
      synonyms: [],
    },
  },
};

const catalog = parseClassCatalog(payload, 'test', '2026-08-13T00:00:00Z')!;

describe('parseClassCatalog', () => {
  it('reads the dictionary\'s map of classes', () => {
    assert.equal(catalog.entries.length, 3);
    assert.equal(catalog.source, 'test');
    assert.equal(catalog.fetchedAt, '2026-08-13T00:00:00Z');
  });

  it('keeps entity and PredefinedType apart — together they are the Fachklasse', () => {
    const sensor = catalog.entries.find((e) => e.id === 'IfcSensor.FIRESENSOR')!;
    assert.equal(sensor.entity, 'IfcSensor');
    assert.equal(sensor.predefinedType, 'FIRESENSOR');
    assert.deepEqual([...sensor.synonyms], ['Brandmelder', 'smoke detector']);
  });

  it('accepts an array too, for the day somebody exports it that way', () => {
    const asArray = parseClassCatalog({ classes: Object.values(payload.classes) })!;
    assert.equal(asArray.entries.length, 3);
  });

  it('skips a broken entry rather than losing the catalogue', () => {
    // A living document with one bad row should cost that row, not the sync.
    const withJunk = parseClassCatalog({
      classes: { a: { entity: 'IfcWall' }, b: null, c: { label: 'kein Entity' }, d: 'nonsense' },
    })!;
    assert.equal(withJunk.entries.length, 1);
    assert.equal(withJunk.entries[0].entity, 'IfcWall');
  });

  it('derives an id where the dictionary gives none', () => {
    const derived = parseClassCatalog({ classes: [{ entity: 'IfcSensor', predefinedType: 'HUMIDITYSENSOR' }] })!;
    assert.equal(derived.entries[0].id, 'IfcSensor.HUMIDITYSENSOR');
  });

  it('has nothing to offer from something that is not a catalogue', () => {
    assert.equal(parseClassCatalog(null), null);
    assert.equal(parseClassCatalog('hello'), null);
    assert.equal(parseClassCatalog({ classes: {} }), null);
    assert.equal(parseClassCatalog({ classes: [{ label: 'ohne Entity' }] }), null);
  });
});

describe('searchClassCatalog', () => {
  const ids = (q: string) => searchClassCatalog(catalog, q).map((e) => e.id);

  it('puts an exact start of the label first', () => {
    // Without the ranking, "Tür" buries Tür under Türblatt.
    assert.equal(ids('Tür')[0], 'IfcDoor.DOOR');
  });

  it('still finds what merely contains the term', () => {
    assert.ok(ids('Tür').includes('IfcDoorPanel.LEAF'));
  });

  it('finds by the IFC entity, which is what a modeller often types', () => {
    assert.deepEqual(ids('IfcSensor'), ['IfcSensor.FIRESENSOR']);
  });

  it('finds by synonym, because the dictionary\'s word is not everyone\'s', () => {
    assert.deepEqual(ids('smoke detector'), ['IfcSensor.FIRESENSOR']);
    assert.deepEqual(ids('Brandmelder'), ['IfcSensor.FIRESENSOR']);
  });

  it('ranks a label match above a synonym match', () => {
    const mixed = parseClassCatalog({
      classes: [
        { entity: 'IfcAlarm', predefinedType: 'BELL', label: 'Sirene', synonyms: ['Melder'] },
        { entity: 'IfcSensor', predefinedType: 'FIRESENSOR', label: 'Melder', synonyms: [] },
      ],
    })!;
    assert.equal(searchClassCatalog(mixed, 'Melder')[0].entity, 'IfcSensor');
  });

  it('ignores case and stray space', () => {
    assert.deepEqual(ids('  RAUCHMELDER '), ['IfcSensor.FIRESENSOR']);
  });

  it('returns the head of the list for an empty term', () => {
    assert.equal(searchClassCatalog(catalog, '   ', 2).length, 2);
  });

  it('has nothing to search before the catalogue is synced', () => {
    assert.deepEqual(searchClassCatalog(null, 'Tür'), []);
  });

  it('honours the limit, because 1330 entries is not a list anybody scrolls', () => {
    assert.equal(searchClassCatalog(catalog, '', 1).length, 1);
  });
});

describe('describeClass', () => {
  it('shows the human name beside the identifier', () => {
    const sensor = catalog.entries.find((e) => e.id === 'IfcSensor.FIRESENSOR')!;
    assert.equal(describeClass(sensor), 'Rauchmelder · IfcSensor.FIRESENSOR');
  });

  it('does not repeat itself when the label IS the entity', () => {
    const plain = parseClassCatalog({ classes: [{ entity: 'IfcWall' }] })!.entries[0];
    assert.equal(describeClass(plain), 'IfcWall');
  });
});

describe('the shape the app stores', () => {
  it('survives a round trip through JSON', () => {
    // It goes to IndexedDB and comes back; a Map or a class here would not.
    const restored: ClassCatalog = JSON.parse(JSON.stringify(catalog));
    assert.deepEqual(restored, catalog);
  });
});
