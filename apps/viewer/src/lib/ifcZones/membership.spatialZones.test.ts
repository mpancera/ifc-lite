/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading a Brandabschnitt that is a BODY rather than a group of rooms.
 *
 * The assignment of a room can go through either container, and the theme of
 * the body is not its PredefinedType alone: six themes share `FIRESAFETY`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authoredSpatialZonesOf, parsedSpatialZonesOf } from './membership.js';
import { themeOfSpatialZone } from './themes.js';

const REFERENCED = 70;

describe('parsedSpatialZonesOf', () => {
  const store = {
    entityIndex: { byType: { get: (t: string) => (t === 'IFCSPATIALZONE' ? [11, 12] : undefined) } },
    entities: {
      getName: (id: number) => (id === 11 ? 'BA-01' : 'MZ-1'),
      getObjectType: (id: number) => (id === 11 ? 'FIRECOMPARTMENT' : 'TriggerZoneFire'),
    },
    relationships: {
      getRelated: (id: number, type: number, direction: string) =>
        (type === REFERENCED && direction === 'forward' && id === 11 ? [1, 2] : []),
    },
    predefinedTypeOf: () => 'FIRESAFETY',
  };

  it('reads both fields, because the theme needs both', () => {
    const [compartment, trigger] = parsedSpatialZonesOf(store, REFERENCED);

    assert.equal(themeOfSpatialZone(compartment.predefinedType, compartment.objectType)?.id,
      'fire-compartment');
    // Same enum, and the refinement is the only thing telling them apart.
    assert.equal(themeOfSpatialZone(trigger.predefinedType, trigger.objectType)?.id,
      'fire-trigger');
  });

  it('reads the rooms the zone references', () => {
    assert.deepEqual(parsedSpatialZonesOf(store, REFERENCED)[0].memberIds, [1, 2]);
  });

  it('answers nothing for a store with no spatial zones', () => {
    assert.deepEqual(parsedSpatialZonesOf({}, REFERENCED), []);
    assert.deepEqual(parsedSpatialZonesOf(null, REFERENCED), []);
  });
});

describe('authoredSpatialZonesOf', () => {
  const entities = [
    { expressId: 50, type: 'IfcSpatialZone',
      attributes: ['guid', null, 'BA-01', null, 'FIRECOMPARTMENT', null, null, 'Set', '.FIRESAFETY.'] },
    { expressId: 51, type: 'IfcRelReferencedInSpatialStructure',
      attributes: ['guid', null, null, null, ['#1', '#2'], '#50'] },
    { expressId: 52, type: 'IfcWall', attributes: [] },
  ];

  it('strips the STEP enum markers, so the theme resolves', () => {
    const [zone] = authoredSpatialZonesOf(entities);

    assert.equal(zone.predefinedType, 'FIRESAFETY');
    assert.equal(themeOfSpatialZone(zone.predefinedType, zone.objectType)?.id, 'fire-compartment');
  });

  it('joins the relationship to its zone', () => {
    assert.deepEqual(authoredSpatialZonesOf(entities)[0].memberIds, [1, 2]);
  });

  it('gathers several relationships onto one zone', () => {
    // The builder writes one per zone; nothing in IFC says it must.
    const zones = authoredSpatialZonesOf([
      ...entities,
      { expressId: 53, type: 'IfcRelReferencedInSpatialStructure',
        attributes: ['guid', null, null, null, ['#3'], '#50'] },
    ]);

    assert.deepEqual(zones[0].memberIds, [1, 2, 3]);
  });

  it('answers a zone with no relationship at all', () => {
    const zones = authoredSpatialZonesOf([entities[0]]);

    assert.equal(zones.length, 1);
    assert.deepEqual(zones[0].memberIds, []);
  });
});
