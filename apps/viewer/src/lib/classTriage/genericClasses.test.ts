/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Checked against the real IFC-4.3 table, and against the classification
 * Marc's Data Dictionary shows for the same classes — the whole point is to
 * agree with that, so a fixture would only record what I believed it said.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  genericClassKind, candidateSubclasses, GENERIC_CLASS_LABELS,
} from './genericClasses.js';

describe('genericClassKind — Zwischenklassen', () => {
  it('matches the Data Dictionary\'s own list', () => {
    // Read off the dictionary's tree view (Marc's screenshots, 2026-08-15).
    for (const entity of [
      'IfcBuiltElement', 'IfcDistributionElement', 'IfcDistributionFlowElement',
      'IfcDistributionControlElement', 'IfcEnergyConversionDevice', 'IfcFlowController',
      'IfcFlowFitting', 'IfcFlowMovingDevice', 'IfcFlowSegment', 'IfcFlowStorageDevice',
      'IfcFlowTerminal', 'IfcFlowTreatmentDevice', 'IfcFurnishingElement',
    ]) {
      assert.equal(genericClassKind(entity), 'intermediate', entity);
    }
  });

  it('is "one step up from a real class" and nothing subtler', () => {
    // "Einfach gesagt von einer Klasse (z.B. IfcWall, IfcSensor, IfcDamper) in
    // der IFC-Schema-Hierarchie nach oben" (Marc, 2026-08-15).
    assert.equal(genericClassKind('IfcSensor'), null);
    assert.equal(genericClassKind('IfcBuiltElement'), 'intermediate');
  });
});

describe('genericClassKind — Klassen, which are fine', () => {
  it('leaves the classes Marc named alone', () => {
    for (const entity of ['IfcWall', 'IfcSensor', 'IfcDamper']) {
      assert.equal(genericClassKind(entity), null, entity);
    }
  });

  it('does not trip over the deprecated StandardCase subtypes', () => {
    // IFC4 gave IfcWall a `…StandardCase` child describing how the geometry
    // was modelled, not what the thing is. Counting it made every wall a
    // Zwischenklasse — 97 of them on one real model.
    assert.equal(genericClassKind('IfcWall'), null);
    assert.equal(genericClassKind('IfcDoor'), null);
    assert.equal(genericClassKind('IfcSlab'), null);
    assert.equal(genericClassKind('IfcColumn'), null);
    assert.equal(genericClassKind('IfcBeam'), null);
  });

  it('agrees with the dictionary on the leaves it labels "Klasse"', () => {
    for (const entity of [
      'IfcAnnotation', 'IfcCivilElement', 'IfcDistributionChamberElement',
      'IfcElementAssembly', 'IfcGeographicElement',
    ]) {
      assert.equal(genericClassKind(entity), null, entity);
    }
  });

  it('does not call a proxy generic — that is the other triage\'s job', () => {
    assert.equal(genericClassKind('IfcBuildingElementProxy'), null);
  });
});

describe('genericClassKind — abstrakte Klassen', () => {
  it('agrees with the dictionary', () => {
    for (const entity of [
      'IfcElement', 'IfcProduct', 'IfcElementComponent', 'IfcFeatureElement',
      'IfcGeotechnicalElement',
    ]) {
      assert.equal(genericClassKind(entity), 'abstract', entity);
    }
  });

  it('reports abstract before intermediate where a class is both', () => {
    // IfcElement is abstract AND has subtypes. The stronger statement wins:
    // it cannot be instantiated at all.
    assert.equal(genericClassKind('IfcElement'), 'abstract');
  });
});

describe('genericClassKind — what it refuses to judge', () => {
  it('says nothing about things nobody classifies on an element', () => {
    assert.equal(genericClassKind('IfcRelAggregates'), null);
    assert.equal(genericClassKind('IfcPropertySet'), null);
    assert.equal(genericClassKind('IfcActor'), null);
    assert.equal(genericClassKind('IfcGroup'), null);
  });

  it('shrugs at a class the schema does not know', () => {
    assert.equal(genericClassKind('IfcNotAThing'), null);
    // IFC4's name for what 4.3 calls IfcBuiltElement — gone from the 4.3 table.
    assert.equal(genericClassKind('IfcBuildingElement'), null);
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

  it('does not offer a deprecated StandardCase variant', () => {
    assert.ok(!candidateSubclasses('IfcBuiltElement').includes('IfcWallStandardCase'));
  });

  it('has nothing to offer under a leaf', () => {
    assert.deepEqual(candidateSubclasses('IfcSanitaryTerminal'), []);
  });

  it('comes back in a stable order', () => {
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
