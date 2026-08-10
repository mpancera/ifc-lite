/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planStoreys, defaultPlanStorey, planCut, type PlanStorey } from './planCut.js';
import type { StoreyFloorMesh } from '@ifc-lite/drawing-2d';

/** A mesh occupying world-Y [minY, maxY]; only the Y values matter here. */
function meshY(expressId: number, minY: number, maxY: number): StoreyFloorMesh {
  return { expressId, positions: new Float32Array([0, minY, 0, 1, maxY, 0, 1, minY, 1]) };
}

/**
 * A three-storey building whose mesh floors sit at -3 / 0 / 2.7, and whose
 * `Elevation` attributes deliberately DISAGREE with them by a constant 1000 m
 * — the georeferenced case, where the attribute omits the site placement.
 */
function building() {
  return {
    meshes: [
      meshY(1, -3.0, -0.2), // basement
      meshY(2, 0.0, 2.6),   // ground
      meshY(3, 2.7, 5.0),   // upper
    ],
    hierarchy: {
      names: new Map([[50, 'UG'], [100, 'EG'], [200, 'OG']]),
      elevations: new Map([[50, 997.0], [100, 1000.0], [200, 1002.7]]),
      elementToStorey: new Map([[1, 50], [2, 100], [3, 200]]),
    },
  };
}

describe('planStoreys', () => {
  it('orders by the mesh floor and keeps the attribute elevation only as a label', () => {
    const { meshes, hierarchy } = building();
    const storeys = planStoreys(meshes, hierarchy);

    assert.deepEqual(storeys.map((s) => s.name), ['UG', 'EG', 'OG']);
    // The floors the cut is measured from are the RENDER-frame ones...
    assert.ok(Math.abs(storeys[0].floorLevel - -3.0) < 1e-5);
    assert.ok(Math.abs(storeys[1].floorLevel - 0.0) < 1e-5);
    assert.ok(Math.abs(storeys[2].floorLevel - 2.7) < 1e-5);
    // ...not the attribute, which is 1000 m away and would cut past the roof.
    assert.equal(storeys[1].elevation, 1000.0);
  });

  it('drops a storey with no geometry rather than offering an empty plan', () => {
    const storeys = planStoreys(
      [meshY(1, 0.0, 2.6)],
      {
        names: new Map([[100, 'EG'], [900, 'Datum']]),
        elevations: new Map([[100, 0], [900, -3]]),
        elementToStorey: new Map([[1, 100]]),
      },
    );
    assert.deepEqual(storeys.map((s) => s.name), ['EG']);
  });

  it('names a storey the model left unnamed, so the picker never shows a blank row', () => {
    const storeys = planStoreys(
      [meshY(1, 0, 2.6)],
      { names: new Map(), elevations: new Map(), elementToStorey: new Map([[1, 100]]) },
    );
    assert.equal(storeys[0].name, '#100');
    assert.equal(storeys[0].elevation, null);
  });
});

describe('defaultPlanStorey', () => {
  it('opens at the lowest storey that has geometry', () => {
    const { meshes, hierarchy } = building();
    assert.equal(defaultPlanStorey(planStoreys(meshes, hierarchy))?.name, 'UG');
  });

  it('has no answer for a model with no storeyed geometry', () => {
    assert.equal(defaultPlanStorey([]), null);
  });
});

describe('planCut', () => {
  // The formula `useDrawingGeneration` applies to `sectionPlane.position`.
  // Asserting against a restatement of it here is the point: if either side
  // changes, the plan cuts somewhere other than where it says it does.
  const toWorld = (percent: number, min: number, max: number) =>
    min + (percent / 100) * (max - min);

  it('round-trips through the percentage the drawing pipeline consumes', () => {
    const cut = planCut(2.7, 1.25, -3.0, 6.0);
    assert.ok(cut.ok);
    assert.ok(Math.abs(cut.worldY - 3.95) < 1e-9);
    assert.ok(Math.abs(toWorld(cut.percent, -3.0, 6.0) - cut.worldY) < 1e-9);
  });

  it('measures from the storey floor, not from zero', () => {
    // Same 1.25 m on two storeys must land 2.7 m apart, not at the same height.
    const lower = planCut(0.0, 1.25, -3.0, 6.0);
    const upper = planCut(2.7, 1.25, -3.0, 6.0);
    assert.ok(lower.ok && upper.ok);
    assert.ok(Math.abs((upper.worldY - lower.worldY) - 2.7) < 1e-9);
  });

  it('reports a cut above the model instead of clamping it onto the roof', () => {
    // Top storey at 2.7 with a 1.0 m parapet: a 1.25 m cut has nothing to cut.
    const cut = planCut(2.7, 1.25, -3.0, 3.7);
    assert.equal(cut.ok, false);
    assert.equal(cut.ok === false && cut.reason, 'above-model');
  });

  it('reports a cut below the model when the height is driven negative', () => {
    const cut = planCut(0.0, -5.0, -3.0, 6.0);
    assert.equal(cut.ok, false);
    assert.equal(cut.ok === false && cut.reason, 'below-model');
  });

  it('refuses a degenerate extent rather than dividing by zero', () => {
    const cut = planCut(0, 1.25, 4.0, 4.0);
    assert.equal(cut.ok, false);
    assert.equal(cut.ok === false && cut.reason, 'no-extent');
  });

  it('accepts a cut exactly on the model top (a slab-topped storey)', () => {
    const cut = planCut(2.75, 1.25, 0, 4.0);
    assert.ok(cut.ok);
    assert.ok(Math.abs(cut.percent - 100) < 1e-9);
  });
});

describe('the picker contract', () => {
  it('every offered storey has a floor the cut can be measured from', () => {
    const { meshes, hierarchy } = building();
    for (const s of planStoreys(meshes, hierarchy) as PlanStorey[]) {
      assert.ok(Number.isFinite(s.floorLevel));
    }
  });
});
