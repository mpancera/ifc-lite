/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeZoneTargets, eligibleZoneMembers } from './selectionTargets.js';

/** Type lookup over a fixed table; anything unlisted is unknown. */
function types(table: Record<number, string>) {
  return (_modelId: string, expressId: number) => table[expressId] ?? null;
}

describe('eligibleZoneMembers', () => {
  it('keeps the rooms and counts what it refused', () => {
    const targets = eligibleZoneMembers(
      [21, 22, 23, 24].map((expressId) => ({ modelId: 'm1', expressId })),
      'm1',
      types({ 21: 'IfcSpace', 22: 'IfcWall', 23: 'IfcSpace', 24: 'IfcWall' }),
    );

    assert.deepEqual(targets.eligible, [21, 23]);
    assert.deepEqual([...targets.refusedByType], [['IfcWall', 2]]);
  });

  it('accepts the three types IFC allows', () => {
    const targets = eligibleZoneMembers(
      [21, 22, 23].map((expressId) => ({ modelId: 'm1', expressId })),
      'm1',
      types({ 21: 'IfcSpace', 22: 'IfcSpatialZone', 23: 'IfcZone' }),
    );

    assert.deepEqual(targets.eligible, [21, 22, 23]);
  });

  it('refuses an entity whose type it cannot read', () => {
    // Assigning something of unknown class is how a wall ends up in a fire zone.
    const targets = eligibleZoneMembers([{ modelId: 'm1', expressId: 99 }], 'm1', types({}));

    assert.deepEqual(targets.eligible, []);
    assert.deepEqual([...targets.refusedByType], [['?', 1]]);
  });

  it('counts entities from another model separately', () => {
    // A zone lives in one file; express ids from another would be nonsense.
    const targets = eligibleZoneMembers(
      [{ modelId: 'm1', expressId: 21 }, { modelId: 'm2', expressId: 21 }],
      'm1',
      types({ 21: 'IfcSpace' }),
    );

    assert.deepEqual(targets.eligible, [21]);
    assert.equal(targets.otherModel, 1);
  });

  it('keeps selection order and never repeats a room', () => {
    const targets = eligibleZoneMembers(
      [23, 21, 23].map((expressId) => ({ modelId: 'm1', expressId })),
      'm1',
      types({ 21: 'IfcSpace', 23: 'IfcSpace' }),
    );

    assert.deepEqual(targets.eligible, [23, 21]);
  });

  it('handles an empty selection', () => {
    const targets = eligibleZoneMembers([], 'm1', types({}));

    assert.deepEqual(targets.eligible, []);
    assert.equal(targets.refusedByType.size, 0);
  });
});

describe('describeZoneTargets', () => {
  const clean = { eligible: [21], refusedByType: new Map(), otherModel: 0 };

  it('reports what was assigned', () => {
    assert.equal(describeZoneTargets(clean, { added: 3, removed: 0 }), '3 zugewiesen');
  });

  it('reports both directions of one stroke', () => {
    assert.equal(
      describeZoneTargets(clean, { added: 2, removed: 1 }),
      '2 zugewiesen · 1 entfernt',
    );
  });

  it('says so when the stroke changed nothing', () => {
    assert.equal(describeZoneTargets(clean, { added: 0, removed: 0 }), 'nichts geändert');
  });

  it('names what it skipped, commonest first', () => {
    const targets = {
      eligible: [21],
      refusedByType: new Map([['IfcDoor', 1], ['IfcWall', 4]]),
      otherModel: 0,
    };

    assert.equal(
      describeZoneTargets(targets, { added: 1, removed: 0 }),
      '1 zugewiesen · nicht zonenfähig: 4× IfcWall, 1× IfcDoor',
    );
  });

  it('mentions entities from another model', () => {
    const targets = { eligible: [], refusedByType: new Map(), otherModel: 2 };

    assert.equal(
      describeZoneTargets(targets, null),
      '2 aus einem anderen Modell übersprungen',
    );
  });

  it('says nothing when there is nothing to say', () => {
    assert.equal(describeZoneTargets(clean, null), null);
  });
});
