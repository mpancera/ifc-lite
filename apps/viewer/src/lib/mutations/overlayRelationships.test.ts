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
import {
  addLibraryElementToStore,
  addLibraryTypeToStore,
  emitRelDefinesByType,
} from '@ifc-lite/create';
import { withOverlayRelationships, type RelatedRef } from './overlayRelationships.js';

const STOREY = 43;
const ROOM = 60;

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const anchor = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 0, storeyId: STOREY, storeyPlacementId: 54 };

/** Names everything; a real caller falls back to the parse for base entities. */
const describe = (expressId: number): RelatedRef => ({
  id: expressId,
  name: expressId === ROOM ? 'Küche' : `#${expressId}`,
  type: expressId === ROOM ? 'IfcSpace' : 'IfcUnknown',
});

function session() {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(200), view);
  const { typeId } = addLibraryTypeToStore(editor, anchor, {
    IfcEntity: 'IfcSensorType', Name: 'Rauchmelder', Tag: 'fire.smoke-detector',
  });
  const sensor = addLibraryElementToStore(editor, anchor, {
    IfcEntity: 'IfcSensor', Position: [0, 0, 0], Name: 'Melder', ContainerId: ROOM,
  }).elementId;
  emitRelDefinesByType(editor, anchor.ownerHistoryId, [sensor], typeId);
  return { view, editor, sensor, typeId };
}

test('an element created this session reports its relationships', () => {
  // The symptom this fixes: three relationships existed and the panel showed
  // none, because the parsed graph predates all of them.
  const { view, sensor, typeId } = session();
  const result = withOverlayRelationships(null, { view, expressId: sensor, describe });

  assert.ok(result, 'expected relationships');
  assert.deepEqual(result!.definedBy.map((r) => r.id), [typeId]);
  assert.deepEqual(result!.containedIn.map((r) => r.id), [ROOM]);
});

test('the room is named, not just numbered', () => {
  const { view, sensor } = session();
  const result = withOverlayRelationships(null, { view, expressId: sensor, describe });

  assert.equal(result!.containedIn[0].name, 'Küche');
  assert.equal(result!.containedIn[0].type, 'IfcSpace');
});

test('group membership authored this session is added', () => {
  const { view, editor, sensor } = session();
  const groupId = editor.addEntity('IfcDistributionSystem',
    ['guid', null, 'Fire - Branddetektion', null, null, null, null]).expressId;
  editor.addEntity('IfcRelAssignsToGroup',
    ['guid', null, null, null, [`#${sensor}`], null, `#${groupId}`]);

  const result = withOverlayRelationships(null, { view, expressId: sensor, describe });
  assert.deepEqual(result!.groups.map((g) => g.id), [groupId]);
});

test('parsed relationships are preserved, not replaced', () => {
  const { view, sensor } = session();
  const parsed = {
    voids: [{ id: 1, type: 'IfcOpeningElement' }],
    fills: [], groups: [{ id: 2, type: 'IfcZone' }], connections: [],
  };

  const result = withOverlayRelationships(parsed, { view, expressId: sensor, describe });
  assert.deepEqual(result!.voids.map((v) => v.id), [1]);
  assert.deepEqual(result!.groups.map((g) => g.id), [2]);
});

test('a group already reported by the parse is not duplicated', () => {
  const { view, editor, sensor } = session();
  editor.addEntity('IfcRelAssignsToGroup', ['guid', null, null, null, [`#${sensor}`], null, '#2']);
  const parsed = { voids: [], fills: [], groups: [{ id: 2, type: 'IfcZone' }], connections: [] };

  const result = withOverlayRelationships(parsed, { view, expressId: sensor, describe });
  assert.equal(result!.groups.length, 1);
});

test('relationships belonging to a different element are ignored', () => {
  const { view, sensor } = session();
  const result = withOverlayRelationships(null, { view, expressId: sensor + 9999, describe });

  assert.equal(result, null);
});

test('an element with nothing at all yields null rather than empty lists', () => {
  // The panel hides the whole card on null; empty lists would render a heading
  // over nothing.
  const view = new MutablePropertyView(null, 'm1');
  assert.equal(withOverlayRelationships(null, { view, expressId: 1, describe }), null);
});

test('no view at all still returns the parsed result', () => {
  const parsed = { voids: [], fills: [], groups: [{ id: 2, type: 'IfcZone' }], connections: [] };
  const result = withOverlayRelationships(parsed, { view: null, expressId: 1, describe });

  assert.deepEqual(result!.groups.map((g) => g.id), [2]);
});
