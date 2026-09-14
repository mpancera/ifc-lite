/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatArea, readRoster, type RosterRoom } from './roster.js';
import type { ZoneInfo } from './membership.js';

const room = (expressId: number, name: string, area: number | null): RosterRoom =>
  ({ expressId, name, area });

const zone = (expressId: number, name: string, memberIds: number[]): ZoneInfo => ({
  expressId, name, description: '', colour: null, objectType: 'FireCompartment',
  relExpressId: null, memberIds,
});

const ROOMS = [
  room(1, 'Büro 1', 24.5),
  room(2, 'Büro 2', 25.5),
  room(3, 'Korridor', 40),
  room(4, 'Lager', 12),
];

describe('readRoster', () => {
  it('adds a zone up, because the area is what forms a compartment', () => {
    const { rows } = readRoster(ROOMS, [zone(100, 'BA-01', [1, 2])]);

    assert.equal(rows[0].rooms, 2);
    assert.equal(rows[0].area, 50);
    assert.equal(rows[0].withoutArea, 0);
  });

  it('names the rooms that have no zone of this theme', () => {
    // The whole failure mode of assigning by hand: a room nobody looked at.
    const { unassigned } = readRoster(ROOMS, [zone(100, 'BA-01', [1, 2])]);

    assert.deepEqual(unassigned.map((r) => r.expressId), [3, 4]);
  });

  it('reports a room two zones claim, instead of picking one', () => {
    // IFC permits it and one of the two is wrong, but which is a question only
    // the author can answer. Preferring the first would leave the other
    // compartment quietly too small — a wrong number somebody would act on.
    const { contested, rows } = readRoster(ROOMS, [
      zone(100, 'BA-01', [1, 2, 3]),
      zone(101, 'BA-02', [3, 4]),
    ]);

    assert.equal(contested.length, 1);
    assert.equal(contested[0].room.expressId, 3);
    assert.deepEqual(contested[0].zoneIds, [100, 101]);
    // Both zones still count it: that is what the file says, and hiding it
    // from one of the two would make the report disagree with the model.
    assert.equal(rows[0].area, 90);
    assert.equal(rows[1].area, 52);
  });

  it('says when an area is a floor rather than a total', () => {
    const { rows } = readRoster(
      [room(1, 'Büro 1', 24.5), room(2, 'Schacht', null)],
      [zone(100, 'BA-01', [1, 2])],
    );

    assert.equal(rows[0].rooms, 2);
    assert.equal(rows[0].area, 24.5);
    assert.equal(rows[0].withoutArea, 1, 'so the panel can mark the number as incomplete');
  });

  it('counts a member it has no room for apart', () => {
    // A space on a model that is not loaded, or one deleted since. Folding it
    // into `rooms` would make the area look short for no stated reason.
    const { rows } = readRoster(ROOMS, [zone(100, 'BA-01', [1, 999])]);

    assert.equal(rows[0].rooms, 1);
    assert.equal(rows[0].strangers, 1);
  });

  it('counts a member listed twice once', () => {
    const { rows } = readRoster(ROOMS, [zone(100, 'BA-01', [1, 1, 2])]);

    assert.equal(rows[0].rooms, 2);
    assert.equal(rows[0].area, 50, 'and its area does not enter the sum twice');
  });

  it('accepts a room assigned through another container', () => {
    // An IfcSpatialZone referencing the room is the other half of the
    // assignment the exchange requirement names. Calling it unassigned would
    // send its author looking for work that is done.
    const roster = readRoster(ROOMS, [zone(100, 'BA-01', [1, 2])], new Set([3]));

    assert.deepEqual(roster.unassigned.map((r) => r.expressId), [4]);
  });

  it('does not call the body and its group a double claim', () => {
    // One compartment expressed as a group of rooms AND as the body derived
    // from it is one compartment. Flagging that pair would report the intended
    // modelling as an error.
    const roster = readRoster(ROOMS, [zone(100, 'BA-01', [1, 2])], new Set([1, 2]));

    assert.deepEqual(roster.contested, []);
    assert.deepEqual(roster.unassigned.map((r) => r.expressId), [3, 4]);
  });

  it('calls everything unassigned when there is no zone yet', () => {
    const roster = readRoster(ROOMS, []);

    assert.equal(roster.unassigned.length, 4);
    assert.equal(roster.roomCount, 4);
    assert.deepEqual(roster.contested, []);
  });
});

describe('formatArea', () => {
  it('stops at one decimal, like an area on a plan', () => {
    assert.equal(formatArea(50), '50.0 m²');
    assert.equal(formatArea(24.55), '24.6 m²');
  });

  it('groups thousands, because a compartment reaches them', () => {
    assert.match(formatArea(3980), /3.980,0 m²|3’980\.0 m²|3'980\.0 m²/);
  });
});
