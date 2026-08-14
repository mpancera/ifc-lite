/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSpatialContainment, checkSpaceInStorey, checkTypeAssignment,
  checkIdentification, checkClassAssignment,
  type HousekeepingElement,
} from './modelChecks.js';

function element(
  expressId: number,
  over: Partial<HousekeepingElement> = {},
): HousekeepingElement {
  return {
    expressId,
    ifcType: 'IfcWall',
    kind: 'element',
    name: `Wand ${expressId}`,
    longName: null,
    inSpatialStructure: true,
    hasType: true,
    ...over,
  };
}

describe('checkSpatialContainment', () => {
  it('finds an element that sits in no storey', () => {
    const [finding] = checkSpatialContainment([
      element(1), element(2, { inSpatialStructure: false }),
    ]);
    assert.equal(finding.severity, 'error');
    assert.deepEqual(finding.elements, [2]);
  });

  it('says nothing when everything is placed', () => {
    assert.deepEqual(checkSpatialContainment([element(1), element(2)]), []);
  });

  it('leaves openings alone — they belong to their wall, not to a storey', () => {
    // Without this the check reports every door and window opening in the
    // model. Thousands of findings, all wrong, is how a plan gets ignored.
    const openings = [
      element(1, { ifcType: 'IfcOpeningElement', kind: 'feature', inSpatialStructure: false }),
      element(2, { ifcType: 'IfcOpeningElement', kind: 'feature', inSpatialStructure: false }),
    ];
    assert.deepEqual(checkSpatialContainment(openings), []);
  });

  it('does not ask the spatial structure to be inside itself', () => {
    const storey = element(1, {
      ifcType: 'IfcBuildingStorey', kind: 'structure', inSpatialStructure: false,
    });
    assert.deepEqual(checkSpatialContainment([storey]), []);
  });

  it('names every affected element, however many there are', () => {
    // An earlier version capped the id list at 500. That made two things lie:
    // "Im Modell zeigen" selected a truncated set, and the panel's count of
    // affected elements was the cap rather than the truth.
    const many = Array.from({ length: 3643 }, (_, i) => (
      element(i, { inSpatialStructure: false })
    ));
    const [finding] = checkSpatialContainment(many);
    assert.equal(finding.elements.length, 3643);
    assert.match(finding.title, /^3643 /);
  });
});

describe('checkSpaceInStorey', () => {
  const space = (id: number, over: Partial<HousekeepingElement> = {}) => element(id, {
    ifcType: 'IfcSpace', kind: 'space', longName: 'Sitzungszimmer', ...over,
  });

  it('finds a room that hangs outside the storeys', () => {
    const [finding] = checkSpaceInStorey([space(1), space(2, { inSpatialStructure: false })]);
    assert.equal(finding.severity, 'error');
    assert.deepEqual(finding.elements, [2]);
    assert.match(finding.title, /1 Raum ohne Geschoss/);
  });

  it('is silent about a model that has no rooms', () => {
    assert.deepEqual(checkSpaceInStorey([element(1)]), []);
  });

  it('does not confuse a loose element with a loose room', () => {
    assert.deepEqual(checkSpaceInStorey([element(1, { inSpatialStructure: false })]), []);
  });
});

describe('checkTypeAssignment', () => {
  it('reports untyped elements as a warning, not an error', () => {
    // IFC does not require a type, and a one-off piece legitimately has none.
    const [finding] = checkTypeAssignment([element(1, { hasType: false })]);
    assert.equal(finding.severity, 'warning');
    assert.deepEqual(finding.elements, [1]);
  });

  it('does not ask a room for a type', () => {
    assert.deepEqual(checkTypeAssignment([
      element(1, { kind: 'space', hasType: false }),
    ]), []);
  });
});

describe('checkIdentification', () => {
  it('finds a nameless element', () => {
    const findings = checkIdentification([element(1, { name: '' })]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'identification/no-name');
    assert.deepEqual(findings[0].elements, [1]);
  });

  it('treats whitespace as no name at all', () => {
    assert.equal(checkIdentification([element(1, { name: '   ' })]).length, 1);
  });

  it('asks for a LongName only where the class has one', () => {
    // `longName: null` means the class has no such attribute. A wall without
    // a LongName is not a defect; a room without one is a gap.
    const findings = checkIdentification([
      element(1, { longName: null }),
      element(2, { ifcType: 'IfcSpace', kind: 'space', longName: '' }),
    ]);
    assert.deepEqual(findings.map((f) => f.id), ['identification/no-long-name']);
    assert.deepEqual(findings[0].elements, [2]);
  });

  it('reports both gaps separately, because they are different jobs', () => {
    const findings = checkIdentification([
      element(1, { name: '' }),
      element(2, { ifcType: 'IfcSpace', kind: 'space', longName: '' }),
    ]);
    assert.deepEqual(findings.map((f) => f.id).sort(), [
      'identification/no-long-name', 'identification/no-name',
    ]);
  });

  it('does not name an opening', () => {
    assert.deepEqual(checkIdentification([
      element(1, { kind: 'feature', name: '' }),
    ]), []);
  });

  it('sends the user to the panel that fixes it', () => {
    const [finding] = checkIdentification([element(1, { name: '' })]);
    assert.equal(finding.remedy?.target, 'properties');
  });
});

describe('checkClassAssignment', () => {
  it('carries the triage\'s own count, so the two cannot disagree', () => {
    const [finding] = checkClassAssignment([7, 8, 9], 0);
    assert.match(finding.title, /^3 Elemente ohne Fachklasse/);
    assert.deepEqual(finding.elements, [7, 8, 9]);
    assert.equal(finding.remedy?.target, 'proxy-triage');
  });

  it('mentions the proxies the author already explained', () => {
    const [finding] = checkClassAssignment([7], 69);
    assert.match(finding.detail, /69 weitere Elemente sind bereits erklärt/);
  });

  it('says nothing when every proxy has been answered', () => {
    assert.deepEqual(checkClassAssignment([], 70), []);
  });
});
