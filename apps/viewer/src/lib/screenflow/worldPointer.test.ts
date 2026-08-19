/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ifcStoreyLocalToRenderer, midpoint } from './worldPointer';
import { rendererPointToIfcStoreyLocal } from '@/components/viewer/selectionHandlers';

describe('ifcStoreyLocalToRenderer', () => {
  it('swaps the up axis: IFC Y becomes renderer -Z', () => {
    assert.deepEqual(ifcStoreyLocalToRenderer([3, 4, 0], 0), { x: 3, y: 0, z: -4 });
  });

  it('measures the point Z up from the storey floor', () => {
    assert.deepEqual(ifcStoreyLocalToRenderer([0, 0, 2.4], 4.42), { x: 0, y: 6.82, z: -0 });
  });

  it('is the exact inverse of the conversion the click handler uses', () => {
    // The pointer has to land where the element lands. If these two ever
    // disagree, every clip points a few metres off and nothing fails.
    for (const point of [[1, 2, 0], [-7.5, 13.25, 0], [0, 0, 0]] as const) {
      const round = rendererPointToIfcStoreyLocal(ifcStoreyLocalToRenderer(point, 4.42));
      assert.deepEqual(round, [point[0], point[1], 0]);
    }
  });
});

describe('midpoint', () => {
  it('is where a clip points at a wall it just drew', () => {
    assert.deepEqual(midpoint([0, 0, 0], [4, 6, 0]), [2, 3, 0]);
  });

  it('handles negative coordinates without drifting to the origin', () => {
    assert.deepEqual(midpoint([-10, -4, 1], [-2, 4, 3]), [-6, 0, 2]);
  });
});
