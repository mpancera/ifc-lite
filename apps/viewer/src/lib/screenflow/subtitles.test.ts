/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubtitles, cuesFromTimeline, subtitleFilename } from './subtitles';
import type { BeatTimeline, ScreenflowClip } from './types';

const clip: ScreenflowClip = {
  id: 'clip-01-federation',
  number: 1,
  titleDe: 'Grundriss statt Prüfliste',
  titleEn: 'A plan, not a checklist',
  messageDe: 'x',
  messageEn: 'x',
  version: 1,
  beats: [],
};

const timeline: BeatTimeline[] = [
  { beatId: 'title', captionDe: 'Ein Bestandsgebäude.', captionEn: 'An existing building.', startMs: 0, endMs: 3200, timedOut: false },
  { beatId: 'load', captionDe: 'Wird geöffnet.', captionEn: 'It opens.', startMs: 3200, endMs: 9100, timedOut: false },
];

describe('subtitleFilename', () => {
  it('numbers the clip and transliterates the umlaut instead of dropping it', () => {
    assert.equal(subtitleFilename(clip, 'de'), 'clip-01-grundriss-statt-pruefliste.de.srt');
    assert.equal(subtitleFilename(clip, 'en'), 'clip-01-grundriss-statt-pruefliste.en.srt');
  });

  it('pads the clip number so nine files sort in series order', () => {
    assert.ok(subtitleFilename({ ...clip, number: 9 }, 'de').startsWith('clip-09-'));
  });
});

describe('cuesFromTimeline', () => {
  it('takes the requested language and the MEASURED times', () => {
    const de = cuesFromTimeline(timeline, 'de');
    const en = cuesFromTimeline(timeline, 'en');
    assert.equal(de[1].text, 'Wird geöffnet.');
    assert.equal(en[1].text, 'It opens.');
    assert.equal(de[1].startMs, 3200);
    assert.equal(de[1].endMs, 9100);
  });
});

describe('buildSubtitles', () => {
  it('writes one cue per beat, in order, in the requested language', () => {
    const srt = buildSubtitles(timeline, 'en', { gapMs: 0 });
    assert.ok(srt.startsWith('1\n00:00:00,000 --> 00:00:03,200\nAn existing building.'), srt);
    assert.ok(srt.includes('2\n00:00:03,200 --> 00:00:09,100\nIt opens.'), srt);
  });

  it('produces nothing at all from an empty run, so no empty file is offered', () => {
    assert.equal(buildSubtitles([], 'de'), '');
  });
});
