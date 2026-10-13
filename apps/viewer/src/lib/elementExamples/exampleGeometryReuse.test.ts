/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { StoreEditor } from '@ifc-lite/mutations';
import {
  findPlacedType,
  forgetExampleGeometry,
  rememberExampleGeometry,
  reuseExampleGeometry,
  type ExampleGeometryRecord,
} from './exampleGeometryReuse.js';

/** An editor that only knows which express ids still exist. */
function editorWith(alive: Iterable<number>): StoreEditor {
  const live = new Set(alive);
  return {
    getNewEntity: (id: number) => (live.has(id) ? { expressId: id } : null),
    /** Lets a test play "undo" without a whole mutation view. */
    drop: (id: number) => live.delete(id),
  } as unknown as StoreEditor;
}

const RECORD: ExampleGeometryRecord = {
  typeId: 100,
  deviceMapIds: [10, 11],
  companionMapIds: [[20], [21]],
};

const ALL = [100, 10, 11, 20, 21];

describe('what an example left in a model', () => {
  it('is nothing at all before the first placement', () => {
    const editor = editorWith(ALL);
    assert.equal(reuseExampleGeometry(editor, 'urn:test:a'), null);
  });

  it('comes back under its own key', () => {
    const editor = editorWith(ALL);
    rememberExampleGeometry(editor, 'urn:test:a', RECORD);
    assert.deepEqual(reuseExampleGeometry(editor, 'urn:test:a'), RECORD);
    assert.equal(reuseExampleGeometry(editor, 'urn:test:b'), null, 'a different product');
  });

  it('is not shared between models', () => {
    // Two editors, two models. A map id from one is meaningless in the other,
    // and handing it over would write a dangling reference.
    const one = editorWith(ALL);
    const other = editorWith(ALL);
    rememberExampleGeometry(one, 'urn:test:a', RECORD);
    assert.equal(reuseExampleGeometry(other, 'urn:test:a'), null);
  });

  it('is dropped once any piece of it has been undone', () => {
    // The failure this prevents is quiet: a record pointing at removed
    // entities produces dangling references in the export, not an error.
    for (const gone of ALL) {
      const editor = editorWith(ALL);
      rememberExampleGeometry(editor, 'urn:test:a', RECORD);
      (editor as unknown as { drop: (id: number) => void }).drop(gone);
      assert.equal(
        reuseExampleGeometry(editor, 'urn:test:a'), null,
        `losing #${gone} must invalidate the whole record`,
      );
    }
  });

  it('does not come back after it was dropped', () => {
    const editor = editorWith(ALL);
    rememberExampleGeometry(editor, 'urn:test:a', RECORD);
    (editor as unknown as { drop: (id: number) => void }).drop(10);
    assert.equal(reuseExampleGeometry(editor, 'urn:test:a'), null);
    // Even though the id is "back" — the record was forgotten, and the next
    // placement writes a fresh one rather than resurrecting a stale note.
    assert.equal(reuseExampleGeometry(editorWith(ALL), 'urn:test:a'), null);
  });

  it('tolerates an example whose device entity has no type', () => {
    // `typeId: null` is ordinary — IfcAnnotation and IfcVirtualElement have no
    // type entity — and must not be mistaken for a missing entity.
    const editor = editorWith([10]);
    rememberExampleGeometry(editor, 'urn:test:a', {
      typeId: null, deviceMapIds: [10], companionMapIds: [],
    });
    assert.ok(reuseExampleGeometry(editor, 'urn:test:a'));
  });

  it('can be forgotten on purpose', () => {
    const editor = editorWith(ALL);
    rememberExampleGeometry(editor, 'urn:test:a', RECORD);
    forgetExampleGeometry(editor);
    assert.equal(reuseExampleGeometry(editor, 'urn:test:a'), null);
  });
});

/** An editor holding overlay entities, as `getNewEntities` reports them. */
function editorHolding(entities: { expressId: number; type: string; attributes: unknown[] }[]) {
  return { getNewEntities: () => entities } as unknown as StoreEditor;
}

function typeEntity(over: Partial<{ expressId: number; type: string; attributes: unknown[] }> = {}) {
  const attributes: unknown[] = [
    '0guid', '#5', 'Handfeuerlöscher', null, null, null,
    ['#10', '#11'],        // RepresentationMaps
    'HFL',                 // Tag
    'urn:test:a',          // ElementType — the identity
  ];
  return { expressId: 100, type: 'IfcFireSuppressionTerminalType', attributes, ...over };
}

describe('finding a type the overlay already holds', () => {
  it('matches on the key and hands back the maps', () => {
    const found = findPlacedType(
      editorHolding([typeEntity()]), 'IfcFireSuppressionTerminalType', 'urn:test:a',
    );
    assert.deepEqual(found, { typeId: 100, deviceMapIds: [10, 11] });
  });

  it('ignores the spelling of the entity name', () => {
    // The schema table says IFCFIRESUPPRESSIONTERMINALTYPE, the editor stores
    // what it was given. Comparing literally finds nothing and writes a
    // duplicate — silently.
    const found = findPlacedType(
      editorHolding([typeEntity()]), 'IFCFIRESUPPRESSIONTERMINALTYPE', 'urn:test:a',
    );
    assert.ok(found);
  });

  it('does not answer for a different product', () => {
    assert.equal(
      findPlacedType(editorHolding([typeEntity()]), 'IfcFireSuppressionTerminalType', 'urn:test:b'),
      null,
    );
  });

  it('does not answer for a different entity', () => {
    assert.equal(
      findPlacedType(editorHolding([typeEntity()]), 'IfcSensorType', 'urn:test:a'),
      null,
    );
  });

  it('refuses a map list that does not read as references', () => {
    // A number where a reference belongs is a STEP integer, not `#10` — the
    // distinction this repository has already been bitten by twice. Half a
    // list would put the occurrence on the wrong body.
    const broken = typeEntity({ attributes: [...typeEntity().attributes] });
    broken.attributes[6] = ['#10', 11];
    assert.equal(
      findPlacedType(editorHolding([broken]), 'IfcFireSuppressionTerminalType', 'urn:test:a'),
      null,
    );
  });

  it('skips a type that carries no maps at all', () => {
    // A catalogue product's type: same slot, same key convention, no geometry.
    const empty = typeEntity({ attributes: [...typeEntity().attributes] });
    empty.attributes[6] = [];
    assert.equal(
      findPlacedType(editorHolding([empty]), 'IfcFireSuppressionTerminalType', 'urn:test:a'),
      null,
    );
  });
});
