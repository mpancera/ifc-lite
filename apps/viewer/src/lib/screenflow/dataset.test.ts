/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FILES, looksLikeSpaFallback } from './dataset';

describe('looksLikeSpaFallback', () => {
  it('recognises the dev server answering a missing file with the app shell', () => {
    const html = new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    assert.equal(looksLikeSpaFallback(html), true);
  });

  it('accepts a real model response, whatever type the server labels it', () => {
    for (const type of ['application/x-step', 'application/octet-stream', 'model/step']) {
      assert.equal(looksLikeSpaFallback(new Response('ISO-10303-21;', { headers: { 'content-type': type } })), false, type);
    }
  });

  it('treats a response with no content type as a real one, not as the shell', () => {
    assert.equal(looksLikeSpaFallback(new Response('x')), false);
  });
});

describe('DEMO_FILES', () => {
  it('names no client and lives only under the git-ignored folder', () => {
    for (const [id, entry] of Object.entries(DEMO_FILES)) {
      assert.ok(entry.path.startsWith('/demo-local/'), `${id}: outside demo-local`);
      assert.ok(entry.path.endsWith(entry.name), `${id}: path and name disagree`);
      // Generic is the point, not the extension: a drawing belongs here too,
      // and the name is what the viewer puts on screen.
      assert.match(entry.name, /^demo-[a-z-]+\.(ifc|dxf)$/, `${id}: file name must stay generic`);
    }
  });
});
