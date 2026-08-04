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
import { PropertyValueType } from '@ifc-lite/data';
import { planReevaluation, ruleManagedProperties } from './reevaluate.js';
import { ASSET_IDENTIFIER_RULE } from './defaultRules.js';
import type { SmartPropertyRule } from './types.js';

const STOREY = 43;
const ROOM = 60;

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

/**
 * A store stub exposing only what the resolver reads. `roomName` is mutable so
 * a test can change the world between evaluations.
 */
function fakeStore(state: { roomName: string }) {
  const names: Record<number, string> = { [STOREY]: 'E00' };
  return {
    spatialHierarchy: {
      elementToStorey: new Map<number, number>(),
      elementToContainer: new Map<number, number>(),
      bySpace: new Map<number, number[]>([[ROOM, []]]),
      project: { expressId: 1, type: 0, name: 'P', children: [], elements: [] },
    },
    entities: {
      getName: (id: number) => (id === ROOM ? state.roomName : names[id] ?? ''),
      getTypeName: () => '',
      getGlobalId: () => '',
      getDescription: () => '',
      getObjectType: () => '',
      getTag: () => '',
    },
  } as unknown as Parameters<typeof planReevaluation>[0]['store'];
}

/** One sensor, in a room, with a stored counter and an identifier. */
function scenario(roomName: string) {
  const state = { roomName };
  const store = fakeStore(state);
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(200), view);

  const sensorId = editor.addEntity('IfcSensor', ['guid', null, 'Rauchmelder', null, null, null, null, 'RM-001']).expressId;
  const hierarchy = (store as unknown as { spatialHierarchy: {
    elementToStorey: Map<number, number>; elementToContainer: Map<number, number>; bySpace: Map<number, number[]>;
  } }).spatialHierarchy;
  hierarchy.elementToStorey.set(sensorId, STOREY);
  hierarchy.elementToContainer.set(sensorId, ROOM);
  hierarchy.bySpace.set(ROOM, [sensorId]);

  return { store, view, sensorId, state };
}

/** A rule without the type segment, so the fixture needs no IfcRelDefinesByType. */
const RULE: SmartPropertyRule = {
  ...ASSET_IDENTIFIER_RULE,
  segments: ASSET_IDENTIFIER_RULE.segments.filter(
    (segment) => 'scope' in segment.source ? segment.source.scope !== 'IfcEntityType' : true,
  ),
};

test('a settled model plans no writes — this is what makes it terminate', () => {
  // Re-evaluation produces writes, writes are changes, changes trigger
  // re-evaluation. Only writing actual differences is what breaks the loop.
  const { store, view, sensorId } = scenario('0.14');
  const first = planReevaluation({ store, view, rules: [RULE] });
  assert.equal(first.writes.length, 1);

  for (const write of first.writes) {
    view.setProperty(write.expressId, write.pset, write.property, write.value, PropertyValueType.String);
  }
  assert.equal(sensorId > 0, true);

  const second = planReevaluation({ store, view, rules: [RULE] });
  assert.deepEqual(second.writes, []);
});

test('a renamed room produces a corrected identifier', () => {
  const { store, view, state } = scenario('0.14');
  for (const write of planReevaluation({ store, view, rules: [RULE] }).writes) {
    view.setProperty(write.expressId, write.pset, write.property, write.value, PropertyValueType.String);
  }

  state.roomName = '0.15';
  const plan = planReevaluation({ store, view, rules: [RULE] });

  assert.equal(plan.writes.length, 1);
  assert.ok(plan.writes[0].value.includes('0.15'));
  assert.ok(plan.writes[0].previous?.includes('0.14'));
});

test('re-evaluation never allocates a number for an element that has none', () => {
  // Inventing one after the fact would make the identifier depend on WHEN the
  // rule happened to run.
  const { store, view } = scenario('0.14');
  const plan = planReevaluation({ store, view, rules: [ASSET_IDENTIFIER_RULE] });

  const counterWrites = plan.writes.filter((w) => w.property === 'TagNumber');
  assert.deepEqual(counterWrites, []);
});

test('elements no rule applies to are left alone', () => {
  const { store, view } = scenario('0.14');
  const editor = new StoreEditor(makeStore(200), view);
  editor.addEntity('IfcWall', ['guid', null, 'Wand', null, null, null, null, null]);

  const plan = planReevaluation({ store, view, rules: [RULE] });
  assert.equal(plan.considered, 1);
});

test('rule-managed properties include the counter bookkeeping', () => {
  // The stored number is the rule's own record, not a value to hand-edit.
  const managed = ruleManagedProperties([ASSET_IDENTIFIER_RULE]);

  assert.ok(managed.has('Pset_ConstructionOccurence.AssetIdentifier'));
  assert.ok(managed.has('Pset_ConstructionOccurence.TagNumber'));
});

test('an edit to a REFERENCE entity is seen, not the stale parse', () => {
  // The bug this locks down: renaming a room writes into the overlay while
  // `store.entities` keeps reporting what the file said at load. Reading the
  // parse alone meant a corrected room number produced no corrected
  // identifier — and the stale one still looked plausible.
  const { store, view } = scenario('06');
  for (const write of planReevaluation({ store, view, rules: [RULE] }).writes) {
    view.setProperty(write.expressId, write.pset, write.property, write.value, PropertyValueType.String);
  }

  view.setAttribute(ROOM, 'Name', '0.14');
  const plan = planReevaluation({ store, view, rules: [RULE] });

  assert.equal(plan.writes.length, 1);
  assert.ok(plan.writes[0].value.includes('0.14'), plan.writes[0].value);
});
