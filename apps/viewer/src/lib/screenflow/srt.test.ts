/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSrtTimestamp, toSrt, type CaptionCue } from './srt';

describe('formatSrtTimestamp', () => {
  it('writes hours, minutes, seconds and a COMMA before the milliseconds', () => {
    assert.equal(formatSrtTimestamp(0), '00:00:00,000');
    assert.equal(formatSrtTimestamp(67_480), '00:01:07,480');
    assert.equal(formatSrtTimestamp(3_661_005), '01:01:01,005');
  });

  it('clamps a negative time instead of writing a broken stamp', () => {
    assert.equal(formatSrtTimestamp(-500), '00:00:00,000');
  });
});

describe('toSrt', () => {
  const cues: CaptionCue[] = [
    { startMs: 0, endMs: 4000, text: 'Zwei Modelle, eine Struktur.' },
    { startMs: 4000, endMs: 9000, text: 'Das Brandmeldemodell kommt dazu.' },
  ];

  it('numbers cues from one and holds a gap so two never share a frame', () => {
    const out = toSrt(cues, { gapMs: 80 });
    const lines = out.split('\n');
    assert.equal(lines[0], '1');
    assert.equal(lines[1], '00:00:00,000 --> 00:00:03,920');
    assert.equal(lines[2], 'Zwei Modelle, eine Struktur.');
    assert.equal(lines[4], '2');
    assert.equal(lines[5], '00:00:04,000 --> 00:00:08,920');
  });

  it('shifts every cue by the recorder offset', () => {
    const out = toSrt([cues[0]], { offsetMs: 2500, gapMs: 0 });
    assert.ok(out.includes('00:00:02,500 --> 00:00:06,500'), out);
  });

  it('drops empty and zero-length cues and renumbers what is left', () => {
    const out = toSrt([
      { startMs: 0, endMs: 1000, text: '   ' },
      { startMs: 1000, endMs: 1000, text: 'nie sichtbar' },
      { startMs: 2000, endMs: 5000, text: 'die einzige Zeile' },
    ]);
    assert.equal(out.split('\n')[0], '1');
    assert.ok(out.includes('die einzige Zeile'));
    assert.ok(!out.includes('nie sichtbar'));
  });

  it('cuts an overlapping cue at the next one rather than letting both stand', () => {
    const out = toSrt([
      { startMs: 0, endMs: 9000, text: 'zu lang stehen geblieben' },
      { startMs: 4000, endMs: 8000, text: 'die naechste' },
    ], { gapMs: 0 });
    assert.ok(out.includes('00:00:00,000 --> 00:00:04,000'), out);
  });

  it('sorts by start time, so the file order is the timeline order', () => {
    const out = toSrt([
      { startMs: 5000, endMs: 8000, text: 'zweite' },
      { startMs: 0, endMs: 4000, text: 'erste' },
    ]);
    assert.ok(out.indexOf('erste') < out.indexOf('zweite'));
  });
});
