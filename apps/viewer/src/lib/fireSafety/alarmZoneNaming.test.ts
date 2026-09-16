/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * These numbers are read off a printed plan at night. What is pinned here is
 * that a number means one floor and one floor only, and that no detector group
 * can come out in the colour of a call point.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  floorKindFromName, detectorZoneLabel, callPointZoneLabel, sprinklerZoneLabel,
  numberAlarmZones, DETECTOR_GROUP_COLOURS, CALL_POINT_COLOUR, SPRINKLER_COLOUR,
  MAX_DETECTOR_GROUPS_PER_FLOOR,
} from './alarmZoneNaming.js';

describe('floorKindFromName', () => {
  it('reads the storey names this model actually uses', () => {
    assert.deepEqual(floorKindFromName('U1'), { kind: 'basement' });
    assert.deepEqual(floorKindFromName('00'), { kind: 'ground' });
    assert.deepEqual(floorKindFromName('01'), { kind: 'upper', level: 1 });
    assert.deepEqual(floorKindFromName('02'), { kind: 'upper', level: 2 });
  });

  it('reads the spellings other offices use', () => {
    assert.deepEqual(floorKindFromName('UG'), { kind: 'basement' });
    assert.deepEqual(floorKindFromName('KG'), { kind: 'basement' });
    assert.deepEqual(floorKindFromName('EG'), { kind: 'ground' });
    assert.deepEqual(floorKindFromName('1.OG'), { kind: 'upper', level: 1 });
    assert.deepEqual(floorKindFromName('2. Obergeschoss'), { kind: 'upper', level: 2 });
  });

  it('says it does not know rather than guessing', () => {
    // `SIT` is a real storey in this model and means nothing to the scheme.
    // Numbered wrongly it would put a group on a floor it is not on.
    assert.deepEqual(floorKindFromName('SIT'), { kind: 'unknown' });
    assert.deepEqual(floorKindFromName('Dachstock'), { kind: 'unknown' });
    assert.deepEqual(floorKindFromName(''), { kind: 'unknown' });
  });
});

describe('detectorZoneLabel', () => {
  it('numbers each floor the way the scheme says', () => {
    assert.equal(detectorZoneLabel({ kind: 'basement' }, 1)?.number, 'U1');
    assert.equal(detectorZoneLabel({ kind: 'basement' }, 9)?.number, 'U9');
    assert.equal(detectorZoneLabel({ kind: 'ground' }, 1)?.number, '01');
    assert.equal(detectorZoneLabel({ kind: 'ground' }, 9)?.number, '09');
    assert.equal(detectorZoneLabel({ kind: 'upper', level: 1 }, 3)?.number, '13');
    assert.equal(detectorZoneLabel({ kind: 'upper', level: 2 }, 9)?.number, '29');
  });

  it('refuses a tenth group instead of rolling over into another floor', () => {
    // `010` reads as ground-floor group 10 to a machine and as floor 0, group
    // 10 to nobody. A number that does not follow the scheme is worse than an
    // absent one.
    assert.equal(detectorZoneLabel({ kind: 'ground' }, MAX_DETECTOR_GROUPS_PER_FLOOR + 1), null);
    assert.equal(detectorZoneLabel({ kind: 'ground' }, 0), null);
    assert.equal(detectorZoneLabel({ kind: 'ground' }, 1.5), null);
  });

  it('refuses a storey it could not place', () => {
    assert.equal(detectorZoneLabel({ kind: 'unknown' }, 1), null);
  });

  it('refuses a tenth floor, which the first position cannot hold', () => {
    assert.equal(detectorZoneLabel({ kind: 'upper', level: 10 }, 1), null);
  });

  it('never gives a detector group the colour of a call point or a sprinkler', () => {
    // A detector group in red is a group somebody reads as a call point.
    for (let i = 1; i <= MAX_DETECTOR_GROUPS_PER_FLOOR; i += 1) {
      const colour = detectorZoneLabel({ kind: 'ground' }, i)!.colour;
      assert.notEqual(colour.toLowerCase(), CALL_POINT_COLOUR);
      assert.notEqual(colour.toLowerCase(), SPRINKLER_COLOUR);
    }
  });

  it('gives the groups of ONE floor different colours', () => {
    const colours = new Set<string>();
    for (let i = 1; i <= MAX_DETECTOR_GROUPS_PER_FLOOR; i += 1) {
      colours.add(detectorZoneLabel({ kind: 'ground' }, i)!.colour);
    }

    assert.equal(colours.size, MAX_DETECTOR_GROUPS_PER_FLOOR);
  });

  it('repeats the colour on another floor, which is allowed and intended', () => {
    // `01` and `11` are never on the same sheet, and nine more colours that
    // had to differ from these too would be shades, not colours.
    assert.equal(
      detectorZoneLabel({ kind: 'ground' }, 2)!.colour,
      detectorZoneLabel({ kind: 'upper', level: 1 }, 2)!.colour,
    );
  });
});

