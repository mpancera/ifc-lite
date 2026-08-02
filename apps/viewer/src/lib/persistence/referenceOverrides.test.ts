/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MutablePropertyView,
  StoreEditor,
  type MutationEntityRef,
  type MutationStoreShape,
} from '@ifc-lite/mutations';
import { addLibraryElementToStore } from '@ifc-lite/create';
import { collectReferenceOverrides, groupOverridesByEntity, type OverrideSource } from './referenceOverrides.js';

const WALL = 100;
const DOOR = 101;

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const anchor = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 0, storeyId: 43, storeyPlacementId: 54 };

const source: OverrideSource = {
  globalIdOf: (id) => `gid-${id}`,
  typeNameOf: (id) => (id === WALL ? 'IfcWall' : id === DOOR ? 'IfcDoor' : 'IfcSensor'),
  nameOf: (id) => (id === WALL ? 'Wand A' : id === DOOR ? 'Tuer 1' : ''),
};

function makeView() {
  const view = new MutablePropertyView(null, 'm1');
  return { view, editor: new StoreEditor(makeStore(200), view) };
}

test('an untouched reference model has no overrides', () => {
  const { view } = makeView();
  assert.deepEqual(collectReferenceOverrides(view, source), []);
  assert.deepEqual(collectReferenceOverrides(null, source), []);
});

test('placing our own elements is not an override', () => {
  // The whole premise: discipline work is additive, so it must not show up as
  // a change to the architect's model.
  const { view, editor } = makeView();
  addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcSensor', Position: [0, 0, 0] });

  assert.deepEqual(collectReferenceOverrides(view, source), []);
});

test('editing an attribute of a reference entity is an override', () => {
  const { view } = makeView();
  view.setAttribute(WALL, 'Name', 'Wand A (korrigiert)', 'Wand A');

  const overrides = collectReferenceOverrides(view, source);
  assert.equal(overrides.length, 1);
  assert.deepEqual(overrides[0], {
    expressId: WALL, globalId: 'gid-100', ifcType: 'IfcWall', name: 'Wand A',
    kind: 'attribute', field: 'Name', before: 'Wand A', after: 'Wand A (korrigiert)',
  });
});

test('a property change on a reference entity is an override', () => {
  const { view } = makeView();
  view.setProperty(WALL, 'Pset_WallCommon', 'FireRating', 'EI30');

  const overrides = collectReferenceOverrides(view, source);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].kind, 'property');
  assert.equal(overrides[0].field, 'Pset_WallCommon.FireRating');
  assert.equal(overrides[0].after, 'EI30');
});

test('deleting a reference entity is an override', () => {
  const { view } = makeView();
  view.deleteEntity(DOOR);

  const overrides = collectReferenceOverrides(view, source);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].kind, 'deletion');
  assert.equal(overrides[0].expressId, DOOR);
});

test('editing an element WE placed is not an override', () => {
  const { view, editor } = makeView();
  const { elementId } = addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcSensor', Position: [0, 0, 0] });
  view.setAttribute(elementId, 'Name', 'Melder EG-02');

  assert.deepEqual(collectReferenceOverrides(view, source), []);
});

test('overrides are reported newest first', () => {
  const { view } = makeView();
  view.setAttribute(WALL, 'Name', 'erste');
  view.setAttribute(DOOR, 'Name', 'zweite');

  const overrides = collectReferenceOverrides(view, source);
  assert.equal(overrides[0].expressId, DOOR);
});

test('overrides group per reference entity', () => {
  const { view } = makeView();
  view.setAttribute(WALL, 'Name', 'Wand A2');
  view.setProperty(WALL, 'Pset_WallCommon', 'FireRating', 'EI30');
  view.setAttribute(DOOR, 'Name', 'Tuer 2');

  const grouped = groupOverridesByEntity(collectReferenceOverrides(view, source));
  assert.equal(grouped.length, 2);
  const wall = grouped.find((g) => g.expressId === WALL)!;
  assert.equal(wall.overrides.length, 2);
  assert.equal(wall.name, 'Wand A');
});

test('a mix of authoring and correction reports only the correction', () => {
  const { view, editor } = makeView();
  addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcSensor', Position: [0, 0, 0] });
  view.setAttribute(WALL, 'Name', 'Wand A (korrigiert)');
  addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcSensor', Position: [1, 0, 0] });

  const overrides = collectReferenceOverrides(view, source);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].expressId, WALL);
});
