/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The four outcomes of saving a sidecar, and how each one reads.
 *
 * The message matters as much as the write here. The failure mode being
 * designed against is a silent fall back to the download folder: somebody
 * clicks export, sees a cheerful confirmation, and the file the other
 * application waits for never arrives.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeSidecarSave, type SidecarSaveResult } from './saveSidecar.js';

const NAME = 'dc.heights.json';

describe('describeSidecarSave', () => {
  it('names the folder a file landed in', () => {
    const msg = describeSidecarSave(NAME, { to: 'folder', folder: 'Neubau', replaced: false, writtenAs: 'dc/heights.json' });

    assert.match(msg, /Neubau/);
    assert.match(msg, /geschrieben/);
  });

  it('distinguishes replacing from writing', () => {
    // A person who did not expect to overwrite anything should be able to see
    // that something was already there.
    const written = describeSidecarSave(NAME, { to: 'folder', folder: 'A', replaced: false, writtenAs: 'dc/heights.json' });
    const replaced = describeSidecarSave(NAME, { to: 'folder', folder: 'A', replaced: true, writtenAs: 'dc/heights.json' });

    assert.notEqual(written, replaced);
    assert.match(replaced, /ersetzt/);
  });

  it('says WHY a file was downloaded instead', () => {
    // Not merely that it was. "No folder bound" is a setup step; "no write
    // access" is a permission the browser refused — different fixes.
    const noFolder = describeSidecarSave(NAME, { to: 'download', reason: 'no-folder' });
    const noPermission = describeSidecarSave(NAME, { to: 'download', reason: 'no-permission' });

    assert.notEqual(noFolder, noPermission);
    assert.match(noFolder, /kein Projektordner/);
    assert.match(noPermission, /Schreibzugriff/);
  });

  it('never reports a download as a plain success', () => {
    // The whole point: a download when a folder was expected is a partial
    // outcome, and a message that hides it is worse than no message.
    for (const reason of ['no-folder', 'no-permission'] as const) {
      const msg = describeSidecarSave(NAME, { to: 'download', reason });
      assert.match(msg, /heruntergeladen/, reason);
      assert.match(msg, /—/, `${reason} carries a reason`);
    }
  });

  it('always names the file', () => {
    const all: SidecarSaveResult[] = [
      { to: 'folder', folder: 'A', replaced: true, writtenAs: 'dc/heights.json' },
      { to: 'folder', folder: 'A', replaced: false, writtenAs: 'dc/heights.json' },
      { to: 'download', reason: 'no-folder' },
      { to: 'download', reason: 'no-permission' },
    ];

    for (const result of all) {
      assert.match(describeSidecarSave(NAME, result), /heights\.json/);
    }
  });

  it('prefers the label a person gave the folder', () => {
    // The label is the stand-in for the path; if somebody bothered to set one,
    // that is the name they recognise.
    assert.match(
      describeSidecarSave(NAME, { to: 'folder', folder: 'Neubau Ost', replaced: false, writtenAs: 'dc/heights.json' }),
      /Neubau Ost/,
    );
  });
});
