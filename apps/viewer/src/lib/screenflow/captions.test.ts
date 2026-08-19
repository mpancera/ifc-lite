/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyCaptionOverrides, parseCaptionOverrides } from './captions';
import type { ScreenflowClip } from './types';

const clip: ScreenflowClip = {
  id: 'clip-01-federation',
  number: 1,
  titleDe: 'Zwei Modelle',
  titleEn: 'Two models',
  messageDe: 'Botschaft',
  messageEn: 'Message',
  version: 1,
  beats: [
    { id: 'title', captionDe: 'Ein Bestandsgebaeude.', captionEn: 'An existing building.' },
    { id: 'load', captionDe: 'Wird geoeffnet.', captionEn: 'It opens.' },
  ],
};

describe('parseCaptionOverrides', () => {
  it('keeps the well-formed entries and drops only the broken ones', () => {
    const out = parseCaptionOverrides({
      'clip-01-federation': {
        title: { de: 'Neu' },
        load: { de: 42 },          // wrong type: dropped
        other: 'nope',             // not an object: dropped
      },
      'clip-02': 'nope',           // not an object: dropped
    });
    assert.deepEqual(out, { 'clip-01-federation': { title: { de: 'Neu' } } });
  });

  it('returns nothing for a file that is not an object at all', () => {
    assert.deepEqual(parseCaptionOverrides(null), {});
    assert.deepEqual(parseCaptionOverrides('[]'), {});
  });

  it('drops a clip whose every entry was broken, rather than keeping an empty one', () => {
    assert.deepEqual(parseCaptionOverrides({ 'clip-01-federation': { title: 7 } }), {});
  });
});

describe('applyCaptionOverrides', () => {
  it('replaces only the language that was given', () => {
    const out = applyCaptionOverrides(clip, { 'clip-01-federation': { title: { de: 'Museum X, Ort' } } });
    assert.equal(out.beats[0].captionDe, 'Museum X, Ort');
    assert.equal(out.beats[0].captionEn, 'An existing building.', 'the untouched language survives');
  });

  it('leaves beats nobody overrode exactly as they were', () => {
    const out = applyCaptionOverrides(clip, { 'clip-01-federation': { title: { de: 'Neu' } } });
    assert.equal(out.beats[1], clip.beats[1]);
  });

  it('returns the same object when nothing applies, so nothing re-renders', () => {
    assert.equal(applyCaptionOverrides(clip, {}), clip);
    assert.equal(applyCaptionOverrides(clip, { 'clip-99': { x: { de: 'a' } } }), clip);
    assert.equal(applyCaptionOverrides(clip, { 'clip-01-federation': { unknown: { de: 'a' } } }), clip);
  });

  it('never mutates the registered clip', () => {
    applyCaptionOverrides(clip, { 'clip-01-federation': { title: { de: 'Neu' } } });
    assert.equal(clip.beats[0].captionDe, 'Ein Bestandsgebaeude.');
  });
});
