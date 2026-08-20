/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectorMark, nextMarks, parseMarkIndex, planCircuits, readCircuits,
  type OverlayEntity,
} from './circuits.js';

function circuit(expressId: number, name: string): OverlayEntity {
  return {
    expressId,
    type: 'IfcDistributionCircuit',
    attributes: ['guid', '#1', name, null, 'Meldergruppe', null, '.FIREPROTECTION.'],
  };
}

function assigns(expressId: number, groupId: number, members: number[]): OverlayEntity {
  return {
    expressId,
    type: 'IfcRelAssignsToGroup',
    attributes: ['guid', '#1', null, null, members.map((id) => `#${id}`), null, `#${groupId}`],
  };
}

describe('detector marks', () => {
  it('reads as the zone plus a two-digit counter', () => {
    // Two digits because that is how it is read out on the phone: MZ01.7 and
    // MZ01.07 sort differently in every list this model ends up in.
    assert.equal(detectorMark('MZ01', 3), 'MZ01.03');
    assert.equal(detectorMark('MZ01', 12), 'MZ01.12');
  });

  it('reads a mark back only for its own group', () => {
    assert.equal(parseMarkIndex('MZ01.03', 'MZ01'), 3);
    assert.equal(parseMarkIndex('MZ01.03', 'MZ02'), null);
    assert.equal(parseMarkIndex('Rauchmelder', 'MZ01'), null, 'the name it had before');
  });

  it('continues past what is used instead of filling the gap', () => {
    // MZ01.02 was deleted. Handing that mark to a different detector is how a
    // panel ends up pointing at the wrong room.
    assert.deepEqual(nextMarks('MZ01', ['MZ01.01', 'MZ01.03'], 2), ['MZ01.04', 'MZ01.05']);
    assert.deepEqual(nextMarks('MZ02', ['MZ01.09'], 1), ['MZ02.01'], 'another group is not ours');
  });
});

describe('readCircuits', () => {
  it('reads a circuit with its members', () => {
    const circuits = readCircuits([circuit(100, 'MZ01'), assigns(200, 100, [10, 11])]);
    assert.equal(circuits.length, 1);
    assert.equal(circuits[0].name, 'MZ01');
    assert.deepEqual(circuits[0].memberIds, [10, 11]);
    assert.equal(circuits[0].relExpressId, 200);
  });

  it('merges a second relationship but keeps the first as the writable one', () => {
    const circuits = readCircuits([
      circuit(100, 'MZ01'), assigns(200, 100, [10]), assigns(201, 100, [11]),
    ]);
    assert.deepEqual(circuits[0].memberIds, [10, 11]);
    assert.equal(circuits[0].relExpressId, 200);
  });

  it('ignores a zone, which carries membership through the very same relationship', () => {
    const circuits = readCircuits([
      { expressId: 100, type: 'IfcZone', attributes: ['guid', '#1', 'MZ01'] },
      assigns(200, 100, [10]),
    ]);
    assert.deepEqual(circuits, []);
  });
});

describe('planCircuits', () => {
  const zones = [
    { expressId: 1, name: 'MZ01', memberIds: [50, 51] },
    { expressId: 2, name: 'MZ02', memberIds: [52] },
  ];

  it('puts each detector in the group of the room it stands in', () => {
    const plan = planCircuits({
      zones,
      devices: [
        { id: 10, roomId: 50 }, { id: 11, roomId: 51 }, { id: 12, roomId: 52 },
      ],
      circuits: [],
    });
    assert.deepEqual(plan.entries[0].deviceIds, [10, 11]);
    assert.deepEqual(plan.entries[1].deviceIds, [12]);
    assert.equal(plan.ungrouped, 0);
  });

  it('counts the detectors no zone covers — the number that matters', () => {
    const plan = planCircuits({
      zones,
      devices: [{ id: 10, roomId: 50 }, { id: 99, roomId: 77 }, { id: 98, roomId: null }],
      circuits: [],
    });
    assert.equal(plan.ungrouped, 2);
  });

  it('only marks the detectors that are actually joining', () => {
    // Re-running after two more detectors went in must not renumber the
    // seventeen that were already there.
    const plan = planCircuits({
      zones,
      devices: [{ id: 10, roomId: 50 }, { id: 11, roomId: 51 }],
      circuits: readCircuits([circuit(100, 'MZ01'), assigns(200, 100, [10])]),
    });
    assert.equal(plan.entries[0].circuitId, 100);
    assert.deepEqual(plan.entries[0].joining, [11]);
    assert.deepEqual(plan.entries[0].leaving, []);
  });

  it('sheds a member whose room left the zone', () => {
    const plan = planCircuits({
      zones,
      devices: [{ id: 10, roomId: 50 }, { id: 11, roomId: 77 }],
      circuits: readCircuits([circuit(100, 'MZ01'), assigns(200, 100, [10, 11])]),
    });
    assert.deepEqual(plan.entries[0].leaving, [11]);
  });

  it('reports a zone with no detector rather than skipping it', () => {
    const plan = planCircuits({
      zones,
      devices: [{ id: 10, roomId: 50 }],
      circuits: [],
    });
    assert.deepEqual(plan.emptyZones, ['MZ02']);
    // Still planned: an existing group whose rooms lost their detectors has
    // members to shed.
    assert.equal(plan.entries.length, 2);
  });
});
