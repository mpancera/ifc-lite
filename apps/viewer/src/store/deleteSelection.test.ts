/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The summary line, which is the whole point of the command returning counts
 * instead of raising its own toast: "deleted" alone hides a refusal, and hides
 * the one case where deleting changes nothing in the file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeDeleteSelection } from './deleteSelection.js';

describe('describeDeleteSelection', () => {
  it('points at the export when there is something to export', () => {
    const line = describeDeleteSelection({ deleted: 21, refused: 0, sessionOnly: 0 });

    assert.match(line, /21 Objekte gelöscht/);
    assert.match(line, /Export Changes/);
  });

  it('says the file does not change when every one was session-only', () => {
    // The state that reads as a broken export button: nothing to export is
    // correct here, and silence about it sends somebody hunting.
    const line = describeDeleteSelection({ deleted: 3, refused: 0, sessionOnly: 3 });

    assert.match(line, /die Datei ändert sich nicht/);
    assert.doesNotMatch(line, /Export Changes/);
  });

  it('still points at the export when only SOME were session-only', () => {
    // A mixture does produce an export. Saying otherwise would send somebody
    // looking for a button that is right there.
    const line = describeDeleteSelection({ deleted: 3, refused: 0, sessionOnly: 1 });

    assert.match(line, /Export Changes/);
  });

  it('names refusals rather than swallowing them', () => {
    // A selection can span a reference model the active role does not own.
    const line = describeDeleteSelection({ deleted: 12, refused: 9, sessionOnly: 0 });

    assert.match(line, /12 Objekte gelöscht/);
    assert.match(line, /9 abgelehnt/);
  });

  it('reports a delete that removed nothing at all', () => {
    assert.match(describeDeleteSelection({ deleted: 0, refused: 1, sessionOnly: 0 }),
      /Nicht gelöscht/);
    assert.match(describeDeleteSelection({ deleted: 0, refused: 4, sessionOnly: 0 }),
      /Nichts gelöscht — für 4 Objekte/);
  });

  it('counts one as one', () => {
    assert.match(describeDeleteSelection({ deleted: 1, refused: 0, sessionOnly: 0 }),
      /^1 Objekt gelöscht/);
  });
});
