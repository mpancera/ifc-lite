/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_START_DELAY_MS, parseLaunchRequest } from './useScreenflowLauncher';

describe('parseLaunchRequest', () => {
  it('reads the clip id and gives it the default runway', () => {
    assert.deepEqual(parseLaunchRequest('?screenflow=clip-01-federation'), {
      clipId: 'clip-01-federation',
      delayMs: DEFAULT_START_DELAY_MS,
      mode: 'record',
    });
  });

  it('takes an explicit runway, including none at all', () => {
    assert.equal(parseLaunchRequest('?screenflow=a&delay=4000')?.delayMs, 4000);
    assert.equal(parseLaunchRequest('?screenflow=a&delay=0')?.delayMs, 0);
  });

  it('falls back to the default rather than trusting a nonsense delay', () => {
    assert.equal(parseLaunchRequest('?screenflow=a&delay=soon')?.delayMs, DEFAULT_START_DELAY_MS);
    assert.equal(parseLaunchRequest('?screenflow=a&delay=-5')?.delayMs, DEFAULT_START_DELAY_MS);
  });

  it('records by default, because that is the mode without controls', () => {
    assert.equal(parseLaunchRequest('?screenflow=a')?.mode, 'record');
    assert.equal(parseLaunchRequest('?screenflow=a&present=0')?.mode, 'record');
  });

  it('presents on either spelling', () => {
    assert.equal(parseLaunchRequest('?screenflow=a&present')?.mode, 'present');
    assert.equal(parseLaunchRequest('?screenflow=a&present=1')?.mode, 'present');
    assert.equal(parseLaunchRequest('?screenflow=a&mode=present')?.mode, 'present');
  });

  it('gives presenting no runway, and recording one', () => {
    // The delay exists so a recorder operator can clear the frame; a presenter
    // pressed Enter and is watching.
    assert.equal(parseLaunchRequest('?screenflow=a&present')?.delayMs, 0);
    assert.equal(parseLaunchRequest('?screenflow=a')?.delayMs, DEFAULT_START_DELAY_MS);
    assert.equal(parseLaunchRequest('?screenflow=a&present&delay=3000')?.delayMs, 3000);
  });

  it('asks for nothing when the parameter is absent or empty', () => {
    assert.equal(parseLaunchRequest(''), null);
    assert.equal(parseLaunchRequest('?other=1'), null);
    assert.equal(parseLaunchRequest('?screenflow='), null);
  });
});
