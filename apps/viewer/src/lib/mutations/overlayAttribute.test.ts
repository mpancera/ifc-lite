/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { overlayAttribute, type AttributeOverlay } from './overlayAttribute';

function overlayOf(rows: Record<number, Array<{ name: string; value: string }>>): AttributeOverlay {
  return { getAttributeMutationsForEntity: (id) => rows[id] ?? [] };
}

describe('overlayAttribute', () => {
  it('answers with what this session wrote', () => {
    const overlay = overlayOf({ 42: [{ name: 'LongName', value: 'Durchgang Küche' }] });
    assert.equal(overlayAttribute(overlay, 42, 'LongName'), 'Durchgang Küche');
  });

  it('says nothing when the overlay holds no mutation for that attribute', () => {
    // `null`, so the caller falls back to what the file states — the reason the
    // plan label kept printing the parsed name after a rename.
    const overlay = overlayOf({ 42: [{ name: 'Name', value: '0.14' }] });
    assert.equal(overlayAttribute(overlay, 42, 'LongName'), null);
    assert.equal(overlayAttribute(overlay, 7, 'Name'), null, 'untouched entity');
    assert.equal(overlayAttribute(undefined, 42, 'Name'), null, 'no overlay at all');
  });

  it('reports a cleared value as cleared, not as absent', () => {
    // An author who empties a field said something; falling back to the parsed
    // name here would put the deleted text straight back on screen.
    const overlay = overlayOf({ 42: [{ name: 'LongName', value: '' }] });
    assert.equal(overlayAttribute(overlay, 42, 'LongName'), '');
  });

  it('reads the STEP placeholders as empty', () => {
    const overlay = overlayOf({ 42: [{ name: 'Name', value: ' $ ' }] });
    assert.equal(overlayAttribute(overlay, 42, 'Name'), '');
  });

  it('takes the last write when an attribute was edited twice', () => {
    const overlay = overlayOf({
      42: [
        { name: 'Name', value: '0.99' },
        { name: 'LongName', value: 'egal' },
        { name: 'Name', value: '0.14' },
      ],
    });
    assert.equal(overlayAttribute(overlay, 42, 'Name'), '0.14');
  });
});
