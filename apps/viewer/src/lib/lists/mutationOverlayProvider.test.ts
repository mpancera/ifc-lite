/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IfcTypeEnum } from '@ifc-lite/data';
import {
  MutablePropertyView,
  StoreEditor,
  type MutationEntityRef,
  type MutationStoreShape,
} from '@ifc-lite/mutations';
import { addLibraryElementToStore, addLibraryTypeToStore, emitRelDefinesByType } from '@ifc-lite/create';
import type { ListDataProvider } from '@ifc-lite/lists';
import { withMutationOverlay } from './mutationOverlayProvider.js';

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const anchor = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 0, storeyId: 43, storeyPlacementId: 54 };

/** A parsed-store provider holding one pre-existing wall. */
function baseProvider(): ListDataProvider {
  const walls = [100];
  return {
    getEntitiesByType: (type) => (type === IfcTypeEnum.IfcWall ? [...walls] : []),
    getAllEntityIds: () => [...walls],
    getEntityName: (id) => (id === 100 ? 'Existing Wall' : ''),
    getEntityGlobalId: (id) => (id === 100 ? 'GID-WALL' : ''),
    getEntityDescription: () => '',
    getEntityObjectType: () => '',
    getEntityPredefinedType: () => '',
    getEntityTag: () => '',
    getEntityTypeName: (id) => (id === 100 ? 'IfcWall' : ''),
    getPropertySets: () => [],
    getQuantitySets: () => [],
  } as ListDataProvider;
}

function viewWithSensor() {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(200), view);
  const { typeId } = addLibraryTypeToStore(editor, anchor, {
    IfcEntity: 'IfcSensorType',
    Name: 'Rauchmelder',
    Tag: 'fire.smoke-detector',
    PredefinedType: 'SMOKESENSOR',
    TechnicalData: { OperatingVoltage: '24V DC' },
  });
  const sensorId = addLibraryElementToStore(editor, anchor, {
    IfcEntity: 'IfcSensor',
    Position: [0, 0, 0],
    PredefinedType: 'SMOKESENSOR',
    Name: 'Rauchmelder',
    Tag: 'RM-001',
  }).elementId;
  emitRelDefinesByType(editor, anchor.ownerHistoryId, [sensorId], typeId);
  return { view, editor, sensorId, typeId };
}

test('withMutationOverlay: returns the base provider untouched when there is no overlay', () => {
  const base = baseProvider();
  assert.equal(withMutationOverlay(base, null), base);
});

test('withMutationOverlay: returns the base provider untouched for an unedited overlay', () => {
  const base = baseProvider();
  const view = new MutablePropertyView(null, 'm1');
  assert.equal(withMutationOverlay(base, view), base);
});

test('withMutationOverlay: an authored element becomes a row in a class-less list', () => {
  const { view, sensorId } = viewWithSensor();
  const wrapped = withMutationOverlay(baseProvider(), view, { isRowEntity: (id) => id === sensorId });

  const ids = wrapped.getAllEntityIds!();
  assert.deepEqual(ids, [100, sensorId]);
});

test('withMutationOverlay: geometry plumbing is excluded from rows', () => {
  const { view, sensorId } = viewWithSensor();
  // Without the row filter every authored entity (placement, profile, solid,
  // shape rep, the rel, the type) would surface as a list row.
  const unfiltered = withMutationOverlay(baseProvider(), view).getAllEntityIds!();
  const filtered = withMutationOverlay(baseProvider(), view, { isRowEntity: (id) => id === sensorId })
    .getAllEntityIds!();

  assert.ok(unfiltered.length > filtered.length);
  assert.deepEqual(filtered, [100, sensorId]);
});

test('withMutationOverlay: an authored element is reachable by its IFC class', () => {
  const { view, sensorId } = viewWithSensor();
  const wrapped = withMutationOverlay(baseProvider(), view, { isRowEntity: (id) => id === sensorId });

  assert.deepEqual(wrapped.getEntitiesByType(IfcTypeEnum.IfcSensor), [sensorId]);
  assert.deepEqual(wrapped.getEntitiesByType(IfcTypeEnum.IfcWall), [100]);
});

test('withMutationOverlay: reads an authored element\'s own attributes', () => {
  const { view, sensorId } = viewWithSensor();
  const wrapped = withMutationOverlay(baseProvider(), view);

  assert.equal(wrapped.getEntityName(sensorId), 'Rauchmelder');
  assert.equal(wrapped.getEntityTypeName(sensorId), 'IfcSensor');
  assert.equal(wrapped.getEntityTag(sensorId), 'RM-001');
  assert.equal(wrapped.getEntityPredefinedType!(sensorId), 'SMOKESENSOR');
  assert.notEqual(wrapped.getEntityGlobalId(sensorId), '');
});

test('withMutationOverlay: an edited attribute wins over the parsed store', () => {
  const { view } = viewWithSensor();
  view.setAttribute(100, 'Name', 'Renamed Wall');
  const wrapped = withMutationOverlay(baseProvider(), view);

  assert.equal(wrapped.getEntityName(100), 'Renamed Wall');
});

test('withMutationOverlay: an edited attribute wins over an authored entity\'s own value', () => {
  const { view, sensorId } = viewWithSensor();
  view.setAttribute(sensorId, 'Name', 'Rauchmelder EG-02');
  const wrapped = withMutationOverlay(baseProvider(), view);

  assert.equal(wrapped.getEntityName(sensorId), 'Rauchmelder EG-02');
});

test('withMutationOverlay: a deleted entity stops being a row', () => {
  const { view } = viewWithSensor();
  view.deleteEntity(100);
  const wrapped = withMutationOverlay(baseProvider(), view);

  assert.deepEqual(wrapped.getAllEntityIds!().filter((id) => id === 100), []);
  assert.deepEqual(wrapped.getEntitiesByType(IfcTypeEnum.IfcWall), []);
});

test('withMutationOverlay: type property sets resolve through an overlay-authored IfcRelDefinesByType', () => {
  const { view, sensorId } = viewWithSensor();
  const wrapped = withMutationOverlay(baseProvider(), view);

  // The parsed store's relationship graph is built at load time and cannot see
  // a relationship authored this session, so this is the fallback path.
  const psets = wrapped.getTypePropertySets!(sensorId);
  const names = psets.flatMap((p) => p.properties.map((prop) => prop.name));
  assert.ok(names.includes('OperatingVoltage'), `expected type pset property, got ${JSON.stringify(names)}`);
  assert.equal(wrapped.getEntityDefiningTypeName!(sensorId), 'Rauchmelder');
});

test('withMutationOverlay: property sets authored on an existing entity are visible', () => {
  const { view, editor } = viewWithSensor();
  editor.addPropertySet(100, 'Pset_Custom', [{ name: 'Owner', value: 'Facility', type: 'TEXT' }]);
  const wrapped = withMutationOverlay(baseProvider(), view);

  const names = wrapped.getPropertySets(100).flatMap((p) => p.properties.map((prop) => prop.name));
  assert.ok(names.includes('Owner'));
});
