/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The raw readers, asserted against real STEP text.
 *
 * A mocked store would prove nothing here. Every defect these readers exist to
 * fix is a defect of READING — a slot at the wrong index, an enum still
 * wearing its dots, a list attribute flattened to its first entry — and a
 * fixture that hands back pre-parsed values has already done the part that
 * goes wrong. So the fixture below is a STEP file, byte offsets and all, and
 * the entity index is built from it the way the parser builds one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNestsIndex,
  buildPortConnectionInfo,
  pairKey,
  readAuthoredTraits,
  readParsedTraits,
  type RawReadableStore,
} from './rawIfcReaders.js';

/**
 * A fire detector nesting one port, wired to a second port on a sounder, with
 * the cable that realizes the connection named — and one `IfcRelAggregates`
 * beside it, because telling the two decomposition relationships apart is half
 * of what these readers are for.
 */
const STEP_LINES = [
  "#1=IFCSENSOR('0Sensor',$,'BM-01',$,$,$,$,'RM.001',.FIRESENSOR.);",
  "#2=IFCDISTRIBUTIONPORT('0Port2',$,'P1',$,$,$,$,.SINK.,.CABLE.,.ELECTRICAL.);",
  "#3=IFCDISTRIBUTIONPORT('0Port3',$,'P2',$,$,$,$,.SOURCE.,.CABLE.,.ELECTRICAL.);",
  "#4=IFCALARM('0Alarm4',$,'SIR-01',$,$,$,$,'RM.002',.SIREN.);",
  "#5=IFCRELNESTS('0Nests5',$,$,$,#1,(#2));",
  "#6=IFCRELNESTS('0Nests6',$,$,$,#4,(#3));",
  "#7=IFCRELCONNECTSPORTS('0Conn07',$,'MG01',$,#2,#3,#9);",
  "#8=IFCRELAGGREGATES('0Aggr08',$,$,$,#1,(#4));",
  "#9=IFCCABLESEGMENT('0Cable9',$,'J-Y(St)Y 2x2x0.8',$,$,$,$,$,.CABLESEGMENT.);",
];

/**
 * A store over that text, built the way the parser builds one: byte offsets
 * into a single buffer, and a type index keyed by the raw STEP token.
 */
function stepFixture(): RawReadableStore {
  const text = STEP_LINES.join('\n');
  const source = new TextEncoder().encode(text);

  const byId = new Map<number, { expressId: number; type: string; byteOffset: number; byteLength: number; lineNumber: number }>();
  const byType = new Map<string, number[]>();
  const types = new Map<number, string>();

  let offset = 0;
  STEP_LINES.forEach((line, index) => {
    const bytes = new TextEncoder().encode(line);
    const expressId = Number(line.slice(1, line.indexOf('=')));
    const type = line.slice(line.indexOf('=') + 1, line.indexOf('('));
    byId.set(expressId, {
      expressId,
      type,
      byteOffset: offset,
      byteLength: bytes.length,
      lineNumber: index + 1,
    });
    const bucket = byType.get(type);
    if (bucket) bucket.push(expressId);
    else byType.set(type, [expressId]);
    types.set(expressId, type);
    offset += bytes.length + 1; // the newline the join put back
  });

  // `getTypeName` answers PascalCase, the way the entity table does — the gap
  // between that and the raw STEP token is exactly what the readers translate.
  const pascal: Record<string, string> = {
    IFCSENSOR: 'IfcSensor',
    IFCDISTRIBUTIONPORT: 'IfcDistributionPort',
    IFCALARM: 'IfcAlarm',
    IFCCABLESEGMENT: 'IfcCableSegment',
    IFCRELNESTS: 'IfcRelNests',
    IFCRELCONNECTSPORTS: 'IfcRelConnectsPorts',
    IFCRELAGGREGATES: 'IfcRelAggregates',
  };

  return {
    source,
    entityIndex: { byType, byId },
    entities: {
      getTypeName: (id: number) => pascal[types.get(id) ?? ''] ?? 'Unknown',
      getName: () => '',
    },
  } as unknown as RawReadableStore;
}