describe('callPointZoneLabel', () => {
  it('counts across the building, two digits', () => {
    assert.equal(callPointZoneLabel(1)?.number, 'H01');
    assert.equal(callPointZoneLabel(12)?.number, 'H12');
  });

  it('is red, on every plan', () => {
    assert.equal(callPointZoneLabel(1)?.colour, CALL_POINT_COLOUR);
  });

  it('refuses a sequence the two digits cannot hold', () => {
    assert.equal(callPointZoneLabel(100), null);
    assert.equal(callPointZoneLabel(0), null);
  });
});

describe('sprinklerZoneLabel', () => {
  it('uses the seventies', () => {
    assert.equal(sprinklerZoneLabel(1)?.number, '71');
    assert.equal(sprinklerZoneLabel(3)?.number, '73');
  });

  it('is cyan, on every plan', () => {
    assert.equal(sprinklerZoneLabel(1)?.colour, SPRINKLER_COLOUR);
  });

  it('stops at the end of its own decade', () => {
    // `80` is not a sprinkler number, it is somebody else's range.
    assert.equal(sprinklerZoneLabel(10), null);
  });
});

describe('numberAlarmZones', () => {
  it('runs the detector sequence per storey and the others per building', () => {
    // Three counters in three places is how two groups end up called H03.
    const numbered = numberAlarmZones([
      { key: 'a', kind: 'detector', storeyName: '00' },
      { key: 'b', kind: 'detector', storeyName: '00' },
      { key: 'c', kind: 'detector', storeyName: '01' },
      { key: 'd', kind: 'callpoint', storeyName: '00' },
      { key: 'e', kind: 'callpoint', storeyName: '01' },
      { key: 'f', kind: 'sprinkler', storeyName: 'U1' },
    ]);

    assert.deepEqual(numbered.map((n) => n.label?.number),
      ['01', '02', '11', 'H01', 'H02', '71']);
  });

  it('hands back a null label rather than a number that lies', () => {
    const numbered = numberAlarmZones([
      { key: 'a', kind: 'detector', storeyName: 'SIT' },
    ]);

    assert.equal(numbered[0].label, null);
    assert.equal(numbered[0].key, 'a');
  });

  it('keeps the caller\'s keys and order', () => {
    const numbered = numberAlarmZones([
      { key: 'second', kind: 'detector', storeyName: '00' },
      { key: 'first', kind: 'detector', storeyName: '00' },
    ]);

    assert.deepEqual(numbered.map((n) => n.key), ['second', 'first']);
  });

  it('does not let an unnumberable storey consume a number', () => {
    // Its sequence still advances on its own storey, but the ground floor's
    // count must not skip because a mezzanine could not be placed.
    const numbered = numberAlarmZones([
      { key: 'x', kind: 'detector', storeyName: 'SIT' },
      { key: 'y', kind: 'detector', storeyName: '00' },
    ]);

    assert.equal(numbered[1].label?.number, '01');
  });
});

describe('the palette', () => {
  it('holds one colour per possible group on a floor', () => {
    assert.equal(DETECTOR_GROUP_COLOURS.length, MAX_DETECTOR_GROUPS_PER_FLOOR);
  });

  it('is written the way the zone stores it', () => {
    for (const colour of [...DETECTOR_GROUP_COLOURS, CALL_POINT_COLOUR, SPRINKLER_COLOUR]) {
      assert.match(colour, /^#[0-9a-f]{6}$/, colour);
    }
  });
});
