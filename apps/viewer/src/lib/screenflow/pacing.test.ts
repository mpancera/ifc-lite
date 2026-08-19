/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  beatHoldMs, isCaptionOverlong, readingTimeMs,
  CAPTION_CHARS_PER_SECOND, MAX_CAPTION_MS, MIN_CAPTION_MS,
} from './pacing';

describe('readingTimeMs', () => {
  it('grows with the caption and stays inside the legible band', () => {
    const short = readingTimeMs('Fertig.');
    const long = readingTimeMs('x'.repeat(60));
    assert.equal(short, MIN_CAPTION_MS, 'a short caption gets the floor, not a flash');
    assert.ok(long > short);
    assert.ok(long <= MAX_CAPTION_MS);
  });

  it('reads at the declared rate between the bounds', () => {
    const chars = 44; // 4.0 s at 11 cps -- clear of both bounds
    assert.equal(readingTimeMs('x'.repeat(chars)), (chars / CAPTION_CHARS_PER_SECOND) * 1000);
  });

  it('gives an empty caption the floor rather than zero', () => {
    assert.equal(readingTimeMs('   '), MIN_CAPTION_MS);
  });
});

describe('isCaptionOverlong', () => {
  it('flags a caption the beat cannot show in full, and only that', () => {
    const fits = 'x'.repeat(MAX_CAPTION_MS / 1000 * CAPTION_CHARS_PER_SECOND);
    assert.equal(isCaptionOverlong(fits), false);
    assert.equal(isCaptionOverlong(`${fits}xxxxx`), true);
  });
});

describe('beatHoldMs', () => {
  it('paces on the slower language, so the subtitle is readable too', () => {
    const de = 'Zwei Modelle, eine Struktur.';
    const en = 'Two models from two trades, and one structure that holds both of them.';
    const hold = beatHoldMs({ captionDe: de, captionEn: en });
    assert.equal(hold, readingTimeMs(en));
    assert.ok(hold > readingTimeMs(de));
  });

  it('lets an explicit hold win, including a deliberate zero', () => {
    assert.equal(beatHoldMs({ holdMs: 1500, captionDe: 'x'.repeat(80), captionEn: '' }), 1500);
    assert.equal(beatHoldMs({ holdMs: 0, captionDe: 'lang genug fuer mehr', captionEn: '' }), 0);
  });

  it('never returns a negative hold', () => {
    assert.equal(beatHoldMs({ holdMs: -400, captionDe: 'a', captionEn: 'a' }), 0);
  });
});
