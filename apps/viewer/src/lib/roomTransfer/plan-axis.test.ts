/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '@ifc-lite/geometry';
import { dominantAxis } from './plan-axis.js';

/** A flat horizontal quad from (x0,y0) to (x1,y1) in the plan frame. */
function wall(x0: number, y0: number, x1: number, y1: number, ifcType = 'IfcWall'): MeshData {
  // Render frame: x, height, −y. A ribbon of zero width is enough — the edges
  // along its length are what carries the direction.
  const positions = new Float32Array([x0, 0, -y0, x1, 0, -y1, x1, 0, -y1]);
  return { expressId: 1, ifcType, positions, indices: new Uint32Array([0, 1, 2]) } as unknown as MeshData;
}

/** Turn a wall's endpoints by `deg` about the origin. */
function turned(deg: number, x0: number, y0: number, x1: number, y1: number): MeshData {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return wall(x0 * c - y0 * s, x0 * s + y0 * c, x1 * c - y1 * s, x1 * s + y1 * c);
}

describe('dominantAxis', () => {
  it('reads zero off a plan built on the axes', () => {
    const axis = dominantAxis([wall(0, 0, 10, 0), wall(0, 0, 0, 8), wall(10, 0, 10, 8)]);
    assert.ok(axis);
    assert.ok(Math.abs(axis.deg) < 1e-6, `deg ${axis.deg}`);
    assert.ok(axis.coherence > 0.99, `coherence ${axis.coherence}`);
  });

  it('reads the turn a georeferenced export baked in', () => {
    // The case this was built for: the same plan, rotated by the site's
    // true-north angle. Nine degrees is invisible on screen and moves the far
    // end of a 50 m building by 8 m.
    const plan = [[0, 0, 10, 0], [0, 0, 0, 8], [10, 0, 10, 8]] as const;
    const axis = dominantAxis(plan.map(([a, b, c, d]) => turned(9.6, a, b, c, d)));
    assert.ok(axis);
    assert.ok(Math.abs(axis.deg - 9.6) < 1e-4, `deg ${axis.deg}`);
  });

  it('does not let walls either side of zero average to a false axis', () => {
    // Naively averaging −44° and +44° gives 0°, which is the one direction no
    // wall runs in. Modulo 90 they are 2° apart and the answer is ±45.
    const axis = dominantAxis([turned(-44, 0, 0, 10, 0), turned(44, 0, 0, 10, 0)]);
    assert.ok(axis);
    assert.ok(Math.abs(Math.abs(axis.deg) - 45) < 1e-6, `deg ${axis.deg}`);
  });

  it('reports a quarter turn as the small angle it is', () => {
    // A plan turned 87° is a plan turned −3°: along and across say the same
    // thing about orientation, so the answer stays in (−45, 45].
    const axis = dominantAxis([turned(87, 0, 0, 10, 0), turned(87, 0, 0, 0, 8)]);
    assert.ok(axis);
    assert.ok(Math.abs(axis.deg + 3) < 1e-4, `deg ${axis.deg}`);
  });

  it('weighs a long wall over a short one', () => {
    const axis = dominantAxis([turned(0, 0, 0, 40, 0), turned(20, 0, 0, 1, 0)]);
    assert.ok(axis);
    assert.ok(Math.abs(axis.deg) < 1.5, `a 1 m wall should barely move it, got ${axis.deg}`);
  });

  it('ignores edges that climb, so a gable does not tilt the plan', () => {
    const sloped = { expressId: 2, ifcType: 'IfcWall',
      positions: new Float32Array([0, 0, 0, 10, 5, -10, 10, 5, -10]),
      indices: new Uint32Array([0, 1, 2]) } as unknown as MeshData;
    const axis = dominantAxis([wall(0, 0, 10, 0), sloped]);
    assert.ok(axis);
    assert.ok(Math.abs(axis.deg) < 1e-6, `deg ${axis.deg}`);
  });

  it('has no answer for a model without walls', () => {
    assert.equal(dominantAxis([wall(0, 0, 10, 0, 'IfcSlab')]), null);
  });

  it('says so when the walls agree on nothing', () => {
    const spokes = [0, 12, 27, 38, 51, 63, 78].map((d) => turned(d, 0, 0, 10, 0));
    const axis = dominantAxis(spokes);
    assert.ok(axis);
    assert.ok(axis.coherence < 0.5, `a fan of walls has no axis, got ${axis.coherence}`);
  });
});
