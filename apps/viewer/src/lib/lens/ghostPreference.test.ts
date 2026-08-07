/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GHOST_COLOR, hexToRgba } from '@ifc-lite/lens';
import { applyGhostPreference } from './ghostPreference.js';

const red = hexToRgba('#E53935', 1);
const blue = hexToRgba('#1E88E5', 1);

/** Two coloured elements, three unmatched, one hidden by a rule. */
function result() {
  return {
    colorMap: new Map([[1, red], [2, blue], [3, GHOST_COLOR], [4, GHOST_COLOR], [5, GHOST_COLOR]]),
    hiddenIds: new Set([9]),
  };
}

describe('applyGhostPreference · ghosting on', () => {
  it('hands everything through, ghosts included', () => {
    const { colorMap, hiddenIds } = applyGhostPreference(result().colorMap, result().hiddenIds, true);

    assert.equal(colorMap.size, 5);
    assert.deepEqual([...hiddenIds], [9]);
  });

  it('copies rather than aliasing, so the caller cannot mutate the result', () => {
    const source = result();
    const { colorMap, hiddenIds } = applyGhostPreference(source.colorMap, source.hiddenIds, true);
    colorMap.delete(1);
    hiddenIds.add(99);

    assert.equal(source.colorMap.size, 5);
    assert.deepEqual([...source.hiddenIds], [9]);
  });
});

describe('applyGhostPreference · ghosting off', () => {
  it('hides the unmatched instead of painting them', () => {
    const { colorMap, hiddenIds } = applyGhostPreference(result().colorMap, result().hiddenIds, false);

    assert.deepEqual([...colorMap.keys()], [1, 2]);
    assert.deepEqual([...hiddenIds].sort((a, b) => a - b), [3, 4, 5, 9]);
  });

  it('keeps the colours of the matched elements exactly', () => {
    const { colorMap } = applyGhostPreference(result().colorMap, result().hiddenIds, false);

    assert.deepEqual(colorMap.get(1), red);
    assert.deepEqual(colorMap.get(2), blue);
  });

  it('keeps ids a rule already hid', () => {
    // A rule that hides something means it, whatever the presentation.
    const { hiddenIds } = applyGhostPreference(result().colorMap, result().hiddenIds, false);

    assert.equal(hiddenIds.has(9), true);
  });

  it('leaves a lens that ghosts nothing untouched', () => {
    const colours = new Map([[1, red], [2, blue]]);
    const { colorMap, hiddenIds } = applyGhostPreference(colours, new Set(), false);

    assert.equal(colorMap.size, 2);
    assert.equal(hiddenIds.size, 0);
  });

  it('empties the colour map when nothing matched at all', () => {
    // Everything ghosted: hiding it all is the honest rendering of "no match".
    const colours = new Map([[1, GHOST_COLOR], [2, GHOST_COLOR]]);
    const { colorMap, hiddenIds } = applyGhostPreference(colours, new Set(), false);

    assert.equal(colorMap.size, 0);
    assert.deepEqual([...hiddenIds].sort((a, b) => a - b), [1, 2]);
  });

  it('handles an empty result', () => {
    const { colorMap, hiddenIds } = applyGhostPreference(new Map(), new Set(), false);

    assert.equal(colorMap.size, 0);
    assert.equal(hiddenIds.size, 0);
  });
});
