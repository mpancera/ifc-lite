/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { snapToUnderlay } from './underlaySnap.js';
import type { DxfUnderlayState } from '@/store/slices/drawing2DSlice';

const IDENTITY = { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 };

function underlay(
  layers: { name: string; points: { x: number; y: number }[] }[],
  over: Partial<DxfUnderlayState> = {},
): DxfUnderlayState {
  return {
    id: 'u1',
    name: 'plan.dxf',
    visible: true,
    opacity: 1,
    layerVisibility: {},
    placement: IDENTITY,
    underlay: {
      name: 'plan.dxf',
      layers: layers.map((l) => ({
        name: l.name,
        color: '#000',
        visible: true,
        paths: [{ points: l.points, closed: false }],
        fills: [],
        texts: [],
      })),
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      unitScale: 1,
      skipped: {},
      warnings: [],
    },
    ...over,
  } as DxfUnderlayState;
}

describe('snapToUnderlay', () => {
  const plan = underlay([{ name: 'WALLS', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }]);

  it('catches a vertex within the tolerance', () => {
    assert.deepEqual(snapToUnderlay(plan, { x: 10.05, y: 0.05 }, 0.5), { x: 10, y: 0 });
  });

  it('lets a click well away from anything stand', () => {
    // Returning the nearest vertex regardless would drag a deliberate pick
    // metres across the plan.
    assert.equal(snapToUnderlay(plan, { x: 5, y: 5 }, 0.5), null);
  });

  it('takes the nearest of several', () => {
    const many = underlay([{ name: 'A', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] }]);

    assert.deepEqual(snapToUnderlay(many, { x: 1.1, y: 0 }, 0.5), { x: 1, y: 0 });
  });

  it('ignores a layer that was switched off', () => {
    // Something switched off is something the person decided not to work
    // with; catching it would be a snap to an invisible feature.
    const hidden = underlay(
      [{ name: 'FURNITURE', points: [{ x: 0, y: 0 }] }],
      { layerVisibility: { FURNITURE: false } },
    );

    assert.equal(snapToUnderlay(hidden, { x: 0, y: 0 }, 0.5), null);
  });

  it('snaps where the plan actually SITS, not where its raw coordinates are', () => {
    // The plan is drawn through its placement, so the vertex a person aims at
    // is the placed one. Comparing against raw coordinates would snap to a
    // spot nothing is drawn at.
    const moved = underlay(
      [{ name: 'A', points: [{ x: 0, y: 0 }] }],
      { placement: { offsetX: 100, offsetY: 50, rotationDeg: 0, scale: 1 } },
    );

    assert.equal(snapToUnderlay(moved, { x: 0, y: 0 }, 0.5), null);
    assert.deepEqual(snapToUnderlay(moved, { x: 100, y: 50 }, 0.5), { x: 100, y: 50 });
  });

  it('returns the point in drawing space, ready to be paired with a model pick', () => {
    const scaled = underlay(
      [{ name: 'A', points: [{ x: 1000, y: 0 }] }],
      { placement: { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 0.001 } },
    );

    assert.deepEqual(snapToUnderlay(scaled, { x: 1, y: 0 }, 0.1), { x: 1, y: 0 });
  });
});
