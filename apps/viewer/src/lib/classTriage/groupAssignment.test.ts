/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  typeClassFor, assignmentOrder, describeAssignment, assignmentBlocker,
  NO_ASSIGNMENT, type GroupAssignment,
} from './groupAssignment.js';

const system = (name: string): GroupAssignment => (
  { system: { kind: 'new', name }, type: null }
);

describe('typeClassFor', () => {
  it('names the type class of an ordinary element', () => {
    assert.equal(typeClassFor('IfcWall'), 'IfcWallType');
    assert.equal(typeClassFor('IfcSensor'), 'IfcSensorType');
    assert.equal(typeClassFor('IfcPipeSegment'), 'IfcPipeSegmentType');
    assert.equal(typeClassFor('IfcBuildingElementProxy'), 'IfcBuildingElementProxyType');
  });

  it('refuses where the schema has no type class', () => {
    // Checked against the registry `addEntity` validates against, so a class
    // it would reject is never offered as a button.
    assert.equal(typeClassFor('IfcAnnotation'), null);
  });

  it('does not make a type of a type', () => {
    assert.equal(typeClassFor('IfcWallType'), null);
  });

  it('shrugs at anything that is not an IFC class name', () => {
    assert.equal(typeClassFor(''), null);
    assert.equal(typeClassFor('Wand'), null);
    assert.equal(typeClassFor('Ifc Wall'), null);
  });
});

describe('assignmentOrder', () => {
  it('retypes before deriving the type from the new class', () => {
    // Creating the type first would make an IfcDistributionElementType for
    // elements about to become pipe segments — permanently, in the file.
    const both: GroupAssignment = {
      system: { kind: 'new', name: 'Starkstrom' },
      type: { kind: 'new', name: 'Motor M1' },
    };
    assert.deepEqual(assignmentOrder(true, both), ['retype', 'system', 'type']);
  });

  it('leaves the class alone when nothing reclassifies it', () => {
    assert.deepEqual(assignmentOrder(false, system('Licht')), ['system']);
  });

  it('has nothing to do for an empty assignment', () => {
    assert.deepEqual(assignmentOrder(false, NO_ASSIGNMENT), []);
    assert.deepEqual(assignmentOrder(true, NO_ASSIGNMENT), ['retype']);
  });
});

describe('assignmentBlocker', () => {
  it('refuses a type for a class that has none', () => {
    const blocker = assignmentBlocker('IfcAnnotation', {
      system: null, type: { kind: 'new', name: 'X' },
    });
    assert.match(blocker!, /keine Typ-Klasse/);
  });

  it('refuses a nameless new system or type', () => {
    assert.match(assignmentBlocker('IfcWall', system('  '))!, /braucht einen Namen/);
    assert.match(
      assignmentBlocker('IfcWall', { system: null, type: { kind: 'new', name: '' } })!,
      /braucht einen Namen/,
    );
  });

  it('lets an existing target through without a name check', () => {
    assert.equal(assignmentBlocker('IfcWall', {
      system: { kind: 'existing', expressId: 731, name: 'Starkstrom' }, type: null,
    }), null);
  });

  it('has nothing against doing nothing', () => {
    assert.equal(assignmentBlocker('IfcAnnotation', NO_ASSIGNMENT), null);
  });
});

describe('describeAssignment', () => {
  it('says what will be written, and what is new', () => {
    assert.equal(describeAssignment({
      system: { kind: 'existing', expressId: 731, name: 'Starkstrom' },
      type: { kind: 'new', name: 'Motor M1' },
    }), 'System „Starkstrom", Typ „Motor M1" (neu)');
  });

  it('says nothing when nothing is assigned', () => {
    assert.equal(describeAssignment(NO_ASSIGNMENT), '');
  });
});
