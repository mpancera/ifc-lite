/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRooms, isSettled, isPlaceholderName, summariseRooms, sortFindings, nextOpen,
  DEFAULT_SLIVER_AREA, type RoomRecord,
} from './roomChecks';

function room(partial: Partial<RoomRecord> & { key: string }): RoomRecord {
  return {
    expressId: 1,
    storeyId: 100,
    storeyName: 'EG',
    number: '0.01',
    description: 'Vorhalle',
    area: 25,
    derived: false,
    ...partial,
  };
}

describe('checkRooms', () => {
  it('leaves a finished room alone', () => {
    const [finding] = checkRooms([room({ key: 'a' })]);
    assert.deepEqual(finding.issues, []);
    assert.ok(isSettled(finding));
  });

  it('names what is missing, field by field', () => {
    const findings = checkRooms([
      room({ key: 'a', number: '' }),
      room({ key: 'b', description: '  ' }),
    ]);
    assert.deepEqual(findings[0].issues, ['no-number']);
    assert.deepEqual(findings[1].issues, ['no-description']);
  });

  it('catches the same number twice on one storey', () => {
    // The specific failure of a generated model: the CAD author drew 1.06 and
    // the wall detection found it again.
    const findings = checkRooms([
      room({ key: 'a', number: '1.06', storeyId: 200 }),
      room({ key: 'b', number: '1.06', storeyId: 200 }),
    ]);
    assert.ok(findings.every((f) => f.issues.includes('duplicate-number')));
  });

  it('lets a number repeat across storeys', () => {
    // Schemes that number per storey are normal; flagging them would make the
    // panel cry wolf on every model that uses one.
    const findings = checkRooms([
      room({ key: 'a', number: '06', storeyId: 100 }),
      room({ key: 'b', number: '06', storeyId: 200, storeyName: '1.OG' }),
    ]);
    assert.ok(findings.every((f) => !f.issues.includes('duplicate-number')));
  });

  it('sees through a generated name', () => {
    // These read as filled in, which is the reason they are worth reporting:
    // an empty field asks a question, "R7" pretends to answer it.
    for (const name of ['R7', 'Space 12', 'Raum 3', 'room_4', '0.99', 'unbenannt']) {
      assert.ok(isPlaceholderName(name), name);
    }
    for (const name of ['0.09', '1.11a', 'Bibliothek', 'WC Besucher']) {
      assert.ok(!isPlaceholderName(name), name);
    }
  });

  it('reports a placeholder once, not once per field', () => {
    const [finding] = checkRooms([room({ key: 'a', number: 'R7', description: 'R7' })]);
    assert.equal(finding.issues.filter((i) => i === 'placeholder').length, 1);
  });

  it('flags a sliver of floor as an artefact, not as a room', () => {
    const [small] = checkRooms([room({ key: 'a', area: DEFAULT_SLIVER_AREA - 0.1 })]);
    const [big] = checkRooms([room({ key: 'b', area: DEFAULT_SLIVER_AREA + 0.1 })]);
    assert.ok(small.issues.includes('sliver'));
    assert.ok(!big.issues.includes('sliver'));
  });

  it('says nothing about an area it does not have', () => {
    // No quantity and no geometry is not the same as a small room.
    const [finding] = checkRooms([room({ key: 'a', area: null })]);
    assert.ok(!finding.issues.includes('sliver'));
  });
});

describe('summariseRooms', () => {
  it('counts what is left and where the spaces came from', () => {
    const findings = checkRooms([
      room({ key: 'a', number: '0.01' }),
      room({ key: 'b', number: '', derived: true }),
      room({ key: 'c', number: '0.03', derived: true }),
    ]);
    assert.deepEqual(summariseRooms(findings), { total: 3, open: 1, settled: 2, derived: 2 });
  });
});

describe('sortFindings', () => {
  it('puts the open ones first', () => {
    const findings = checkRooms([
      room({ key: 'done', number: '0.01' }),
      room({ key: 'open', number: '0.02', description: '' }),
    ]);
    assert.deepEqual(sortFindings(findings).map((f) => f.record.key), ['open', 'done']);
  });

  it('sorts numbers the way a room schedule reads them', () => {
    const findings = checkRooms([
      room({ key: 'ten', number: '1.10' }),
      room({ key: 'nine', number: '1.9' }),
    ]);
    assert.deepEqual(sortFindings(findings).map((f) => f.record.key), ['nine', 'ten']);
  });
});

describe('nextOpen', () => {
  const findings = sortFindings(checkRooms([
    room({ key: 'a', number: '' }),
    room({ key: 'b', number: '0.02' }),
    room({ key: 'c', number: '0.03', description: '' }),
  ]));

  it('starts at the first open one', () => {
    assert.equal(nextOpen(findings, null)?.record.key, 'a');
  });

  it('skips the settled ones', () => {
    const after = nextOpen(findings, 'a')?.record.key;
    assert.equal(after, 'c');
  });

  it('wraps rather than falling off the end', () => {
    assert.equal(nextOpen(findings, 'c')?.record.key, 'a');
  });

  it('has nowhere to go when everything is settled', () => {
    assert.equal(nextOpen(checkRooms([room({ key: 'a' })]), null), null);
  });
});
