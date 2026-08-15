/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  proxyWrites, isOccurrenceClass, describeDecision, psetNotice, countUndecided,
  PROXY_ENTITY, type ProxyDecision,
} from './proxyDecisions.js';
import type { ProxyGroup } from './proxyGroups.js';

const group: ProxyGroup = {
  key: 'Licht Deckenleuchte',
  label: 'Licht · Deckenleuchte',
  values: ['Licht', 'Deckenleuchte'],
  members: [11, 22, 33],
};

const lightFixture: ProxyDecision = {
  kind: 'reclassify', entity: 'IfcLightFixture', predefinedType: 'POINTSOURCE', objectType: null,
};

describe('proxyWrites', () => {
  it('writes every member — that is what deciding once means', () => {
    const writes = proxyWrites(group, lightFixture);
    assert.deepEqual(writes.map((w) => w.expressId), [11, 22, 33]);
    assert.ok(writes.every((w) => w.entity === 'IfcLightFixture'));
    assert.ok(writes.every((w) => w.predefinedType === 'POINTSOURCE'));
  });

  it('writes nothing for a group nobody has decided', () => {
    assert.deepEqual(proxyWrites(group, { kind: 'undecided' }), []);
  });

  it('records a deliberate proxy as USERDEFINED with the author\'s own word', () => {
    const writes = proxyWrites(group, { kind: 'keep', entity: PROXY_ENTITY, predefinedType: 'USERDEFINED', objectType: 'Kabelkanal' });
    assert.equal(writes.length, 3);
    assert.equal(writes[0].entity, PROXY_ENTITY);
    assert.equal(writes[0].predefinedType, 'USERDEFINED');
    assert.equal(writes[0].objectType, 'Kabelkanal');
  });

  it('will not record a deliberate proxy without saying what it is', () => {
    // 'Deliberately a proxy' with no word for the thing is the same silence
    // the triage exists to remove.
    assert.deepEqual(proxyWrites(group, { kind: 'keep', entity: PROXY_ENTITY, predefinedType: 'USERDEFINED', objectType: '   ' }), []);
  });

  it('keeps whatever class the group is already on', () => {
    // The class triage keeps a Zwischenklasse, not a proxy — and that class
    // has no PredefinedType at all, so claiming USERDEFINED would be a
    // statement about an attribute the class does not have.
    const writes = proxyWrites(group, {
      kind: 'keep', entity: 'IfcFlowTerminal', predefinedType: null, objectType: 'Bodendose',
    });
    assert.equal(writes[0].entity, 'IfcFlowTerminal');
    assert.equal(writes[0].predefinedType, null);
    assert.equal(writes[0].objectType, 'Bodendose');
  });

  it('will not keep a class that cannot be an occurrence', () => {
    assert.deepEqual(proxyWrites(group, {
      kind: 'keep', entity: 'IfcFlowTerminalType', predefinedType: null, objectType: 'x',
    }), []);
  });

  it('carries ObjectType only where PredefinedType asks for it', () => {
    const enumerated = proxyWrites(group, { ...lightFixture, objectType: 'Sonderleuchte' });
    assert.equal(enumerated[0].objectType, null);

    const userDefined = proxyWrites(group, {
      kind: 'reclassify', entity: 'IfcLightFixture',
      predefinedType: 'USERDEFINED', objectType: 'Sonderleuchte',
    });
    assert.equal(userDefined[0].objectType, 'Sonderleuchte');
  });

  it('refuses a target that cannot be an occurrence', () => {
    assert.deepEqual(proxyWrites(group, {
      kind: 'reclassify', entity: 'IfcLightFixtureType', predefinedType: null, objectType: null,
    }), []);
  });
});

describe('isOccurrenceClass', () => {
  it('accepts a building element', () => {
    assert.ok(isOccurrenceClass('IfcLightFixture'));
    assert.ok(isOccurrenceClass('IfcBuildingElementProxy'));
  });

  it('rejects the type side of the pair', () => {
    assert.ok(!isOccurrenceClass('IfcWallType'));
  });

  it('rejects anything that is not an IFC class name', () => {
    assert.ok(!isOccurrenceClass('Leuchte'));
    assert.ok(!isOccurrenceClass(''));
    assert.ok(!isOccurrenceClass('Ifc Wall'));
  });
});

describe('describeDecision', () => {
  it('says what will happen to how many', () => {
    assert.equal(describeDecision(group, lightFixture), '3 Elemente werden zu IfcLightFixture.POINTSOURCE');
  });

  it('names the class alone where there is no predefined type', () => {
    assert.equal(
      describeDecision(group, { kind: 'reclassify', entity: 'IfcFurniture', predefinedType: null, objectType: null }),
      '3 Elemente werden zu IfcFurniture',
    );
  });

  it('says a kept proxy is a decision, not a gap', () => {
    assert.equal(
      describeDecision(group, { kind: 'keep', entity: PROXY_ENTITY, predefinedType: 'USERDEFINED', objectType: 'Kabelkanal' }),
      '3 Elemente bleiben bewusst Proxy: Kabelkanal',
    );
  });

  it('names the class it keeps when that class is not the proxy', () => {
    assert.equal(
      describeDecision(group, {
        kind: 'keep', entity: 'IfcFlowTerminal', predefinedType: null, objectType: 'Bodendose',
      }),
      '3 Elemente bleiben bewusst IfcFlowTerminal: Bodendose',
    );
  });

  it('speaks singular for a group of one', () => {
    assert.equal(
      describeDecision({ ...group, members: [11] }, { kind: 'undecided' }),
      '1 Element — noch nicht entschieden',
    );
  });
});

describe('psetNotice', () => {
  it('warns that retyping brings no properties with it', () => {
    const notice = psetNotice(lightFixture);
    assert.ok(notice?.includes('IfcLightFixture'));
    assert.ok(notice?.includes('unverändert'));
  });

  it('has nothing to say about a proxy that stays one', () => {
    assert.equal(psetNotice({ kind: 'keep', entity: PROXY_ENTITY, predefinedType: 'USERDEFINED', objectType: 'Kabelkanal' }), null);
    assert.equal(psetNotice({ kind: 'undecided' }), null);
  });
});

describe('countUndecided', () => {
  const other: ProxyGroup = { ...group, key: 'Starkstrom', label: 'Starkstrom', members: [1] };

  it('counts a group with no entry as open', () => {
    assert.equal(countUndecided([group, other], new Map()), 2);
  });

  it('counts a kept proxy as decided', () => {
    const decisions = new Map<string, ProxyDecision>([
      [group.key, { kind: 'keep', entity: PROXY_ENTITY, predefinedType: 'USERDEFINED', objectType: 'Kabelkanal' }],
    ]);
    assert.equal(countUndecided([group, other], decisions), 1);
  });
});
