/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planMembership, readZones, zoneOfSpace, type OverlayEntity } from './membership.js';

function zone(
  expressId: number, name: string, objectType: string | null = null, description: string | null = null,
): OverlayEntity {
  return { expressId, type: 'IfcZone', attributes: ['guid', null, name, description, objectType, null] };
}
function rel(expressId: number, members: number[], groupId: number): OverlayEntity {
  return {
    expressId,
    type: 'IfcRelAssignsToGroup',
    attributes: ['guid', null, null, null, members.map((m) => `#${m}`), null, `#${groupId}`],
  };
}

describe('readZones', () => {
  it('reads a zone and the rooms assigned to it', () => {
    const zones = readZones([zone(10, 'AZ-A', 'TriggerZone'), rel(11, [21, 22], 10)]);

    assert.equal(zones.length, 1);
    assert.equal(zones[0].name, 'AZ-A');
    assert.equal(zones[0].objectType, 'TriggerZone');
    assert.equal(zones[0].relExpressId, 11);
    assert.deepEqual(zones[0].memberIds, [21, 22]);
  });

  it('separates the colour from the author text in Description', () => {
    const zones = readZones([zone(10, 'AZ-A', null, 'Ostflügel ZoneDisplay=#472A24')]);

    assert.equal(zones[0].description, 'Ostflügel');
    assert.equal(zones[0].colour, '#472A24');
  });

  it('reports no colour for a zone that carries none', () => {
    const zones = readZones([zone(10, 'AZ-A', null, 'Ostflügel')]);

    assert.equal(zones[0].description, 'Ostflügel');
    assert.equal(zones[0].colour, null);
  });

  it('reports a zone with no members yet', () => {
    const zones = readZones([zone(10, 'AZ-A')]);

    assert.deepEqual(zones[0].memberIds, []);
    assert.equal(zones[0].relExpressId, null, 'no relationship to rewrite yet');
  });

  it('keeps zones apart', () => {
    const zones = readZones([
      zone(10, 'A'), rel(11, [21], 10),
      zone(12, 'B'), rel(13, [22, 23], 12),
    ]);

    assert.deepEqual(zones.map((z) => z.memberIds), [[21], [22, 23]]);
  });

  it('merges a zone that arrived with several relationships', () => {
    // Not what we write, but a file can contain it; the first stays writable
    // and the next write consolidates.
    const zones = readZones([zone(10, 'A'), rel(11, [21], 10), rel(12, [22], 10)]);

    assert.equal(zones[0].relExpressId, 11);
    assert.deepEqual(zones[0].memberIds, [21, 22]);
  });

  it('ignores a group assignment pointing at something that is not a zone', () => {
    // Discipline roles assign elements to IfcDistributionSystem with the very
    // same relationship type.
    const zones = readZones([zone(10, 'A'), rel(11, [21], 99)]);

    assert.deepEqual(zones[0].memberIds, []);
  });

  it('survives a relationship with no members array', () => {
    const broken: OverlayEntity = {
      expressId: 11, type: 'IfcRelAssignsToGroup',
      attributes: ['guid', null, null, null, null, null, '#10'],
    };
    assert.deepEqual(readZones([zone(10, 'A'), broken])[0].memberIds, []);
  });
});

describe('planMembership', () => {
  it('adds a room that is not in the zone', () => {
    const plan = planMembership([21], [22], 'add');

    assert.deepEqual(plan.members, [21, 22]);
    assert.deepEqual(plan.added, [22]);
  });

  it('reports no change when adding a room that is already in', () => {
    // Nothing to write means no mutation, no undo entry, no autosave churn.
    const plan = planMembership([21, 22], [22], 'add');

    assert.equal(plan.members, null);
    assert.deepEqual(plan.added, []);
  });

  it('removes a room', () => {
    const plan = planMembership([21, 22, 23], [22], 'remove');

    assert.deepEqual(plan.members, [21, 23]);
    assert.deepEqual(plan.removed, [22]);
  });

  it('reports no change when removing a room that is not in', () => {
    assert.equal(planMembership([21], [99], 'remove').members, null);
  });

  it('toggles per room, so one brush both paints and unpaints', () => {
    const plan = planMembership([21, 22], [22, 23], 'toggle');

    assert.deepEqual(plan.members, [21, 23]);
    assert.deepEqual(plan.added, [23]);
    assert.deepEqual(plan.removed, [22]);
  });

  it('paints a whole selection at once', () => {
    const plan = planMembership([], [21, 22, 23], 'add');
    assert.deepEqual(plan.members, [21, 22, 23]);
  });

  it('never duplicates a room, even if named twice in one stroke', () => {
    const plan = planMembership([], [21, 21], 'add');
    assert.deepEqual(plan.members, [21]);
  });

  it('leaves the input untouched', () => {
    const current = [21, 22];
    planMembership(current, [23], 'add');
    assert.deepEqual(current, [21, 22]);
  });
});

describe('zoneOfSpace', () => {
  it('finds the zone a room belongs to', () => {
    const zones = readZones([zone(10, 'A'), rel(11, [21], 10), zone(12, 'B'), rel(13, [22], 12)]);

    assert.equal(zoneOfSpace(zones, 22)?.name, 'B');
  });

  it('returns null for a room in no zone', () => {
    const zones = readZones([zone(10, 'A'), rel(11, [21], 10)]);
    assert.equal(zoneOfSpace(zones, 99), null);
  });
});
