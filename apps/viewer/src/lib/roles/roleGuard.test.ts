/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDITOR_ROLE_ID, VIEWER_ROLE_ID } from './disciplineRoles.js';
import { mayCreateEntities, mayEditEntity } from './roleGuard.js';

test('Editor may change the reference model', () => {
  // Correcting the reference model is sometimes the job — unmaintained room
  // numbers, a wrong classification — and Editor is the mode for it.
  const result = mayEditEntity({ activeSystemId: EDITOR_ROLE_ID, isAuthored: false });
  assert.equal(result.allowed, true);
});

test('Viewer may not change the reference model', () => {
  const result = mayEditEntity({ activeSystemId: VIEWER_ROLE_ID, isAuthored: false });
  assert.equal(result.allowed, false);
});

test('Viewer may not change even something authored in this session', () => {
  // Read-only that makes an exception for authored entities stops being
  // read-only the moment a snapshot restores an earlier session's work.
  const result = mayEditEntity({ activeSystemId: VIEWER_ROLE_ID, isAuthored: true });
  assert.equal(result.allowed, false);
});

test('Viewer may not create anything', () => {
  assert.equal(mayCreateEntities(VIEWER_ROLE_ID).allowed, false);
});

test('Editor and every discipline role may create', () => {
  // Adding is precisely what a discipline role is for, so creation is gated
  // only on Viewer.
  assert.equal(mayCreateEntities(EDITOR_ROLE_ID).allowed, true);
  assert.equal(mayCreateEntities('fire.detection').allowed, true);
});

test("Viewer's refusal names both ways out", () => {
  const result = mayCreateEntities(VIEWER_ROLE_ID);
  assert.equal(result.allowed, false);
  if (result.allowed) return;
  assert.match(result.reason, /Fachrolle/);
  assert.match(result.reason, /Editor/);
});

test('a discipline role may change what it authored', () => {
  const result = mayEditEntity({ activeSystemId: 'fire.detection', isAuthored: true });
  assert.equal(result.allowed, true);
});

test('a discipline role may not change the reference model', () => {
  const result = mayEditEntity({ activeSystemId: 'fire.detection', isAuthored: false });
  assert.equal(result.allowed, false);
});

test('the refusal names the role and how to proceed', () => {
  // A refusal that does not say what to do instead reads as a bug.
  const result = mayEditEntity({
    activeSystemId: 'fire.detection', isAuthored: false, roleLabel: 'Fire · Branddetektion',
  });
  assert.equal(result.allowed, false);
  if (result.allowed) return;
  assert.match(result.reason, /Fire · Branddetektion/);
  assert.match(result.reason, /Editor/);
});

test('the refusal still reads sensibly without a role label', () => {
  const result = mayEditEntity({ activeSystemId: 'fire.detection', isAuthored: false });
  assert.equal(result.allowed, false);
  if (result.allowed) return;
  assert.ok(result.reason.length > 0);
  assert.ok(!result.reason.includes('undefined'));
});
