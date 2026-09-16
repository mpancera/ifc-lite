/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * This is the last thing between a proposal and somebody's model, so what is
 * pinned is what will be WRITTEN: which zones, of which theme, holding which
 * rooms, and what is claimed about every room's escape role.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planFireZones, describeFirePlan, type PlanRoom } from './firePlan.js';

let nextId = 200;
function room(storeyName: string, longName: string, x: number, area = 20): PlanRoom {
  nextId += 1;
  return {
    expressId: nextId,
    name: String(nextId),
    longName,
    area,
    centre: { x, y: 0 },
    storeyExpressId: 1,
    storeyName,
  };
}

function storey(name: string): { storeyName: string; rooms: PlanRoom[] } {
  return {
    storeyName: name,
    rooms: [
      room(name, 'Treppenhaus', 10, 9.5),
      room(name, 'Korridor', 12, 28.9),
      room(name, 'Ausstellung "Halle"', 4, 33.7),
      room(name, 'Möbeldepot', 30, 40),
    ],
  };
}

describe('planFireZones', () => {
  it('writes one compartment zone and one alarm zone per compartment', () => {
    const plan = planFireZones([storey('00')]);

    assert.equal(plan.compartmentZones.length, plan.alarmZones.length);
    assert.equal(plan.compartmentZones.length, 3);
  });

  it('gives each layer its own theme', () => {
    // The compartment becomes an IfcSpatialZone the Swiss exchange requirement
    // checks for; the alarm zone is what buildDetectorCircuits filters on.
    // One ObjectType on both would collapse the two into one statement.
    const plan = planFireZones([storey('00')]);

    assert.ok(plan.compartmentZones.every((z) => z.objectType === 'FireCompartment'));
    assert.ok(plan.alarmZones.every((z) => z.objectType === 'TriggerZoneFire'));
  });

  it('names the alarm zone with the FKS number and nothing else', () => {
    // It stands in the circle on the orientation plan. Anything more helpful
    // here ends up on the sheet.
    const plan = planFireZones([storey('00')]);

    assert.deepEqual(plan.alarmZones.map((z) => z.name), ['01', '02', '03']);
  });

  it('carries the colour on the alarm zone, not on the compartment', () => {
    const plan = planFireZones([storey('00')]);

    assert.ok(plan.alarmZones.every((z) => /^#[0-9a-f]{6}$/.test(z.colour ?? '')));
    assert.ok(plan.compartmentZones.every((z) => z.colour === null));
  });

  it('gives both zones of a compartment the same rooms', () => {
    const plan = planFireZones([storey('00')]);

    for (let i = 0; i < plan.compartmentZones.length; i += 1) {
      assert.deepEqual(plan.alarmZones[i].roomIds, plan.compartmentZones[i].roomIds);
    }
  });

  it('numbers detectors per storey, continuing the sequence on the next floor', () => {
    const plan = planFireZones([storey('00'), storey('01')]);

    assert.deepEqual(plan.alarmZones.map((z) => z.name),
      ['01', '02', '03', '11', '12', '13']);
  });

  it('states FireExit for EVERY room, not only the escape routes', () => {
    // A room with no property says nobody looked; `FireExit = FALSE` says
    // somebody did and the answer was no. In a fire-safety deliverable that
    // difference is the deliverable.
    const one = storey('00');
    const plan = planFireZones([one]);

    assert.equal(plan.fireExit.length, one.rooms.length);
    assert.equal(new Set(plan.fireExit.map((f) => f.roomId)).size, one.rooms.length);
  });

  it('says true for the stair and the corridor, false for the rest', () => {
    const one = storey('00');
    const plan = planFireZones([one]);
    const byId = new Map(plan.fireExit.map((f) => [f.roomId, f.value]));

    assert.equal(byId.get(one.rooms[0].expressId), true, 'Treppenhaus');
    assert.equal(byId.get(one.rooms[1].expressId), true, 'Korridor');
    assert.equal(byId.get(one.rooms[2].expressId), false, 'Ausstellung');
    assert.equal(byId.get(one.rooms[3].expressId), false, 'Möbeldepot');
  });

  it('reports a storey it cannot number instead of writing a wrong number', () => {
    // `SIT` is a real storey in this model and means nothing to the scheme.
    // Its compartments still exist; only the alarm zones are withheld.
    const plan = planFireZones([storey('SIT')]);

    assert.equal(plan.alarmZones.length, 0);
    assert.equal(plan.compartmentZones.length, 3);
    assert.equal(plan.unnumbered.length, 3);
  });

  it('does not let an unnumberable storey consume the next floor\'s numbers', () => {
    const plan = planFireZones([storey('SIT'), storey('00')]);

    assert.deepEqual(plan.alarmZones.map((z) => z.name), ['01', '02', '03']);
  });

  it('plans nothing for a building with no rooms', () => {
    const plan = planFireZones([{ storeyName: '00', rooms: [] }]);

    assert.deepEqual(plan.compartmentZones, []);
    assert.deepEqual(plan.alarmZones, []);
    assert.deepEqual(plan.fireExit, []);
  });

  it('keeps the compartment name on the alarm zone, where it is readable', () => {
    // The number is the name, so the words have to survive somewhere: the
    // description is what the list and the graph show.
    const plan = planFireZones([storey('00')]);

    assert.match(plan.alarmZones[0].description, /Fluchttreppenhaus/);
  });
});

describe('describeFirePlan', () => {
  it('says what would be written, per storey and in total', () => {
    const lines = describeFirePlan(planFireZones([storey('00'), storey('01')]));

    assert.ok(lines.some((l) => /^00: 3 Abschnitte, 4 Räume/.test(l)));
    assert.ok(lines.some((l) => /6 Meldergruppen/.test(l)));
  });

  it('names what it could not number', () => {
    const lines = describeFirePlan(planFireZones([storey('SIT')]));

    assert.ok(lines.some((l) => /Ohne Nummer/.test(l)));
  });
});
