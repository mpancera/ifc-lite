/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chapterAt, chaptersOf } from './chapters';
import { SCREENFLOW_REGISTRY } from './registry';
import type { ScreenflowBeat, ScreenflowClip } from './types';

function beat(id: string, frame?: 'card'): ScreenflowBeat {
  return { id, captionDe: `DE ${id}`, captionEn: `EN ${id}`, ...(frame ? { frame } : {}) };
}

function clip(beats: ScreenflowBeat[]): ScreenflowClip {
  return {
    id: 'c', number: 1, titleDe: 'Titel', titleEn: 'Title',
    messageDe: 'm', messageEn: 'm', version: 1, beats,
  };
}

describe('chaptersOf', () => {
  it('takes the card beats as the section breaks', () => {
    const chapters = chaptersOf(clip([beat('title', 'card'), beat('work'), beat('close', 'card')]));
    assert.deepEqual(chapters.map((c) => c.beatIndex), [0, 2]);
    assert.equal(chapters[0].titleDe, 'DE title');
  });

  it('always offers a way back to the start', () => {
    // A clip whose first card is in the middle still needs a "from the top".
    const chapters = chaptersOf(clip([beat('work'), beat('break', 'card')]));
    assert.deepEqual(chapters.map((c) => c.beatIndex), [0, 1]);
    assert.equal(chapters[0].titleDe, 'Titel', 'the clip title stands in for the missing card');
  });

  it('gives a clip with no cards a single chapter at the beginning', () => {
    assert.deepEqual(chaptersOf(clip([beat('a'), beat('b')])), [{ beatIndex: 0, titleDe: 'Titel' }]);
  });
});

describe('chapterAt', () => {
  const chapters = [
    { beatIndex: 0, titleDe: 'Anfang' },
    { beatIndex: 5, titleDe: 'Mitte' },
    { beatIndex: 9, titleDe: 'Schluss' },
  ];

  it('answers with the chapter a beat sits inside, not the next one', () => {
    assert.equal(chapterAt(chapters, 0)?.titleDe, 'Anfang');
    assert.equal(chapterAt(chapters, 4)?.titleDe, 'Anfang');
    assert.equal(chapterAt(chapters, 5)?.titleDe, 'Mitte');
    assert.equal(chapterAt(chapters, 12)?.titleDe, 'Schluss');
  });

  it('has no answer before the first chapter, rather than guessing one', () => {
    assert.equal(chapterAt([{ beatIndex: 3, titleDe: 'spaet' }], 1), null);
  });
});

describe('the built clips', () => {
  it('all offer somewhere to jump to', () => {
    // A strand a presenter cannot enter in the middle has to be played from
    // the top every time, which is what chapter marks exist to avoid.
    for (const built of SCREENFLOW_REGISTRY) {
      assert.ok(chaptersOf(built).length >= 2, `${built.id}: only one chapter`);
    }
  });
});
