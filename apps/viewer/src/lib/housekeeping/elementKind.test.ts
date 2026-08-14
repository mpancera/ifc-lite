/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The classification the whole Prüfplan turns on, against the real schema
 * registry rather than a stand-in — the failure being guarded against is
 * precisely a class whose inheritance is not what one assumed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyElementKind } from '@/hooks/useHousekeeping';

describe('classifyElementKind', () => {
  it('calls an ordinary building element an element', () => {
    assert.equal(classifyElementKind('IfcWall'), 'element');
    assert.equal(classifyElementKind('IfcDoor'), 'element');
    assert.equal(classifyElementKind('IfcBuildingElementProxy'), 'element');
  });

  it('separates a room from the structure it hangs in', () => {
    // IfcSpace IS an IfcSpatialStructureElement. Asking about the structure
    // first would file every room as part of the tree and never check it.
    assert.equal(classifyElementKind('IfcSpace'), 'space');
    assert.equal(classifyElementKind('IfcBuildingStorey'), 'structure');
    assert.equal(classifyElementKind('IfcBuilding'), 'structure');
    assert.equal(classifyElementKind('IfcSite'), 'structure');
  });

  it('separates an opening from the elements', () => {
    // IfcOpeningElement IS an IfcElement, and it is contained in no storey.
    // Getting this wrong reports every door and window reveal in the model.
    assert.equal(classifyElementKind('IfcOpeningElement'), 'feature');
  });

  it('has nothing to check about things that are not products', () => {
    assert.equal(classifyElementKind('IfcRelAggregates'), null);
    assert.equal(classifyElementKind('IfcPropertySet'), null);
    assert.equal(classifyElementKind('IfcCartesianPoint'), null);
    assert.equal(classifyElementKind('IfcProject'), null);
  });

  it('does not mistake a type object for an occurrence', () => {
    // IfcWallType is what an element is defined BY. It sits in no storey and
    // must not be asked to.
    assert.equal(classifyElementKind('IfcWallType'), null);
  });

  it('shrugs at a class the registry does not know', () => {
    assert.equal(classifyElementKind('IfcNotAThing'), null);
  });
});
