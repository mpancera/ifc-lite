/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ColumnDefinition } from '@ifc-lite/lists';
import { cellEditability, isEditableColumn, isRelationColumn } from './editTarget.js';

function col(partial: Partial<ColumnDefinition>): ColumnDefinition {
  return { id: 'c', source: 'attribute', propertyName: 'Name', ...partial } as ColumnDefinition;
}

describe('cellEditability · attributes', () => {
  it('writes the plain text attributes straight through', () => {
    for (const name of ['Name', 'Description', 'ObjectType', 'PredefinedType', 'Tag']) {
      const result = cellEditability(col({ propertyName: name }));
      assert.equal(result.editable, true, `${name} should be editable`);
      if (!result.editable) return;
      assert.deepEqual(result.target, { kind: 'attribute', name });
    }
  });

  it('refuses GlobalId, because identity is what everything else is keyed by', () => {
    const result = cellEditability(col({ propertyName: 'GlobalId' }));
    assert.equal(result.editable, false);
    if (result.editable) return;
    assert.match(result.reason, /Identität/);
  });

  it('refuses Class, since a retype is a different operation', () => {
    const result = cellEditability(col({ propertyName: 'Class' }));
    assert.equal(result.editable, false);
  });

  it('refuses Type, which is a relationship rather than an attribute', () => {
    // Typing over it would have to rename a type shared by every other
    // instance, or rebind this one — neither is what editing a cell looks like.
    const result = cellEditability(col({ propertyName: 'Type' }));
    assert.equal(result.editable, false);
    if (result.editable) return;
    assert.match(result.reason, /IfcRelDefinesByType/);
  });

  it('refuses an attribute it has never heard of rather than inventing a write', () => {
    const result = cellEditability(col({ propertyName: 'NotAnAttribute' }));
    assert.equal(result.editable, false);
    if (result.editable) return;
    assert.ok(result.reason.length > 0);
  });
});

describe('cellEditability · properties', () => {
  it('targets the named property set', () => {
    const result = cellEditability(col({
      source: 'property', psetName: 'Pset_WallCommon', propertyName: 'IsExternal',
    }));
    assert.equal(result.editable, true);
    if (!result.editable) return;
    assert.deepEqual(result.target, {
      kind: 'property', psetName: 'Pset_WallCommon', propertyName: 'IsExternal',
    });
  });

  it('refuses a cross-set regex column, which has no single set to write into', () => {
    const result = cellEditability(col({ source: 'property', propertyName: '/Fire.*/' }));
    assert.equal(result.editable, false);
    if (result.editable) return;
    assert.match(result.reason, /Property-Sets/);
  });
});

describe('cellEditability · derived columns', () => {
  it('refuses every source whose value comes from a relationship or geometry', () => {
    for (const source of ['spatial', 'material', 'classification', 'model', 'zone', 'quantity'] as const) {
      const result = cellEditability(col({ source, propertyName: 'X' }));
      assert.equal(result.editable, false, `${source} must not be editable`);
      if (result.editable) return;
      // Every refusal has to say why; a cell that ignores typing without
      // explanation reads as a bug.
      assert.ok(result.reason.length > 0, `${source} needs a reason`);
    }
  });

  it('names the room column read-only for a reason a planner can act on', () => {
    const result = cellEditability(col({ source: 'spatial', propertyName: 'Room' }));
    assert.equal(result.editable, false);
    if (result.editable) return;
    assert.match(result.reason, /Beziehung/);
  });
});

describe('isEditableColumn', () => {
  it('agrees with cellEditability', () => {
    assert.equal(isEditableColumn(col({ propertyName: 'Name' })), true);
    assert.equal(isEditableColumn(col({ propertyName: 'GlobalId' })), false);
  });
});

describe('isRelationColumn', () => {
  it('marks the columns reached through a relationship', () => {
    for (const source of ['spatial', 'material', 'classification', 'zone'] as const) {
      assert.equal(isRelationColumn(col({ source, propertyName: 'X' })), true, source);
    }
    // The IfcTypeProduct behind IfcRelDefinesByType.
    assert.equal(isRelationColumn(col({ propertyName: 'Type' })), true);
  });

  it('leaves quantities unmarked, since geometry is not a relationship', () => {
    // Equally read-only, but a chain link would point at something that does
    // not exist.
    assert.equal(isRelationColumn(col({ source: 'quantity', propertyName: 'Area' })), false);
  });

  it('leaves plain attributes and properties unmarked', () => {
    assert.equal(isRelationColumn(col({ propertyName: 'Name' })), false);
    assert.equal(isRelationColumn(col({ propertyName: 'GlobalId' })), false);
    assert.equal(isRelationColumn(col({ source: 'property', psetName: 'P', propertyName: 'X' })), false);
    assert.equal(isRelationColumn(col({ source: 'model', propertyName: 'Model' })), false);
  });
});
