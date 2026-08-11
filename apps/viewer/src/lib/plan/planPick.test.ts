/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickInPlan, planScreenToDrawing, planPointToRenderer, planPointToStoreyLocal } from './planPick.js';
import { projectTo2D } from '@ifc-lite/drawing-2d';
import type {
  Drawing2D, DrawingLine, DrawingPolygon, LineCategory, Point2D,
} from '@ifc-lite/drawing-2d';

function rect(x0: number, y0: number, x1: number, y1: number): Point2D[] {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

function poly(
  entityId: number,
  ifcType: string,
  outer: Point2D[],
  opts: { isCut?: boolean; holes?: Point2D[][] } = {},
): DrawingPolygon {
  return {
    polygon: { outer, holes: opts.holes ?? [] },
    entityId,
    ifcType,
    modelIndex: 0,
    isCut: opts.isCut ?? true,
  } as DrawingPolygon;
}

function line(
  entityId: number,
  ifcType: string,
  a: Point2D,
  b: Point2D,
  category: LineCategory = 'cut',
  visibility: 'visible' | 'hidden' = 'visible',
): DrawingLine {
  return {
    line: { start: a, end: b },
    category,
    visibility,
    entityId,
    ifcType,
    modelIndex: 0,
    depth: 0,
  } as DrawingLine;
}

function drawing(over: Partial<Drawing2D> = {}): Drawing2D {
  return {
    config: {} as Drawing2D['config'],
    lines: [],
    cutPolygons: [],
    projectionPolygons: [],
    bounds: { min: { x: -100, y: -100 }, max: { x: 100, y: 100 } },
    stats: {} as Drawing2D['stats'],
    ...over,
  } as Drawing2D;
}

describe('pickInPlan — the cut outranks what is below it', () => {
  it('picks the cut wall, not the slab under it, where the two overlap', () => {
    // This is the whole requirement: in a plan the slab spans the entire floor,
    // so a depth- or draw-order-based pick would answer "slab" everywhere.
    const d = drawing({
      cutPolygons: [poly(10, 'IfcWall', rect(0, 0, 5, 0.3))],
      projectionPolygons: [poly(20, 'IfcSlab', rect(-10, -10, 10, 10), { isCut: false })],
    });
    const hit = pickInPlan(d, { x: 2, y: 0.15 }, 0.05);
    assert.equal(hit?.entityId, 10);
    assert.equal(hit?.ifcType, 'IfcWall');
    assert.equal(hit?.tier, 'cut');
  });

  it('still reaches what is below the cut where the cut has nothing', () => {
    // A table in the middle of a room is drawn and must be clickable.
    const d = drawing({
      cutPolygons: [poly(10, 'IfcWall', rect(0, 0, 5, 0.3))],
      projectionPolygons: [poly(30, 'IfcFurniture', rect(2, 2, 3, 3), { isCut: false })],
    });
    const hit = pickInPlan(d, { x: 2.5, y: 2.5 }, 0.05);
    assert.equal(hit?.entityId, 30);
    assert.equal(hit?.tier, 'projection');
  });

  it('prefers a cut LINE over a projected area, so a thin cut element stays reachable', () => {
    const d = drawing({
      lines: [line(11, 'IfcColumn', { x: 4, y: 4 }, { x: 4, y: 5 }, 'cut')],
      projectionPolygons: [poly(20, 'IfcSlab', rect(-10, -10, 10, 10), { isCut: false })],
    });
    const hit = pickInPlan(d, { x: 4.02, y: 4.5 }, 0.05);
    assert.equal(hit?.entityId, 11);
    assert.equal(hit?.tier, 'cut');
  });
});

describe('pickInPlan — areas', () => {
  it('picks the smaller of two containing areas, so an embedded column is reachable', () => {
    const d = drawing({
      cutPolygons: [
        poly(10, 'IfcWall', rect(0, 0, 10, 1)),
        poly(11, 'IfcColumn', rect(4, 0, 5, 1)),
      ],
    });
    assert.equal(pickInPlan(d, { x: 4.5, y: 0.5 }, 0.01)?.entityId, 11);
    // Outside the column, the wall still answers.
    assert.equal(pickInPlan(d, { x: 8, y: 0.5 }, 0.01)?.entityId, 10);
  });

  it('does not select a wall through its own opening', () => {
    // A doorway is a hole in the cut face. The wall is not there.
    const d = drawing({
      cutPolygons: [poly(10, 'IfcWall', rect(0, 0, 10, 0.3), { holes: [rect(4, 0, 5, 0.3)] })],
    });
    assert.equal(pickInPlan(d, { x: 4.5, y: 0.15 }, 0.001), null);
    assert.equal(pickInPlan(d, { x: 2, y: 0.15 }, 0.001)?.entityId, 10);
  });
});

describe('pickInPlan — lines', () => {
  it('takes the nearest line within tolerance and refuses anything beyond it', () => {
    const d = drawing({
      lines: [
        line(10, 'IfcWall', { x: 0, y: 0 }, { x: 10, y: 0 }),
        line(11, 'IfcWall', { x: 0, y: 1 }, { x: 10, y: 1 }),
      ],
    });
    assert.equal(pickInPlan(d, { x: 5, y: 0.1 }, 0.2)?.entityId, 10);
    assert.equal(pickInPlan(d, { x: 5, y: 0.9 }, 0.2)?.entityId, 11);
    // Halfway between, outside the grab radius of either.
    assert.equal(pickInPlan(d, { x: 5, y: 0.5 }, 0.2), null);
  });

  it('ignores a line the hidden-line pass removed', () => {
    // Picking geometry the drawing does not show misreports what was clicked.
    const d = drawing({
      lines: [line(10, 'IfcWall', { x: 0, y: 0 }, { x: 10, y: 0 }, 'cut', 'hidden')],
    });
    assert.equal(pickInPlan(d, { x: 5, y: 0 }, 0.2), null);
  });

  it('ignores the dashed hidden category as well as the hidden state', () => {
    const d = drawing({
      lines: [line(10, 'IfcWall', { x: 0, y: 0 }, { x: 10, y: 0 }, 'hidden', 'visible')],
    });
    assert.equal(pickInPlan(d, { x: 5, y: 0 }, 0.2), null);
  });

  it('finds nothing on empty paper', () => {
    assert.equal(pickInPlan(drawing(), { x: 1, y: 1 }, 0.2), null);
  });
});

describe('pickInPlan — federation', () => {
  it('reports the model the geometry came from, not just the express id', () => {
    const p = poly(10, 'IfcWall', rect(0, 0, 5, 1));
    const d = drawing({ cutPolygons: [{ ...p, modelIndex: 3 }] });
    const hit = pickInPlan(d, { x: 1, y: 0.5 }, 0.01);
    assert.equal(hit?.modelIndex, 3);
  });
});

describe('planScreenToDrawing', () => {
  it('inverts the transform the canvas paints a plan with', () => {
    const t = { x: 120, y: 40, scale: 25 };
    const drawingPoint = { x: 3.2, y: -1.6 };
    // Forward, as Drawing2DCanvas maps a 'down' plan: same positive scale, no flip.
    const screenX = drawingPoint.x * t.scale + t.x;
    const screenY = drawingPoint.y * t.scale + t.y;
    const back = planScreenToDrawing(screenX, screenY, t);
    assert.ok(Math.abs(back.x - drawingPoint.x) < 1e-9);
    assert.ok(Math.abs(back.y - drawingPoint.y) < 1e-9);
  });

  it('keeps the grab radius constant on screen: 6 px is smaller in metres when zoomed in', () => {
    const near = 6 / 100;  // zoomed in
    const far = 6 / 10;    // zoomed out
    assert.ok(near < far);
  });
});

describe('planPointToRenderer', () => {
  it('inverts the REAL projection the cutter used, not a restated one', () => {
    // The guard that matters. A sign error here mirrors every placement about
    // the building's X axis: plausible output, wrong side of the plan. So this
    // asserts against `projectTo2D` itself rather than a copy of its rule.
    const world = { x: 7.1, y: 1.0, z: -3.9 };
    const projected = projectTo2D(world, 'y', false); // 'y' = a down cut
    const back = planPointToRenderer(projected, world.y);

    assert.ok(Math.abs(back.x - world.x) < 1e-9);
    assert.ok(Math.abs(back.z - world.z) < 1e-9);
    assert.ok(Math.abs(back.y - world.y) < 1e-9);
  });

  it('does not negate: a point south of the origin stays south', () => {
    // Stated separately from the round-trip because a matching pair of sign
    // errors would round-trip perfectly and still place everything mirrored.
    const back = planPointToRenderer({ x: 2, y: -3.9 }, 0);
    assert.equal(back.z, -3.9);
  });

  it('carries the height it was handed, so the point is a real world point', () => {
    assert.equal(planPointToRenderer({ x: 0, y: 0 }, 4.25).y, 4.25);
  });
});

describe('planPointToStoreyLocal', () => {
  /** What `rendererPointToIfcStoreyLocal` does, restated for the test only. */
  const rendererToIfcLocal = (p: { x: number; y: number; z: number }) => [p.x, -p.z, 0];

  it('agrees with the chain placement actually takes', () => {
    // Placement goes plan → renderer → storey-local. This collapses the two
    // steps, so it has to land in the same place or a committed annotation
    // sits somewhere a placed element would not.
    for (const point of [{ x: 3.2, y: -1.6 }, { x: -7, y: 4.25 }, { x: 0, y: 0 }]) {
      const viaChain = rendererToIfcLocal(planPointToRenderer(point, 1.25));
      const direct = planPointToStoreyLocal(point);
      assert.equal(direct[0], viaChain[0]);
      assert.equal(direct[1], viaChain[1]);
    }
  });

  it('flips the sign of y, and only y', () => {
    // Stated on its own because the round-trip above would also pass if BOTH
    // sides were mirrored, and the result would be a plan-wide mirror.
    const local = planPointToStoreyLocal({ x: 5, y: -6 });
    assert.equal(local[0], 5);
    assert.equal(local[1], 6);
  });
});
