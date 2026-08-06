/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatZoneDescription, parseZoneDescription, zoneColourOf } from './zoneDisplay.js';

describe('parseZoneDescription', () => {
  it('reads the colour and hands back the author text without it', () => {
    const parsed = parseZoneDescription('Auslösezone Ostflügel ZoneDisplay=#472A24');

    assert.equal(parsed.text, 'Auslösezone Ostflügel');
    assert.equal(parsed.colour, '#472A24');
  });

  it('reads a zone that carries only a colour', () => {
    const parsed = parseZoneDescription('ZoneDisplay=#472A24');

    assert.equal(parsed.text, '');
    assert.equal(parsed.colour, '#472A24');
  });

  it('reads a description that carries no colour', () => {
    const parsed = parseZoneDescription('Auslösezone Ostflügel');

    assert.equal(parsed.text, 'Auslösezone Ostflügel');
    assert.equal(parsed.colour, null);
  });

  it('treats an absent description as empty', () => {
    for (const value of [null, undefined, '']) {
      assert.deepEqual(parseZoneDescription(value), { text: '', colour: null });
    }
  });

  it('finds a token somebody moved to the front by hand', () => {
    // Reading is lenient; the next write puts it back at the end.
    const parsed = parseZoneDescription('ZoneDisplay=#472A24 Auslösezone');

    assert.equal(parsed.text, 'Auslösezone');
    assert.equal(parsed.colour, '#472A24');
  });

  it('accepts spaces around the equals sign', () => {
    assert.equal(parseZoneDescription('Text ZoneDisplay = #472A24').colour, '#472A24');
  });

  it('accepts a lower-case key and lower-case hex', () => {
    assert.equal(parseZoneDescription('zonedisplay=#472a24').colour, '#472A24');
  });

  it('expands three-digit hex', () => {
    // `#f00` is a reasonable thing to type by hand.
    assert.equal(parseZoneDescription('ZoneDisplay=#f00').colour, '#FF0000');
  });

  it('ignores a value that is not a hex colour', () => {
    const parsed = parseZoneDescription('ZoneDisplay=rot');

    assert.equal(parsed.colour, null);
    assert.equal(parsed.text, 'ZoneDisplay=rot', 'left alone rather than half-eaten');
  });

  it('does not mistake a longer word ending in the key', () => {
    assert.equal(parseZoneDescription('MyZoneDisplay=#472A24').colour, null);
  });
});

describe('formatZoneDescription', () => {
  it('appends the token after the author text', () => {
    assert.equal(
      formatZoneDescription('Auslösezone Ostflügel', '#472A24'),
      'Auslösezone Ostflügel ZoneDisplay=#472A24',
    );
  });

  it('writes only the token when there is no text', () => {
    assert.equal(formatZoneDescription('', '#472A24'), 'ZoneDisplay=#472A24');
    assert.equal(formatZoneDescription(null, '#472A24'), 'ZoneDisplay=#472A24');
  });

  it('replaces an existing token instead of adding a second', () => {
    // The case a naive append breaks on every recolour.
    assert.equal(
      formatZoneDescription('Text ZoneDisplay=#111111', '#472A24'),
      'Text ZoneDisplay=#472A24',
    );
  });

  it('moves a hand-placed token to the end', () => {
    assert.equal(
      formatZoneDescription('ZoneDisplay=#111111 Text', '#472A24'),
      'Text ZoneDisplay=#472A24',
    );
  });

  it('removes the colour and keeps the text', () => {
    assert.equal(formatZoneDescription('Text ZoneDisplay=#472A24', null), 'Text');
  });

  it('normalises the written colour', () => {
    assert.equal(formatZoneDescription('', '#f00'), 'ZoneDisplay=#FF0000');
    assert.equal(formatZoneDescription('', '472a24'), 'ZoneDisplay=#472A24');
  });

  it('round-trips', () => {
    const written = formatZoneDescription('Auslösezone A', '#472A24');
    const parsed = parseZoneDescription(written);

    assert.equal(parsed.text, 'Auslösezone A');
    assert.equal(parsed.colour, '#472A24');
  });

  it('is idempotent', () => {
    const once = formatZoneDescription('Text', '#472A24');
    assert.equal(formatZoneDescription(once, '#472A24'), once);
  });
});

describe('zoneColourOf', () => {
  it('is the short way to the colour', () => {
    assert.equal(zoneColourOf('Text ZoneDisplay=#472A24'), '#472A24');
    assert.equal(zoneColourOf('Text'), null);
  });
});
