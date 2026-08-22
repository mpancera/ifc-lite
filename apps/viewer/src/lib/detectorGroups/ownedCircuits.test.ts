/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Recognising our own groups after the file has been reopened.
 *
 * The way of working these guard is the ordinary one: paint the zones, build
 * the groups, export, reopen. From the reopen onwards everything is parsed,
 * and a reader that only knew the session reported zero groups on a model that
 * had eighteen — then built a duplicate for every one of them on the next run.
 *
 * The other half is the line that must NOT move: a circuit somebody else wrote
 * stays theirs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RelationshipType } from '@ifc-lite/data';
import {
  CIRCUIT_OBJECT_TYPE,
  mergeOwnCircuits,
  parsedCircuitsOf,
  readCircuits,
  type CircuitInfo,
  type CircuitReadableStore,
} from './circuits.js';
import { parsedZonesOf } from '@/lib/ifcZones/membership.js';

/**
 * Three circuits in the file: two ours, one another trade's — same class,
 * different `ObjectType`.
 */
function circuitStore(): CircuitReadableStore {
  const objectTypes: Record<number, string> = {
    900: CIRCUIT_OBJECT_TYPE,
    901: CIRCUIT_OBJECT_TYPE,
    902: 'Beleuchtungsgruppe',
  };
  const names: Record<number, string> = { 900: 'MZ01', 901: 'MZ02', 902: 'B1' };
  const members: Record<number, number[]> = { 900: [10, 11], 901: [12], 902: [20] };
  return {
    // A Meldergruppe is a plain `IfcGroup` now — see `CIRCUIT_ENTITY`.
    entityIndex: { byType: { get: (type) => (type === 'IFCGROUP' ? [900, 901, 902] : undefined) } },
    entities: {
      getName: (id) => names[id] ?? '',
      getObjectType: (id) => objectTypes[id] ?? null,
    },
    relationships: { getRelated: (id) => members[id] ?? [] },
  };
}

describe('parsedCircuitsOf', () => {
  it('finds the groups this tool wrote into the file', () => {
    const circuits = parsedCircuitsOf(circuitStore(), RelationshipType.AssignsToGroup);
    assert.deepEqual(circuits.map((c) => c.name), ['MZ01', 'MZ02']);
    assert.deepEqual(circuits[0].memberIds, [10, 11]);
  });

  it('leaves another trade\'s circuit alone', () => {
    // Same IFC class. The marker is the ObjectType, and without that test this
    // would happily extend a lighting circuit with fire detectors.
    const circuits = parsedCircuitsOf(circuitStore(), RelationshipType.AssignsToGroup);
    assert.equal(circuits.some((c) => c.name === 'B1'), false);
  });

  it('reports no writable relationship for a parsed circuit', () => {
    // The relationship carrying membership is not addressable through the
    // store, so a write emits a fresh one and the next read consolidates.
    const circuits = parsedCircuitsOf(circuitStore(), RelationshipType.AssignsToGroup);
    assert.equal(circuits[0].relExpressId, null);
  });

  it('answers empty for a store that carries none', () => {
    assert.deepEqual(parsedCircuitsOf({}, RelationshipType.AssignsToGroup), []);
    assert.deepEqual(parsedCircuitsOf(null, RelationshipType.AssignsToGroup), []);
  });
});

describe('readCircuits by class', () => {
  it('reads the class the caller names, not the default', () => {
    // The wiring writes `IfcDistributionCircuit`; the Meldergruppen write
    // `IfcGroup`. Reading with the default missed every run this tool had just
    // written, so each new run believed it was the first and three of them
    // came out called MK01.
    const authoredRun = {
      expressId: 700,
      type: 'IfcDistributionCircuit',
      attributes: ['guid', null, 'MK01', null, 'Melderkreis'],
    };
    assert.deepEqual(
      readCircuits([authoredRun], 'Melderkreis', 'IfcDistributionCircuit').map((c) => c.name),
      ['MK01'],
    );
    // And the default still means a Meldergruppe, so the two never cross.
    assert.deepEqual(readCircuits([authoredRun], 'Melderkreis'), []);
  });
});

describe('mergeOwnCircuits', () => {
  const authored = (name: string, expressId: number, memberIds: number[]): CircuitInfo => ({
    expressId, name, relExpressId: 5000, memberIds,
  });

  it('lets the session win over the file, by name', () => {
    // Matched by name and not by id: a group is "the one called MZ01", and the
    // session's record carries the later membership and a relationship that
    // can be rewritten in place.
    const merged = mergeOwnCircuits(
      parsedCircuitsOf(circuitStore(), RelationshipType.AssignsToGroup),
      [authored('MZ01', 7000, [10, 11, 12])],
    );
    const mz01 = merged.find((c) => c.name === 'MZ01');
    assert.equal(mz01?.expressId, 7000);
    assert.equal(mz01?.relExpressId, 5000);
    assert.deepEqual(mz01?.memberIds, [10, 11, 12]);
  });

  it('keeps a file group the session has not touched', () => {
    const merged = mergeOwnCircuits(
      parsedCircuitsOf(circuitStore(), RelationshipType.AssignsToGroup),
      [authored('MZ01', 7000, [10])],
    );
    // MZ02 exists only in the file. Dropping it is what produced the duplicate.
    assert.equal(merged.some((c) => c.name === 'MZ02'), true);
    assert.equal(merged.length, 2);
  });
});

describe('parsedZonesOf', () => {
  it('reads the zones the file carries, with their rooms', () => {
    const zones = parsedZonesOf(
      {
        entityIndex: { byType: { get: (type) => (type === 'IFCZONE' ? [800, 801] : undefined) } },
        entities: {
          getName: (id) => (id === 800 ? 'MZ01' : 'MZ02'),
          getObjectType: () => 'TriggerZoneFire',
          getDescription: () => 'Ausstellung ZoneDisplay=#E53935',
        },
        relationships: { getRelated: (id) => (id === 800 ? [10, 11] : []) },
      },
      RelationshipType.AssignsToGroup,
    );
    assert.deepEqual(zones.map((z) => z.name), ['MZ01', 'MZ02']);
    assert.deepEqual(zones[0].memberIds, [10, 11]);
    // A zone with no room in it is still a zone — it is the empty group a
    // handover check is supposed to surface.
    assert.deepEqual(zones[1].memberIds, []);
  });
});
