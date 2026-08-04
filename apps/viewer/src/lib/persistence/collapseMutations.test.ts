/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Mutation } from '@ifc-lite/mutations';
import { collapseMutations } from './collapseMutations.js';

let seq = 0;
function prop(entityId: number, propName: string, newValue: string, psetName = 'Pset_X'): Mutation {
  return {
    id: `m${seq++}`, type: 'UPDATE_PROPERTY', timestamp: seq, modelId: 'm1',
    entityId, psetName, propName, newValue,
  } as Mutation;
}
function attr(entityId: number, attributeName: string, newValue: string): Mutation {
  return {
    id: `m${seq++}`, type: 'UPDATE_ATTRIBUTE', timestamp: seq, modelId: 'm1',
    entityId, attributeName, newValue,
  } as Mutation;
}

describe('collapseMutations', () => {
  it('keeps only the last write per property', () => {
    // The shape that broke IndexedDB: the same slot written over and over.
    const collapsed = collapseMutations([
      prop(1, 'TagNumber', '1'),
      prop(1, 'TagNumber', '1'),
      prop(1, 'TagNumber', '1'),
    ]);

    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0].newValue, '1');
  });

  it('keeps the LAST value, not the first', () => {
    const collapsed = collapseMutations([
      prop(1, 'AssetIdentifier', 'old'),
      prop(1, 'AssetIdentifier', 'new'),
    ]);

    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0].newValue, 'new');
  });

  it('keeps slots on different entities apart', () => {
    const collapsed = collapseMutations([prop(1, 'P', 'a'), prop(2, 'P', 'b')]);
    assert.deepEqual(collapsed.map((m) => m.entityId), [1, 2]);
  });

  it('keeps the same property name in different property sets apart', () => {
    const collapsed = collapseMutations([
      prop(1, 'Width', 'a', 'Pset_One'),
      prop(1, 'Width', 'b', 'Pset_Two'),
    ]);
    assert.equal(collapsed.length, 2);
  });

  it('keeps a property and a quantity of the same name apart', () => {
    // A pset and a qset can both legitimately carry `Width` on one entity.
    const quantity = { ...prop(1, 'Width', 'q'), type: 'UPDATE_QUANTITY' } as Mutation;
    const collapsed = collapseMutations([prop(1, 'Width', 'p'), quantity]);
    assert.equal(collapsed.length, 2);
  });

  it('keeps attributes apart from properties', () => {
    const collapsed = collapseMutations([prop(1, 'Name', 'p'), attr(1, 'Name', 'a')]);
    assert.equal(collapsed.length, 2);
  });

  it('lets a later delete win over an earlier set', () => {
    // Deleting is a statement about the same slot; if it came last then
    // "absent" is the state to restore.
    const del = { ...prop(1, 'P', ''), type: 'DELETE_PROPERTY' } as Mutation;
    const collapsed = collapseMutations([prop(1, 'P', 'v'), del]);

    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0].type, 'DELETE_PROPERTY');
  });

  it('lets a later set win over an earlier delete', () => {
    const del = { ...prop(1, 'P', ''), type: 'DELETE_PROPERTY' } as Mutation;
    const collapsed = collapseMutations([del, prop(1, 'P', 'v')]);

    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0].type, 'UPDATE_PROPERTY');
  });

  it('never collapses entity-level records', () => {
    // Creating and deleting entities is not idempotent per slot, and replay
    // depends on the order.
    const create = { ...prop(1, '', ''), type: 'CREATE_ENTITY' } as Mutation;
    const remove = { ...prop(1, '', ''), type: 'DELETE_ENTITY' } as Mutation;
    const retype = { ...prop(1, '', ''), type: 'UPDATE_ENTITY_TYPE' } as Mutation;

    assert.equal(collapseMutations([create, create, remove, retype]).length, 4);
  });

  it('preserves order, so creation still precedes the edits that follow it', () => {
    const create = { ...prop(9, '', ''), type: 'CREATE_ENTITY' } as Mutation;
    const collapsed = collapseMutations([create, prop(9, 'P', 'a'), prop(9, 'P', 'b')]);

    assert.deepEqual(collapsed.map((m) => m.type), ['CREATE_ENTITY', 'UPDATE_PROPERTY']);
  });

  it('leaves an already-minimal journal untouched', () => {
    const input = [prop(1, 'A', 'x'), prop(1, 'B', 'y'), attr(2, 'Name', 'z')];
    assert.deepEqual(collapseMutations(input), input);
  });

  it('handles an empty journal', () => {
    assert.deepEqual(collapseMutations([]), []);
  });
});
