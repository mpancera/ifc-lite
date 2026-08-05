/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifySpace } from './spaceKind.js';

describe('classifySpace', () => {
  it('reads the gross-area volume as its own kind', () => {
    // The storey-sized slab that hid behind the plain "Spaces" toggle.
    assert.equal(classifySpace('GFA'), 'storeySpace');
  });

  it('reads parking as its own kind', () => {
    assert.equal(classifySpace('PARKING'), 'parking');
  });

  it('treats .SPACE. as a room', () => {
    assert.equal(classifySpace('SPACE'), 'room');
  });

  it('treats INTERNAL as a room — which is what our own builder writes', () => {
    // Matching only `.SPACE.` would leave almost every real room ungrouped.
    assert.equal(classifySpace('INTERNAL'), 'room');
  });

  it('treats the remaining enum values as rooms', () => {
    for (const value of ['EXTERNAL', 'BERTH', 'USERDEFINED', 'NOTDEFINED']) {
      assert.equal(classifySpace(value), 'room', value);
    }
  });

  it('treats a missing PredefinedType as a room', () => {
    // Absent is the common case in files that predate the enum being used.
    assert.equal(classifySpace(undefined), 'room');
    assert.equal(classifySpace(null), 'room');
    assert.equal(classifySpace(''), 'room');
  });

  it('accepts the STEP form with dots', () => {
    // The columnar table hands it over bare, a re-parse hands it over dotted.
    assert.equal(classifySpace('.GFA.'), 'storeySpace');
    assert.equal(classifySpace('.PARKING.'), 'parking');
  });

  it('accepts lower case and stray whitespace', () => {
    assert.equal(classifySpace(' gfa '), 'storeySpace');
    assert.equal(classifySpace('parking'), 'parking');
  });

  it('does not mistake a value that merely contains GFA', () => {
    assert.equal(classifySpace('GFAREA'), 'room');
  });
});