describe('buildNestsIndex', () => {
  it('indexes nesting both ways and keeps aggregation out of it', () => {
    const index = buildNestsIndex(stepFixture());
    assert.ok(index);

    // Element → its port, which is the direction the plant chain walks.
    assert.deepEqual(index.forward.get(1), [2]);
    assert.deepEqual(index.forward.get(4), [3]);
    // And back, so a port can name the device it sits on.
    assert.deepEqual(index.inverse.get(2), [1]);

    // #8 aggregates #4 under #1. It must NOT appear as nesting, or the
    // subtraction would take a real aggregation edge away from
    // IfcRelAggregates.
    assert.equal(index.excluded.has(pairKey(1, 2)), true);
    assert.equal(index.excluded.has(pairKey(1, 4)), false);
  });

  it('answers an empty index for a file with no nesting at all', () => {
    // Not `null`: no nesting is a real answer, and it has to leave the
    // Aggregates bucket whole rather than trigger the merged fallback.
    const store = stepFixture();
    const byType = store.entityIndex.byType as Map<string, number[]>;
    byType.delete('IFCRELNESTS');

    const index = buildNestsIndex(store);
    assert.ok(index);
    assert.equal(index.forward.size, 0);
    assert.equal(index.excluded.size, 0);
  });

  it('gives up honestly when there is no source text', () => {
    // The shape a store rebuilt from the geometry cache takes. `null` is what
    // tells the adapter to fall back to the merged bucket instead of
    // reporting a model with no nesting in it.
    const index = buildNestsIndex({ entityIndex: { byType: [] } });
    assert.equal(index, null);
  });
});

describe('buildPortConnectionInfo', () => {
  it('finds the connection name and the cable that realizes it', () => {
    const info = buildPortConnectionInfo(stepFixture());

    const entry = info.get(pairKey(2, 3));
    assert.equal(entry?.name, 'MG01');
    assert.equal(entry?.realizedBy, 9);
  });

  it('answers the same for either ordering of the pair', () => {
    // Which port a producer wrote first is an authoring artifact. A lookup
    // that respected it would find the cable for half the connections in a
    // model and nothing for the other half.
    const info = buildPortConnectionInfo(stepFixture());
    assert.deepEqual(info.get(pairKey(3, 2)), info.get(pairKey(2, 3)));
  });
});

describe('readParsedTraits', () => {
  it('reads the enum slots of a device', () => {
    const traits = readParsedTraits(stepFixture(), 1);
    assert.equal(traits?.predefinedType, 'FIRESENSOR');
    // Not a port, so the port-only slots stay unanswered rather than empty
    // strings the caller would have to tell apart from a real value.
    assert.equal(traits?.flowDirection, undefined);
  });

  it('reads a port at its OWN attribute positions', () => {
    // The test that earns its keep: `PredefinedType` is slot 8 on the sensor
    // above and slot 9 here. A positional read passes one of these two and
    // fails the other, which is why both are asserted from one fixture.
    const traits = readParsedTraits(stepFixture(), 2);
    assert.equal(traits?.flowDirection, 'SINK');
    assert.equal(traits?.predefinedType, 'CABLE');
    assert.equal(traits?.systemType, 'ELECTRICAL');
  });

  it('gives up honestly when there is no source text', () => {
    assert.equal(readParsedTraits({ entityIndex: { byType: [] } }, 1), null);
  });
});

describe('readAuthoredTraits', () => {
  it('reads an entity this session created, dots and all', () => {
    // A `NewEntity` holds STEP-shaped attributes, so the enum still wears its
    // dots — the parsed path is stripped for us and this one is not.
    const traits = readAuthoredTraits({
      expressId: 50,
      type: 'IfcSensor',
      attributes: ['0New', null, 'BM-99', null, null, null, null, 'RM.099', '.FIRESENSOR.'],
    } as never);
    assert.equal(traits.predefinedType, 'FIRESENSOR');
  });

  it('leaves a slot the class does not have unanswered', () => {
    const traits = readAuthoredTraits({
      expressId: 51,
      type: 'IfcSensor',
      attributes: ['0New', null, 'BM-98', null, null, null, null, 'RM.098', '.FIRESENSOR.'],
    } as never);
    // `IfcSensor` has no FlowDirection. Answering one would invent a fact.
    assert.equal(traits.flowDirection, undefined);
  });
});
