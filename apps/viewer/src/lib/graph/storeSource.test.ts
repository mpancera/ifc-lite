/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RelationshipType } from '@ifc-lite/data';
import { expressTypeCounts, graphSourceFor, systemsIn, type GraphStore } from './storeSource.js';

/**
 * `entityIndex.byType` is keyed by the raw STEP token and `getTypeName` returns
 * EXPRESS PascalCase. The gap between those two spellings is the whole reason
 * this adapter exists, so the fixture keeps them different — a fixture that
 * spelled both the same way would pass whether or not the translation happened.
 */
function fixture(): GraphStore {
  const types: Record<number, string> = {
    100: 'IfcBuildingStorey',
    200: 'IfcSpace',
    300: 'IfcSensor',
    400: 'IfcZone',
    500: 'IfcSystem',
    501: 'IfcDistributionSystem',
  };
  const names: Record<number, string> = {
    100: '1. Obergeschoss',
    200: 'Buero 1.01',
    300: 'BM-01',
    400: 'Brandabschnitt A',
    500: 'Brandmeldeanlage',
    501: 'Starkstrom',
  };
  return {
    entities: {
      getTypeName: (id) => types[id] ?? 'Unknown',
      getName: (id) => names[id] ?? '',
    },
    entityIndex: {
      byType: [
        ['IFCBUILDINGSTOREY', [100]],
        ['IFCSPACE', [200]],
        ['IFCSENSOR', [300]],
        ['IFCZONE', [400]],
        ['IFCSYSTEM', [500]],
        ['IFCDISTRIBUTIONSYSTEM', [501]],
      ],
    },
    relationships: {
      getRelated: (id, relType, direction) => {
        if (relType === RelationshipType.ContainsElements && direction === 'inverse' && id === 300) return [200];
        if (relType === RelationshipType.AssignsToGroup && direction === 'inverse' && id === 200) return [400];
        if (relType === RelationshipType.AssignsToGroup && direction === 'forward') {
          if (id === 500) return [300];
          if (id === 400) return [200];
        }
        return [];
      },
    },
  };
}

describe('graphSourceFor', () => {
  it('answers idsOfType in EXPRESS spelling, not the raw STEP token', () => {
    const source = graphSourceFor(fixture());
    assert.deepEqual([...source.idsOfType('IfcSensor')], [300]);
    // The raw key must NOT resolve: a caller that passes the STEP token is
    // asking the wrong question, and silently answering it would let the two
    // spellings coexist in the codebase.
    assert.deepEqual([...source.idsOfType('IFCSENSOR')], []);
  });

  it('translates IFC relationship names to the store enum in both directions', () => {
    const source = graphSourceFor(fixture());
    assert.deepEqual(
      [...source.related(300, 'IfcRelContainedInSpatialStructure', 'inverse')],
      [200],
      'the sensor reaches its room',
    );
    assert.deepEqual([...source.related(200, 'IfcRelAssignsToGroup', 'inverse')], [400]);
    assert.deepEqual([...source.related(200, 'IfcRelAssignsToGroup', 'forward')], []);
  });

  it('reports an untypeable id as null rather than as "Unknown"', () => {
    const source = graphSourceFor(fixture());
    assert.equal(source.typeOf(300), 'IfcSensor');
    // `@ifc-lite/graph` skips a node it cannot type; passing the literal
    // string "Unknown" through would draw a box for a dangling reference.
    assert.equal(source.typeOf(999), null);
  });

  it('counts by EXPRESS type', () => {
    const counts = expressTypeCounts(fixture());
    assert.equal(counts.get('IfcSensor'), 1);
    assert.equal(counts.get('IFCSENSOR'), undefined);
  });
});

describe('systemsIn', () => {
  it('finds every IfcSystem subtype through the schema, not a name list', () => {
    const names = systemsIn(fixture()).map((s) => s.name);
    // IfcDistributionSystem is never named in the code; the inheritance chain
    // is what puts it here, so IfcDistributionCircuit and IfcBuildingSystem
    // arrive on their own too.
    assert.deepEqual(names.sort(), ['Brandmeldeanlage', 'Starkstrom']);
  });

  it('leaves IfcZone out, even though the schema calls it a system', () => {
    // IfcZone IS an IfcSystem subtype in IFC4. Including it would put every
    // fire compartment in the plant picker beside the actual plant, and zones
    // already have a chain of their own.
    const systems = systemsIn(fixture());
    assert.equal(systems.some((s) => s.ifcType === 'IfcZone'), false);
    assert.equal(systems.some((s) => s.name === 'Brandabschnitt A'), false);
  });

  it('reports member counts, and keeps an empty system in the list', () => {
    const systems = systemsIn(fixture());
    assert.equal(systems.find((s) => s.name === 'Brandmeldeanlage')?.memberCount, 1);
    // An empty system is a finding; dropping it would make it look absent.
    assert.equal(systems.find((s) => s.name === 'Starkstrom')?.memberCount, 0);
    // Biggest first — the count is how you judge how big the drawing gets.
    assert.deepEqual(systems.map((s) => s.name), ['Brandmeldeanlage', 'Starkstrom']);
  });
});
