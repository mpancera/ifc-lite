/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeLayoutFailure } from './layoutFailure.js';

describe('describeLayoutFailure', () => {
  it('names a blocked worker as a policy, not a bug in the model', () => {
    // What a managed laptop produces: the graph never appeared and nothing on
    // screen said why.
    const err = new DOMException('Failed to construct Worker: access denied', 'SecurityError');
    const failure = describeLayoutFailure(err);
    assert.match(failure.message, /nicht starten/);
    assert.ok(failure.hint?.includes('Inkognito'));
  });

  it('reads Chrome’s CSP wording too', () => {
    const err = new Error("Refused to create a worker from 'blob:…' because it violates the Content Security Policy");
    assert.match(describeLayoutFailure(err).message, /nicht starten/);
  });

  it('sends a missing chunk to a hard reload', () => {
    // The other half: a proxy or a stale cache serving a file the deploy
    // replaced. Same empty panel, opposite remedy.
    const err = new TypeError('Failed to fetch dynamically imported module: /assets/elk-worker.min-a1b2.js');
    const failure = describeLayoutFailure(err);
    assert.match(failure.message, /laden/);
    assert.ok(failure.hint?.includes('Strg+Shift+R'));
  });

  it('keeps an unfamiliar error’s own words instead of a generic apology', () => {
    const failure = describeLayoutFailure(new Error('elk: unsupported layout option'));
    assert.equal(failure.hint, null);
    assert.match(failure.detail, /unsupported layout option/);
  });

  it('survives something that is not an Error at all', () => {
    assert.equal(describeLayoutFailure('boom').detail, 'boom');
  });

  it('always carries the raw text, which is what a bug report needs', () => {
    const failure = describeLayoutFailure(new DOMException('nope', 'SecurityError'));
    assert.match(failure.detail, /SecurityError/);
    assert.match(failure.detail, /nope/);
  });
});
