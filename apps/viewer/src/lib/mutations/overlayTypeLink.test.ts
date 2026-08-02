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
import { addLibraryElementToStore, addLibraryTypeToStore, emitRelDefinesByType } from '@ifc-lite/create';
import { resolveOverlayDefiningTypeId } from './overlayTypeLink.js';

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const anchor = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 0, storeyId: 43, storeyPlacementId: 54 };

function place() {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(200), view);
  const { typeId } = addLibraryTypeToStore(editor, anchor, {
    IfcEntity: 'IfcSensorType', Name: 'Rauchmelder', Tag: 'fire.smoke-detector',
  });
  const first = addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcSensor', Position: [0, 0, 0] }).elementId;
  const second = addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcSensor', Position: [1, 0, 0] }).elementId;
  emitRelDefinesByType(editor, anchor.ownerHistoryId, [first, second], typeId);
  return { view, editor, typeId, first, second };
}

test('resolveOverlayDefiningTypeId: no view resolves to null', () => {
  assert.equal(resolveOverlayDefiningTypeId(null, 1), null);
  assert.equal(resolveOverlayDefiningTypeId(undefined, 1), null);
});

test('resolveOverlayDefiningTypeId: an untyped entity resolves to null', () => {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(50), view);
  const { elementId } = addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcSensor', Position: [0, 0, 0] });
  assert.equal(resolveOverlayDefiningTypeId(view, elementId), null);
});

test('resolveOverlayDefiningTypeId: finds the type an occurrence was linked to', () => {
  const { view, typeId, first } = place();
  assert.equal(resolveOverlayDefiningTypeId(view, first), typeId);
});

test('resolveOverlayDefiningTypeId: every occurrence sharing one type resolves to it', () => {
  const { view, typeId, first, second } = place();
  assert.equal(resolveOverlayDefiningTypeId(view, first), typeId);
  assert.equal(resolveOverlayDefiningTypeId(view, second), typeId);
});

test('resolveOverlayDefiningTypeId: does not match on an id substring', () => {
  // `#20213` must not be found when looking for `#213` or `#2021`.
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(50), view);
  editor.addEntity('IfcRelDefinesByType', ['guid', null, null, null, ['#20213'], '#20215']);
  assert.equal(resolveOverlayDefiningTypeId(view, 213), null);
  assert.equal(resolveOverlayDefiningTypeId(view, 2021), null);
  assert.equal(resolveOverlayDefiningTypeId(view, 20213), 20215);
});
