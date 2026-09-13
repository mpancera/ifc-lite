/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSpatialContainment, checkSpaceInStorey, checkTypeAssignment,
  checkIdentification, checkClassAssignment, checkDecomposition, namePrefix,
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
    partOfWhole: false,
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

describe('checkDecomposition', () => {
  const pane = (id: number, over = {}) => element(id, {
    ifcType: 'IfcPlate', name: `Curtain Wall:Curtain Wall 1:${1237000 + id}`, ...over,
  });

  it('finds the panes and mullions that never got their curtain wall', () => {
    const [finding] = checkDecomposition([pane(1), pane(2), element(3, {
      ifcType: 'IfcMember', name: 'Curtain Wall:Curtain Wall 1:1237003',
    })]);
    assert.equal(finding.checkId, 'decomposition');
    assert.match(finding.title, /^3 Teile ohne Ganzes \(IfcMember, IfcPlate\)/);
    assert.deepEqual(finding.elements, [1, 2, 3]);
  });

  it('says nothing about a part that HAS its whole', () => {
    assert.deepEqual(checkDecomposition([pane(1, { partOfWhole: true })]), []);
  });

  it("leaves ordinary elements alone — a wall is nobody's part", () => {
    assert.deepEqual(checkDecomposition([element(1), element(2, { ifcType: 'IfcSlab' })]), []);
  });

  it('keeps a stair and a curtain wall apart, because they are different repairs', () => {
    const findings = checkDecomposition([
      pane(1),
      element(2, { ifcType: 'IfcStairFlight', name: 'Assembled Stair:Stair:1237447' }),
    ]);
    assert.equal(findings.length, 2);
    assert.deepEqual(findings.map((f) => f.id).sort(), [
      'decomposition/loose-parts/panel', 'decomposition/loose-parts/stair',
    ]);
  });

  it('counts the name groups, which is what says whether a repair could be automated', () => {
    // Two types from the same export: two wholes would be formed, not five.
    const findings = checkDecomposition([
      pane(1), pane(2),
      pane(3, { name: 'Curtain Wall:Shopfront:1237010' }),
      pane(4, { name: 'Curtain Wall:Shopfront:1237011' }),
      pane(5, { name: 'Curtain Wall:Shopfront:1237012' }),
    ]);
    assert.match(findings[0].detail, /Die Namen fallen in 2 Gruppen/);
  });

  it('admits when the names give nothing to group by', () => {
    const [finding] = checkDecomposition([pane(1, { name: '' }), pane(2, { name: '' })]);
    assert.match(finding.detail, /müsste\s+aus der Geometrie raten/);
  });

  it('is a warning, because IFC does permit a lone plate', () => {
    assert.equal(checkDecomposition([pane(1)])[0].severity, 'warning');
  });

  it('does not claim a curtain wall for a member that may be a structural one', () => {
    // The bundled bridge sample has eight loose IfcMember and wants no curtain
    // wall at all; a confident wrong answer is how a checklist loses its reader.
    const [finding] = checkDecomposition([element(1, { ifcType: 'IfcMember', name: 'Strut 1' })]);
    assert.match(finding.detail, /meist einer IfcCurtainWall/);
    assert.doesNotMatch(finding.title, /IfcCurtainWall/);
  });
});

describe('namePrefix', () => {
  it('drops the instance id an exporter appends, keeping family and type', () => {
    assert.equal(namePrefix('Curtain Wall:Curtain Wall 1:1237260'), 'Curtain Wall:Curtain Wall 1');
  });

  it('keeps a name that carries no convention at all', () => {
    assert.equal(namePrefix('Fassade Nord'), 'Fassade Nord');
  });

  it('has no key for an element with no name', () => {
    assert.equal(namePrefix('   '), null);
  });
});
