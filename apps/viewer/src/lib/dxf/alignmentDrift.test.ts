/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Does a placed fitting line stay on the feature it marks?
 *
 * Marc reported it drifting a little further from where he put it with every
 * drag of the underlay, and twice I answered that it could not — each link in
 * the chain round-trips exactly when checked on its own. This replays the
 * whole chain instead: pick a point on the plan, move the plan, and compare
 * where the plan's own line work went with where the picked point went.
 *
 * The two paths are deliberately the REAL ones and deliberately different:
 * the plan is drawn by the render hook's world→drawing mapping, the picked
 * point by the overlay's `applyDxfPlacement`. If they disagree, that gap is
 * the bug, whatever the algebra says about either half alone.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyDxfPlacement, inverseDxfPlacement, type DxfPlacement } from '@ifc-lite/drawing-2d';
import { dxfUnderlayToDrawing } from '@/hooks/dxfUnderlayMath';
import type { DxfUnderlayState } from '@/store/slices/drawing2DSlice';

/** A shift like a georeferenced model's: big enough for an error to show. */
const SHIFT = { x: 2665486, y: 1259317 };

/** One vertex of the plan, in the underlay's stored world coordinates. */
const FEATURE = { x: 2665500, y: 1259330 };

function underlay(placement: DxfPlacement): DxfUnderlayState {
  return {
    id: 'u1',
    name: 'plan.dxf',
    visible: true,
    visible3D: false,
    opacity: 1,
    layerVisibility: {},
    placement,
    underlay: {
      name: 'plan.dxf',
      layers: [{
        name: 'WALLS',
        color: '#000',
        visible: true,
        paths: [{ points: [FEATURE, { x: FEATURE.x + 5, y: FEATURE.y }], closed: false }],
        fills: [],
        texts: [],
      }],
      bounds: { min: { x: FEATURE.x, y: FEATURE.y }, max: { x: FEATURE.x + 5, y: FEATURE.y } },
      unitScale: 1,
      skipped: {},
      warnings: [],
    },
  } as unknown as DxfUnderlayState;
}

/** Where the plan's own vertex is drawn, through the render hook. */
function drawnFeature(placement: DxfPlacement) {
  const data = dxfUnderlayToDrawing(underlay(placement), SHIFT, false);
  return data.lines[0].points[0];
}

const START: DxfPlacement = { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 };

describe('a placed fitting line', () => {
  it('is recorded where the feature is DRAWN, not where it is stored', () => {
    // The pick happens in drawing space, so undoing the placement alone leaves
    // the point in the shifted, y-flipped frame — the same frame the render
    // hook puts the plan's own geometry into before the placement. If these
    // two disagreed, the very first redraw would put the line somewhere else.
    const picked = drawnFeature(START);
    const stored = inverseDxfPlacement(picked, START);

    assert.ok(stored);
    assert.deepEqual(applyDxfPlacement(stored, START), picked);
  });

  it('travels with the plan, exactly, over one move', () => {
    const picked = drawnFeature(START);
    const stored = inverseDxfPlacement(picked, START)!;

    const moved: DxfPlacement = { ...START, offsetX: 12, offsetY: -7 };
    const featureNow = drawnFeature(moved);
    const lineNow = applyDxfPlacement(stored, moved);

    assert.ok(Math.hypot(featureNow.x - lineNow.x, featureNow.y - lineNow.y) < 1e-6,
      `feature at ${JSON.stringify(featureNow)}, line at ${JSON.stringify(lineNow)}`);
  });

  it('does not creep over many moves', () => {
    // The shape of the report: a little further each time. Twenty drags of a
    // metre would make a millimetre of per-move error plainly visible.
    const picked = drawnFeature(START);
    const stored = inverseDxfPlacement(picked, START)!;

    let placement = START;
    for (let i = 0; i < 20; i += 1) {
      placement = { ...placement, offsetX: placement.offsetX + 1, offsetY: placement.offsetY + 0.5 };
    }
    const featureNow = drawnFeature(placement);
    const lineNow = applyDxfPlacement(stored, placement);

    assert.ok(Math.hypot(featureNow.x - lineNow.x, featureNow.y - lineNow.y) < 1e-6,
      `after 20 moves: feature ${JSON.stringify(featureNow)}, line ${JSON.stringify(lineNow)}`);
  });

  it('survives a placement that also turns and scales the plan', () => {
    // What the two-point solver actually produces. A rotation about the origin
    // with coordinates in the millions is where a small algebraic slip shows
    // up as metres on the sheet.
    const turned: DxfPlacement = { offsetX: 3, offsetY: -4, rotationDeg: -9.25, scale: 1 };
    const picked = drawnFeature(turned);
    const stored = inverseDxfPlacement(picked, turned)!;

    const nudged: DxfPlacement = { ...turned, offsetX: turned.offsetX + 2.5 };
    const featureNow = drawnFeature(nudged);
    const lineNow = applyDxfPlacement(stored, nudged);

    assert.ok(Math.hypot(featureNow.x - lineNow.x, featureNow.y - lineNow.y) < 1e-6,
      `feature ${JSON.stringify(featureNow)}, line ${JSON.stringify(lineNow)}`);
  });
});
