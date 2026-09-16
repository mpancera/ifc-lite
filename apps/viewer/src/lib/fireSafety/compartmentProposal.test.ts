/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A proposal is read by somebody deciding whether to accept it, so what these
 * pin is not "the algorithm ran" but the promises it makes to that reader: the
 * escape routes are separate and flagged, every room is accounted for, and
 * nothing is invented for a room the model cannot place.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { proposeCompartments, describeProposal, type ProposalRoom } from './compartmentProposal.js';

let nextId = 100;
function room(name: string, x: number, y: number, area = 20): ProposalRoom {
  nextId += 1;
  return { expressId: nextId, name: String(nextId), longName: name, area, centre: { x, y } };
}

/**
 * The Langmatt ground floor: a stair in the middle, circulation, and rooms in
 * two wings. Names and areas are the real ones — a fixture of invented rooms
 * would test the rules against the assumptions that produced them.
 */
function storey(): ProposalRoom[] {
  return [
    room('Treppenhaus', 10, 10, 9.5),
    room('Korridor', 12, 10, 28.9),
    room('Vorhalle/Vestibül', 8, 10, 22.0),
    room('Ausstellung "Salon"', 2, 4, 22.5),
    room('Ausstellung "Halle"', 4, 4, 33.7),
    room('Küche', 6, 2, 19.5),
    room('Garderobe', 5, 6, 28.2),
    room('Ausstellung "Bibliothek"', 30, 16, 66.2),
    room('Ausstellung "Galerie"', 34, 16, 107.2),
    room('Veranda Cafe', 32, 12, 18.2),
    room('Pavillon', 36, 20, 127.0),
  ];
}

describe('proposeCompartments', () => {
  it('gives the escape stair a compartment of its own', () => {
    const { compartments } = proposeCompartments('00', storey());
    const stair = compartments.find((c) => c.use === 'escape-stair');

    assert.ok(stair);
    assert.equal(stair.rooms.length, 1);
    assert.match(stair.rooms[0].name, /Treppenhaus/);
    assert.equal(stair.fireExit, true);
  });

  it('puts all the circulation of a storey in ONE compartment', () => {
    // A corridor system on a floor is one route, not several.
    const { compartments } = proposeCompartments('00', storey());
    const corridors = compartments.filter((c) => c.use === 'escape-corridor');

    assert.equal(corridors.length, 1);
    assert.equal(corridors[0].rooms.length, 2);
    assert.equal(corridors[0].fireExit, true);
  });

  it('leaves the ordinary rooms without the escape flag', () => {
    // `FireExit` on a store room is a claim that people leave the building
    // through it.
    const { compartments } = proposeCompartments('00', storey());

    for (const c of compartments.filter((x) => x.use === 'mixed')) {
      assert.equal(c.fireExit, false, c.name);
    }
  });

  it('lands on the three or four compartments a storey was asked for', () => {
    const { compartments } = proposeCompartments('00', storey());

    assert.ok(compartments.length >= 3 && compartments.length <= 4,
      `got ${compartments.length}: ${compartments.map((c) => c.name).join(', ')}`);
  });

  it('splits the remainder into pieces that are actually next to each other', () => {
    // A compartment scattered across a floor is not a compartment. The two
    // wings of this fixture are 25 m apart and must not be mixed.
    const { compartments } = proposeCompartments('00', storey());
    const mixed = compartments.filter((c) => c.use === 'mixed');
    assert.equal(mixed.length, 2);

    const west = mixed.find((c) => c.rooms.some((r) => /Salon/.test(r.name)))!;
    assert.ok(!west.rooms.some((r) => /Galerie/.test(r.name)),
      'a west-wing compartment swallowed an east-wing room');
  });

  it('keeps a small floor as one compartment rather than cutting it in half', () => {
    const small = [
      room('Treppenhaus', 0, 0, 9),
      room('Korridor', 1, 0, 12),
      room('Technik', 2, 0, 14),
      room('Lager', 3, 0, 10),
    ];

    const { compartments } = proposeCompartments('U1', small);

    assert.equal(compartments.filter((c) => c.use === 'mixed').length, 1);
    assert.equal(compartments.length, 3);
  });

  it('accounts for every room exactly once', () => {
    // The promise that makes a proposal reviewable: nothing quietly dropped.
    const rooms = storey();
    const { compartments, skipped } = proposeCompartments('00', rooms);

    const seen = [...compartments.flatMap((c) => c.rooms), ...skipped].map((r) => r.expressId);
    assert.equal(seen.length, rooms.length);
    assert.equal(new Set(seen).size, rooms.length);
  });

  it('names a room it cannot place instead of guessing where it goes', () => {
    const rooms = [
      room('Treppenhaus', 0, 0),
      { ...room('Depot', 0, 0), centre: { x: Number.NaN, y: 0 } },
    ];

    const { compartments, skipped } = proposeCompartments('00', rooms);

    assert.equal(skipped.length, 1);
    assert.match(skipped[0].name, /Depot/);
    assert.ok(!compartments.some((c) => c.rooms.some((r) => /Depot/.test(r.name))));
  });

  it('produces nothing at all for a storey with no rooms', () => {
    // Not an empty compartment: a storey with no rooms has no compartments,
    // and one named after it would be a zone somebody has to go and delete.
    assert.deepEqual(proposeCompartments('03', []).compartments, []);
  });

  it('carries the reason each room landed where it did', () => {
    const { compartments } = proposeCompartments('00', storey());
    const stair = compartments.find((c) => c.use === 'escape-stair')!;

    assert.equal(stair.rooms[0].reason, 'escape-stair');
  });

  it('numbers compartments per storey, stair first', () => {
    // The stair is the piece that repeats on every floor; a reader comparing
    // storeys should find it in the same place each time.
    const { compartments } = proposeCompartments('01', storey());

    assert.equal(compartments[0].key, '01.1');
    assert.equal(compartments[0].use, 'escape-stair');
  });
});

describe('describeProposal', () => {
  it('says how big each compartment is and which are escape routes', () => {
    const lines = describeProposal(proposeCompartments('00', storey()));

    assert.ok(lines.some((l) => /Fluchttreppenhaus/.test(l) && /Fluchtweg/.test(l)));
    assert.ok(lines.every((l) => /m²/.test(l) || /nicht zugeteilt/.test(l)));
  });
});
