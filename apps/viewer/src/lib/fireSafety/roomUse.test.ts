/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The room names are real ones out of the Langmatt model. A vocabulary tested
 * against invented names tests the vocabulary against itself.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isEscapeRoute, roomUseFromName } from './roomUse.js';

describe('roomUseFromName', () => {
  it('finds the stair', () => {
    for (const name of ['Treppenhaus', 'Fluchttreppenhaus', 'Treppe Süd', 'Stiegenhaus']) {
      assert.equal(roomUseFromName(name), 'escape-stair', name);
    }
  });

  it('finds circulation', () => {
    for (const name of [
      'Korridor Keller', 'Erschliessung', 'Erschließung', 'Vorplatz',
      'Vorraum Depot', 'Vorhalle/Vestibül', 'Gang', 'Flur', 'Durchgang Küche',
    ]) {
      assert.equal(roomUseFromName(name), 'escape-corridor', name);
    }
  });

  it('leaves everything else alone', () => {
    for (const name of [
      'Ausstellung "Halle"', 'Möbeldepot 1', 'Küche', 'Werkstatt', 'Bad',
      'Lager Museum', 'Technik/ Server', 'Veranda Cafe', 'Kunstvermittlung',
    ]) {
      assert.equal(roomUseFromName(name), 'ordinary', name);
    }
  });

  it('reads the number and the readable name together', () => {
    // Offices fill one and leave the other empty in either combination.
    assert.equal(roomUseFromName('U.18', 'Treppenhaus'), 'escape-stair');
    assert.equal(roomUseFromName('Treppenhaus', undefined), 'escape-stair');
    assert.equal(roomUseFromName('0.14', 'Korridor'), 'escape-corridor');
  });

  it('matches whole words, not substrings', () => {
    // The trap this rule exists for: a Vorratsraum is not a Vorraum, and a
    // Flurgarderobe is a garderobe. Both would match on a substring test.
    assert.equal(roomUseFromName('Vorratsraum'), 'ordinary');
    assert.equal(roomUseFromName('Flurgarderobe'), 'ordinary');
    assert.equal(roomUseFromName('Gangway'), 'ordinary');
  });

  it('gives the stair to a name that carries both', () => {
    // The stair is the stricter compartment and the two mistakes do not cost
    // the same: a corridor inside the stair compartment is over-protected, a
    // stair inside the corridor compartment is under-protected.
    assert.equal(roomUseFromName('Treppenhaus Vorplatz'), 'escape-stair');
  });

  it('does not read a lift shaft as a stair', () => {
    // Its own fire-safety problem with its own rules. Folding it in would put
    // a shaft and a stair under one set of requirements because both go up.
    assert.equal(roomUseFromName('Aufzug'), 'ordinary');
  });

  it('survives a room with no name at all', () => {
    assert.equal(roomUseFromName(undefined), 'ordinary');
    assert.equal(roomUseFromName(''), 'ordinary');
    assert.equal(roomUseFromName('   '), 'ordinary');
  });
});

describe('isEscapeRoute', () => {
  it('covers both circulation roles and nothing else', () => {
    assert.equal(isEscapeRoute('escape-stair'), true);
    assert.equal(isEscapeRoute('escape-corridor'), true);
    assert.equal(isEscapeRoute('ordinary'), false);
  });
});
