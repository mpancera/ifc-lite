/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findAlarmPanelSite, isGroundStorey } from './alarmPanelSite.js';

const STOREYS = [
  { expressId: 1, name: 'U1' },
  { expressId: 2, name: '00' },
  { expressId: 3, name: '01' },
];

/** The real ground floor of the test model, names and all. */
const ROOMS = [
  { expressId: 10, name: '0.01', longName: 'Vorhalle/ Vestibül', storeyId: 2 },
  { expressId: 11, name: '0.11', longName: 'Küche', storeyId: 2 },
  { expressId: 12, name: '0.16', longName: 'Garderobe', storeyId: 2 },
  { expressId: 13, name: '1.15', longName: 'Vorplatz', storeyId: 3 },
];

describe('findAlarmPanelSite', () => {
  it('puts the panel by the entrance on the ground floor', () => {
    const site = findAlarmPanelSite(ROOMS, STOREYS);
    assert.equal(site?.roomId, 10);
    assert.equal(site?.storeyId, 2);
    assert.match(site?.reason ?? '', /Vorhalle/);
  });

  it('does not take an entrance-like room from another storey', () => {
    // `1.15 Vorplatz` reads as an entrance and is on the first floor. A panel
    // upstairs is exactly what the ground-floor rule exists to prevent.
    const site = findAlarmPanelSite(ROOMS.filter((r) => r.expressId !== 10), STOREYS);
    assert.equal(site?.roomId, null);
    assert.equal(site?.storeyId, 2);
  });

  it('still answers a storey when no room reads as an entrance', () => {
    // Not placing it is the failure this exists to end. A findable wrong spot
    // beats a missing panel.
    const site = findAlarmPanelSite([ROOMS[1]], STOREYS);
    assert.equal(site?.roomId, null);
    assert.match(site?.reason ?? '', /Kein Eingangsraum/);
  });

  it('says so when it could not even find a ground floor', () => {
    const site = findAlarmPanelSite([], [{ expressId: 9, name: 'Level A' }]);
    assert.equal(site?.storeyId, 9);
    assert.match(site?.reason ?? '', /Kein Erdgeschoss erkannt/);
  });

  it('answers nothing for a model with no storey at all', () => {
    assert.equal(findAlarmPanelSite(ROOMS, []), null);
  });

  it('picks the same room twice for the same model', () => {
    // Two equally-named entrances must not swap between runs; a panel that
    // moves on re-run is worse than one that never got placed.
    const twins = [
      { expressId: 21, name: '0.02', longName: 'Eingang Ost', storeyId: 2 },
      { expressId: 20, name: '0.01', longName: 'Eingang West', storeyId: 2 },
    ];
    assert.equal(findAlarmPanelSite(twins, STOREYS)?.roomId, 20);
    assert.equal(findAlarmPanelSite([...twins].reverse(), STOREYS)?.roomId, 20);
  });
});

describe('isGroundStorey', () => {
  it('knows the numbering and the words', () => {
    assert.equal(isGroundStorey('00'), true);
    assert.equal(isGroundStorey('EG'), true);
    assert.equal(isGroundStorey('Erdgeschoss'), true);
  });

  it('does not mistake an upper floor for the ground one', () => {
    // A prefix test on `0` would swallow this and put the panel upstairs.
    assert.equal(isGroundStorey('0.OG'), false);
    assert.equal(isGroundStorey('01'), false);
    assert.equal(isGroundStorey('U1'), false);
  });
});
