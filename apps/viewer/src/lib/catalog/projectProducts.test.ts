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
import { getProjectProducts } from './projectProducts.js';

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const anchor = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 0, storeyId: 43, storeyPlacementId: 54 };

test('getProjectProducts: returns [] when there is no mutation view', () => {
  assert.deepEqual(getProjectProducts(null), []);
  assert.deepEqual(getProjectProducts(undefined), []);
});

test('getProjectProducts: groups instances under their shared Type, mirroring the real addLibraryElement flow', () => {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(200), view);

  const { typeId } = addLibraryTypeToStore(editor, anchor, {
    IfcEntity: 'IfcSensorType', Name: 'Rauchmelder', Tag: 'fire.smoke-detector', PredefinedType: 'SMOKESENSOR',
  });
  const smoke1 = addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcSensor', Position: [0, 0, 0], PredefinedType: 'SMOKESENSOR', Name: 'Rauchmelder' }).elementId;
  emitRelDefinesByType(editor, anchor.ownerHistoryId, [smoke1], typeId);
  const smoke2 = addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcSensor', Position: [1, 0, 0], PredefinedType: 'SMOKESENSOR', Name: 'Rauchmelder' }).elementId;
  emitRelDefinesByType(editor, anchor.ownerHistoryId, [smoke2], typeId);

  const { typeId: cameraTypeId } = addLibraryTypeToStore(editor, anchor, {
    IfcEntity: 'IfcAudioVisualApplianceType', Name: 'Kamera', Tag: 'security.camera', PredefinedType: 'CAMERA',
  });
  const camera1 = addLibraryElementToStore(editor, anchor, { IfcEntity: 'IfcAudioVisualAppliance', Position: [2, 0, 0], PredefinedType: 'CAMERA', Name: 'Kamera' }).elementId;
  emitRelDefinesByType(editor, anchor.ownerHistoryId, [camera1], cameraTypeId);

  const products = getProjectProducts(view);

  assert.equal(products.length, 2);
  const [cameraProduct, smokeProduct] = products; // sorted alphabetically: Kamera < Rauchmelder
  assert.equal(cameraProduct.typeName, 'Kamera');
  assert.equal(cameraProduct.ifcType, 'IfcAudioVisualApplianceType');
  assert.equal(cameraProduct.catalogEntryId, 'security.camera');
  assert.equal(cameraProduct.instances.length, 1);

  assert.equal(smokeProduct.typeName, 'Rauchmelder');
  assert.equal(smokeProduct.catalogEntryId, 'fire.smoke-detector');
  assert.equal(smokeProduct.instances.length, 2);
  assert.deepEqual(smokeProduct.instances.map((i) => i.expressId).sort((a, b) => a - b), [smoke1, smoke2].sort((a, b) => a - b));
});

test('getProjectProducts: ignores unrelated overlay entities', () => {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(50), view);
  editor.addEntity('IfcWall', ['guid', null, 'Wall 1', null, null, '#1', '#2', null]);
  assert.deepEqual(getProjectProducts(view), []);
});
