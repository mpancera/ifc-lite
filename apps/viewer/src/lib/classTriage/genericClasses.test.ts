/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Run against the real schema registry, not a stand-in: the whole question is
 * what IFC actually says about these classes, and a fixture would only record
 * what I believed it said.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  genericClassKind, candidateSubclasses, GENERIC_CLASS_LABELS,
} from './genericClasses.js';

describe('genericClassKind — Zwischenklassen', () => {
  it('recognises the ones Marc named', () => {
    // "Zwischen klassen wäre z.B. IfcFlowSegment, IfcFlowController,
    // IfcDistributionFlowElement, ..." (Marc, 2026-08-15).
    assert.equal(genericClassKind('IfcFlowSegment'), 'intermediate');
    assert.equal(genericClassKind('IfcFlowController'), 'intermediate');
    assert.equal(genericClassKind('IfcDistributionFlowElement'), 'intermediate');
  });

  it('covers the rest of the distribution junctions', () => {
    for (const entity of [
      'IfcFlowTerminal', 'IfcFlowFitting', 'IfcFlowMovingDevice',
      'IfcFlowStorageDevice', 'IfcFlowTreatmentDevice', 'IfcEnergyConversionDevice',
      'IfcDistributionElement', 'IfcDistributionControlElement', 'IfcFurnishingElement',
    ]) {
      assert.equal(genericClassKind(entity), 'intermediate', entity);
    }
  });

  it('leaves a class that IS a Fachklasse alone', () => {
    // The trap: IFC4 gave these `…StandardCase` subtypes, so a rule of "has
    // subtypes" flags all of them. On one real model that was 97 walls and 33
    // doors. A wall carries a PredefinedType, so a wall is already specific.
    for (const entity of ['IfcWall', 'IfcDoor', 'IfcSlab', 'IfcColumn', 'IfcMember',
      'IfcPlate', 'IfcBeam', 'IfcWindow']) {
      assert.equal(genericClassKind(entity), null, entity);
    }
  });

  it('leaves a leaf class alone', () => {
    assert.equal(genericClassKind('IfcSanitaryTerminal'), null);
    assert.equal(genericClassKind('IfcPipeSegment'), null);
    assert.equal(genericClassKind('IfcFurniture'), null);
  });

  it('does not call a proxy generic — that is the other triage\'s job', () => {
    assert.equal(genericClassKind('IfcBuildingElementProxy'), null);
  });
});

describe('genericClassKind — abstrakte Klassen', () => {
  it('recognises a class no file may instantiate', () => {
    assert.equal(genericClassKind('IfcElement'), 'abstract');
    assert.equal(genericClassKind('IfcBuildingElement'), 'abstract');
    assert.equal(genericClassKind('IfcProduct'), 'abstract');
  });

  it('reports abstract before intermediate where a class is both', () => {
    // IfcElement is abstract AND has subtypes AND has no PredefinedType. The
    // stronger statement wins: it cannot be instantiated at all.
    assert.equal(genericClassKind('IfcElement'), 'abstract');
  });
});

describe('genericClassKind — what it refuses to judge', () => {
  it('says nothing about things nobody classifies', () => {
    assert.equal(genericClassKind('IfcRelAggregates'), null);
    assert.equal(genericClassKind('IfcPropertySet'), null);
    assert.equal(genericClassKind('IfcCartesianPoint'), null);
  });

  it('shrugs at a class the registry does not know', () => {
    assert.equal(genericClassKind('IfcNotAThing'), null);
  });

  it('does not judge a type object', () => {
    assert.equal(genericClassKind('IfcFlowSegmentType'), null);
  });
});

describe('candidateSubclasses', () => {
  it('offers the real classes under a junction', () => {
    const under = candidateSubclasses('IfcFlowSegment');
    assert.ok(under.includes('IfcPipeSegment'));
    assert.ok(under.includes('IfcDuctSegment'));
    assert.ok(under.includes('IfcCableSegment'));
  });

  it('never offers another junction as the answer', () => {
    // Answering IfcDistributionElement with IfcFlowController would move the
    // question rather than settle it.
    const under = candidateSubclasses('IfcDistributionElement');
    assert.ok(!under.includes('IfcFlowController'));
    assert.ok(!under.includes('IfcFlowTerminal'));
    assert.ok(under.includes('IfcPipeSegment'));
  });

  it('reaches through an abstract level to the classes below it', () => {
    const under = candidateSubclasses('IfcElement');
    assert.ok(under.includes('IfcWall'));
    assert.ok(under.includes('IfcDoor'));
  });

  it('has nothing to offer under a leaf', () => {
    assert.deepEqual(candidateSubclasses('IfcSanitaryTerminal'), []);
  });

  it('comes back in a stable order', () => {
    assert.deepEqual(candidateSubclasses('IfcFlowSegment'), candidateSubclasses('IfcFlowSegment'));
    const under = candidateSubclasses('IfcFlowSegment');
    assert.deepEqual([...under].sort(), under);
  });
});

describe('GENERIC_CLASS_LABELS', () => {
  it('uses the Data Dictionary\'s own words', () => {
    assert.equal(GENERIC_CLASS_LABELS.intermediate, 'Zwischenklasse');
    assert.equal(GENERIC_CLASS_LABELS.abstract, 'Abstrakte Klasse');
  });
});
