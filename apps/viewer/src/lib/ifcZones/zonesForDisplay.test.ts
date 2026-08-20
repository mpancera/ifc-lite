/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading zones to DRAW them, which is a different question from reading them
 * to paint into.
 *
 * The bug this exists for: eighteen Meldezonen sat in the loaded file, the
 * layer menu said "0", and the FKS boundary drew nothing — because the only
 * reader available returned this session's zones alone.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readZonesForDisplay, type ParsedZone, type ZoneInfo } from './membership.js';

const fileZone: ParsedZone = {
  expressId: 100,
  name: 'MZ01',
  description: 'Ausstellung Villa ZoneDisplay=#8E24AA',
  objectType: 'TriggerZoneFire',
  memberIds: [10, 11],
};

const authoredZone: ZoneInfo = {
  expressId: 200,
  name: 'MZ99',
  description: '',
  colour: '#1E88E5',
  objectType: 'TriggerZoneFire',
  relExpressId: 300,
  memberIds: [20],
};

describe('readZonesForDisplay', () => {
  it('returns the zones that came in with the file', () => {
    const zones = readZonesForDisplay([fileZone], []);
    assert.equal(zones.length, 1);
    assert.equal(zones[0].name, 'MZ01');
    assert.deepEqual(zones[0].memberIds, [10, 11]);
  });

  it('parses the colour token out of a file zone the same way', () => {
    const zones = readZonesForDisplay([fileZone], []);
    assert.equal(zones[0].colour, '#8E24AA');
    assert.equal(zones[0].description, 'Ausstellung Villa', 'and the text without it');
  });

  it('marks a file zone as not writable in place', () => {
    // It is somebody else's grouping: a write has to emit its own
    // relationship rather than rewrite one it does not own.
    assert.equal(readZonesForDisplay([fileZone], [])[0].relExpressId, null);
  });

  it('returns both sides together', () => {
    const zones = readZonesForDisplay([fileZone], [authoredZone]);
    assert.deepEqual(zones.map((z) => z.name).sort(), ['MZ01', 'MZ99']);
  });

  it('lets this session win where it edited a zone from the file', () => {
    // Same id on both sides: the authored record carries the later name,
    // colour and membership.
    const edited: ZoneInfo = { ...authoredZone, expressId: 100, name: 'MZ01 neu' };
    const zones = readZonesForDisplay([fileZone], [edited]);
    assert.equal(zones.length, 1);
    assert.equal(zones[0].name, 'MZ01 neu');
    assert.deepEqual(zones[0].memberIds, [20]);
  });

  it('is empty when there is nothing on either side', () => {
    assert.deepEqual(readZonesForDisplay([], []), []);
  });
});
