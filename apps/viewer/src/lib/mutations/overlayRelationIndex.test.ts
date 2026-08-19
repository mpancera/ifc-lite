/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NewEntity } from '@ifc-lite/mutations';
import {
  buildOverlayRelationIndex,
  RELATION_ROLES,
  referencesElement,
  refId,
  refIds,
} from './overlayRelationIndex';

const SENSOR = 101;
const ROOM = 60;
const STOREY = 43;
const GROUP = 900;

function rel(type: string, attributes: NewEntity['attributes']): NewEntity {
  return { expressId: 9000 + Math.floor(Math.random() * 900), type, attributes };
}

/** (GlobalId, OwnerHistory, Name, Description, RelatedElements, RelatingStructure) */
const contained = (elements: number[], container: number) =>
  rel('IfcRelContainedInSpatialStructure', [null, null, null, null, elements.map((id) => `#${id}`), `#${container}`]);

/** (…, RelatingObject, RelatedObjects) — relating first, unlike containment. */
const aggregates = (parent: number, children: number[]) =>
  rel('IfcRelAggregates', [null, null, null, null, `#${parent}`, children.map((id) => `#${id}`)]);

/** (…, RelatedObjects, RelatedObjectsType, RelatingGroup) */
const assigns = (members: number[], group: number) =>
  rel('IfcRelAssignsToGroup', [null, null, null, null, members.map((id) => `#${id}`), null, `#${group}`]);

describe('refId / refIds', () => {
  it('reads a single reference and a list with the same call', () => {
    assert.equal(refId('#42'), 42);
    assert.deepEqual(refIds('#42'), [42]);
    assert.deepEqual(refIds(['#1', '#2']), [1, 2]);
  });

  it('ignores anything that is not a reference instead of inventing an id', () => {
    assert.equal(refId('42'), null);
    assert.equal(refId(null), null);
    assert.equal(refId('#nope'), null);
    assert.deepEqual(refIds(['#1', 'text', null]), [1]);
    assert.deepEqual(refIds(undefined), []);
  });

  it('answers referencesElement for both shapes', () => {
    assert.equal(referencesElement(['#1', '#2'], 2), true);
    assert.equal(referencesElement('#7', 7), true);
    assert.equal(referencesElement(['#1'], 2), false);
  });
});

describe('buildOverlayRelationIndex', () => {
  it('walks containment from the element to its container in inverse', () => {
    const index = buildOverlayRelationIndex([contained([SENSOR], ROOM)]);
    assert.deepEqual(index.related(SENSOR, 'IfcRelContainedInSpatialStructure', 'inverse'), [ROOM]);
    assert.deepEqual(index.related(ROOM, 'IfcRelContainedInSpatialStructure', 'forward'), [SENSOR]);
  });

  it('gets IfcRelAggregates the right way round', () => {
    // The trap: aggregates lists the relating object FIRST, the opposite of
    // containment. Read positionally instead of by role and every room ends
    // up aggregating its storey.
    const index = buildOverlayRelationIndex([aggregates(STOREY, [ROOM])]);
    assert.deepEqual(index.related(ROOM, 'IfcRelAggregates', 'inverse'), [STOREY]);
    assert.deepEqual(index.related(STOREY, 'IfcRelAggregates', 'forward'), [ROOM]);
  });

  it('finds the group at attribute 6, not at 5', () => {
    // IfcRelAssigns puts RelatedObjectsType between the members and the group.
    const index = buildOverlayRelationIndex([assigns([SENSOR], GROUP)]);
    assert.deepEqual(index.related(SENSOR, 'IfcRelAssignsToGroup', 'inverse'), [GROUP]);
  });

  it('carries a whole chain, so element -> room -> storey is walkable', () => {
    const index = buildOverlayRelationIndex([contained([SENSOR], ROOM), aggregates(STOREY, [ROOM])]);
    const [room] = index.related(SENSOR, 'IfcRelContainedInSpatialStructure', 'inverse');
    assert.equal(room, ROOM);
    assert.deepEqual(index.related(room, 'IfcRelAggregates', 'inverse'), [STOREY]);
  });

  it('keeps every member of a multi-element relationship', () => {
    const index = buildOverlayRelationIndex([contained([SENSOR, SENSOR + 1, SENSOR + 2], ROOM)]);
    assert.deepEqual(index.related(ROOM, 'IfcRelContainedInSpatialStructure', 'forward').slice().sort(),
      [SENSOR, SENSOR + 1, SENSOR + 2]);
  });

  it('skips relationships whose roles are unknown rather than guessing them', () => {
    // A wrong guess puts edges into a drawing that look authoritative.
    const index = buildOverlayRelationIndex([rel('IfcRelSomethingNew', [null, null, null, null, ['#1'], '#2'])]);
    assert.equal(index.size, 0);
    assert.deepEqual(index.related(1, 'IfcRelSomethingNew', 'inverse'), []);
  });

  it('answers empty for an id nobody related, and for an empty overlay', () => {
    const index = buildOverlayRelationIndex([contained([SENSOR], ROOM)]);
    assert.deepEqual(index.related(9999, 'IfcRelContainedInSpatialStructure', 'inverse'), []);
    assert.equal(buildOverlayRelationIndex([]).size, 0);
  });

  it('describes every relation the graph can walk', () => {
    // The graph package names six relations; a role missing here means that
    // chain silently loses its authored half.
    for (const name of [
      'IfcRelContainedInSpatialStructure',
      'IfcRelReferencedInSpatialStructure',
      'IfcRelAggregates',
      'IfcRelAssignsToGroup',
      'IfcRelConnectsPortToElement',
      'IfcRelConnectsPorts',
    ]) {
      assert.ok(RELATION_ROLES[name], `no roles for ${name}`);
    }
  });
});
