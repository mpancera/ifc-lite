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
  it('keeps the georeferenced placement the attribute omits', () => {
    // Elevations are 1000 m away from the geometry. Using them raw would cut
    // past the roof; the offset brings them back into the render frame.
    const { meshes, hierarchy } = building();
    const storeys = planStoreys(meshes, hierarchy);

    assert.deepEqual(storeys.map((s) => s.name), ['UG', 'EG', 'OG']);
    assert.ok(Math.abs(storeys[0].floorLevel - -3.0) < 1e-5);
    assert.ok(Math.abs(storeys[1].floorLevel - 0.0) < 1e-5);
    assert.ok(Math.abs(storeys[2].floorLevel - 2.7) < 1e-5);
    // The attribute is still reported, for the picker label.
    assert.equal(storeys[1].elevation, 1000.0);
  });

  it('a stair hanging into the floor below does not drop that storey\'s plan', () => {
    // The real regression. Measured on a five-storey model: four storeys sat
    // 0.28-0.34 m below their stated elevation (slab underside), one sat 0.84 m
    // below because an element assigned to it descends. Per-storey minima put
    // that plan half a metre low; the median rejects the outlier.
    const meshes = [
      meshY(1, -2.73, -0.4),  // U01, stated -2.43 → offset -0.30
      meshY(2, -0.84, 3.2),   // E00, stated  0.00 → offset -0.84  ← the stair
      meshY(3, 3.18, 5.9),    // O01, stated  3.50 → offset -0.32
      meshY(4, 5.98, 8.6),    // O02, stated  6.26 → offset -0.28
      meshY(5, 8.62, 11.0),   // O03, stated  8.96 → offset -0.34
    ];
    const hierarchy = {
      names: new Map([[1, 'U01'], [2, 'E00'], [3, 'O01'], [4, 'O02'], [5, 'O03']]),
      elevations: new Map([[1, -2.43], [2, 0], [3, 3.5], [4, 6.26], [5, 8.96]]),
      elementToStorey: new Map([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]),
    };
    const storeys = planStoreys(meshes, hierarchy);
    const e00 = storeys.find((s) => s.name === 'E00');

    // Median offset is -0.32, so E00's floor is -0.32 — not the -0.84 its own
    // meshes claim, and not the bare 0.00 the attribute claims.
    // Float32Array round-trips the mesh literals, hence the tolerance.
    assert.ok(e00 !== undefined);
    assert.ok(Math.abs(e00.floorLevel - -0.32) < 1e-5, `got ${e00.floorLevel}`);
    // And the storey spacing is exactly what the author drew.
    const o01 = storeys.find((s) => s.name === 'O01')!;
    assert.ok(Math.abs((o01.floorLevel - e00.floorLevel) - 3.5) < 1e-5);
  });

  it('falls back to the mesh floor when the model states no elevations', () => {
    const storeys = planStoreys(
      [meshY(1, 0.0, 2.6), meshY(2, 2.7, 5.0)],
      { names: new Map(), elevations: new Map(), elementToStorey: new Map([[1, 100], [2, 200]]) },
    );
    assert.ok(Math.abs(storeys[0].floorLevel - 0.0) < 1e-5);
    assert.ok(Math.abs(storeys[1].floorLevel - 2.7) < 1e-5);
  });

  it('falls back to the mesh floor for a single storey, where a median proves nothing', () => {
    // One storey cannot tell a datum shift from a descending element.
    const storeys = planStoreys(
      [meshY(1, -0.25, 2.6)],
      { names: new Map([[100, 'EG']]), elevations: new Map([[100, 0]]), elementToStorey: new Map([[1, 100]]) },
    );
    assert.ok(Math.abs(storeys[0].floorLevel - -0.25) < 1e-5);
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
