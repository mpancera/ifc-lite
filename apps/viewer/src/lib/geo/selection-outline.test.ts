/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { CoordinateInfo, GeometryResult, MeshData } from '@ifc-lite/geometry';

import { footprintFromSelection, mergeMeshes, outlineFromSelection } from './selection-outline.js';
import { extractPlanOutline } from './extract-outline.js';
import { ringArea } from './footprint.js';
import type { Point2 } from './fit-outline.js';

/** A flat quad in the plan, as two triangles with unshared vertices. */
function plate(expressId: number, x0: number, y0: number, x1: number, y1: number): MeshData {
  const corners: Point2[] = [
    { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]] as Array<[number, number, number]>) {
    for (const index of [a, b, c]) {
      indices.push(positions.length / 3);
      // Plan (x, y) enters viewer space as (x, height, -y).
      positions.push(corners[index].x, 0, -corners[index].y);
    }
  }
  return {
    expressId,
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
    color: [1, 1, 1, 1],
  };
}

function geometry(meshes: MeshData[], coordinateInfo: Partial<CoordinateInfo> = {}): GeometryResult {
  return {
    meshes,
    totalTriangles: meshes.reduce((sum, m) => sum + m.indices.length / 3, 0),
    totalVertices: meshes.reduce((sum, m) => sum + m.positions.length / 3, 0),
    coordinateInfo: {
      originShift: { x: 0, y: 0, z: 0 },
      originalBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      shiftedBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      hasLargeCoordinates: false,
      ...coordinateInfo,
    },
  };
}

describe('mergeMeshes', () => {
  it('turns a seam between two plates into an interior edge', () => {
    // The reason merging exists: selecting a terrain split across meshes has
    // to behave like selecting one surface. Kept apart, the shared edge counts
    // as border on both sides and the outline comes back in two pieces.
    const left = plate(1, 0, 0, 10, 10);
    const right = plate(2, 10, 0, 20, 10);

    const merged = extractPlanOutline(mergeMeshes([left, right]));
    assert.ok(merged.ok);
    assert.strictEqual(merged.ringCount, 1, 'the seam should not survive as border');
    assert.ok(Math.abs(merged.area - 200) < 1e-6, `area ${merged.area}`);

    // Each plate alone is its own ring, confirming the merge did the work.
    const alone = extractPlanOutline(mergeMeshes([left]));
    assert.ok(alone.ok);
    assert.ok(Math.abs(alone.area - 100) < 1e-6);
  });

  it('rebases indices so a later mesh does not point into the first', () => {
    const merged = mergeMeshes([plate(1, 0, 0, 10, 10), plate(2, 50, 50, 60, 60)]);
    assert.strictEqual(merged.positions.length / 3, 12);
    assert.strictEqual(Math.max(...Array.from(merged.indices)), 11);
  });
});

describe('outlineFromSelection', () => {
  const scene = geometry([plate(1, 0, 0, 10, 10), plate(2, 100, 100, 110, 110)]);

  it('outlines only what is selected', () => {
    const result = outlineFromSelection(new Set([1]), scene);
    assert.ok(result.ok);
    assert.strictEqual(result.meshCount, 1);
    assert.ok(Math.abs(result.area - 100) < 1e-6);
    // IFC plan coordinates, so the viewer's negated Z is undone.
    const xs = result.ring.map(p => p.x);
    const ys = result.ring.map(p => p.y);
    assert.ok(Math.min(...xs) === 0 && Math.max(...xs) === 10);
    assert.ok(Math.min(...ys) === 0 && Math.max(...ys) === 10);
  });

  it('says so when nothing is selected', () => {
    assert.deepStrictEqual(
      outlineFromSelection(new Set(), scene),
      { ok: false, reason: 'nothing-selected' },
    );
  });

  it('says so when the selection carries no geometry', () => {
    assert.deepStrictEqual(
      outlineFromSelection(new Set([999]), scene),
      { ok: false, reason: 'no-geometry' },
    );
    assert.deepStrictEqual(
      outlineFromSelection(new Set([1]), null),
      { ok: false, reason: 'no-geometry' },
    );
  });

  it('passes the extractor refusal through unchanged', () => {
    // A closed solid has no border; the caller needs to know that rather than
    // receive a hull that is not the footprint.
    const cube: MeshData = {
      expressId: 7,
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
        0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
      ]),
      normals: new Float32Array(24),
      indices: new Uint32Array([
        0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
        2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
      ]),
      color: [1, 1, 1, 1],
    };
    assert.deepStrictEqual(
      outlineFromSelection(new Set([7]), geometry([cube])),
      { ok: false, reason: 'no-boundary' },
    );
  });
});

/** A closed box: floor, roof and four walls, which is what a building is. */
function box(
  expressId: number,
  r: { x0: number; y0: number; x1: number; y1: number; h?: number },
): MeshData {
  const h = r.h ?? 3;
  const plan: Point2[] = [
    { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
  ];

  const positions: number[] = [];
  for (const p of plan) positions.push(p.x, 0, -p.y);
  for (const p of plan) positions.push(p.x, h, -p.y);

  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];

  return {
    expressId,
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    indices: new Uint32Array(indices),
    color: [1, 1, 1, 1],
  };
}

function extent(ring: readonly Point2[]) {
  return {
    x0: Math.min(...ring.map(p => p.x)), x1: Math.max(...ring.map(p => p.x)),
    y0: Math.min(...ring.map(p => p.y)), y1: Math.max(...ring.map(p => p.y)),
  };
}

describe('footprintFromSelection', () => {
  it('gives a selected solid a footprint where the boundary extractor gives none', () => {
    // The gap that closed the building case: the same selection through
    // outlineFromSelection has no border to chain, because every edge of a
    // solid is shared.
    const scene = geometry([box(41, { x0: 0, y0: 0, x1: 20, y1: 12 })]);
    const ids = new Set([41]);

    assert.deepStrictEqual(outlineFromSelection(ids, scene), { ok: false, reason: 'no-boundary' });

    const footprint = footprintFromSelection(ids, scene);
    assert.ok(footprint.ok);
    assert.strictEqual(footprint.meshCount, 1);
  });

  it('recovers the plan extent, to within the raster it reports', () => {
    const footprint = footprintFromSelection(
      new Set([41]),
      geometry([box(41, { x0: 0, y0: 0, x1: 20, y1: 12 })]),
    );
    assert.ok(footprint.ok);

    const e = extent(footprint.ring);
    const tolerance = footprint.cellSize * 1.5;
    assert.ok(Math.abs(e.x0 - 0) <= tolerance, `x0 ${e.x0}`);
    assert.ok(Math.abs(e.x1 - 20) <= tolerance, `x1 ${e.x1}`);
    assert.ok(Math.abs(e.y0 - 0) <= tolerance, `y0 ${e.y0}`);
    assert.ok(Math.abs(e.y1 - 12) <= tolerance, `y1 ${e.y1}`);
    assert.ok(footprint.cellSize > 0, 'the accuracy must be reported, not hidden');
  });

  it('takes the union of several selected meshes, not one of them', () => {
    // An L-shaped building modelled as two wings. Treating the meshes
    // separately would fit whichever came first and call it the building.
    const footprint = footprintFromSelection(
      new Set([41, 42]),
      geometry([
        box(41, { x0: 0, y0: 0, x1: 20, y1: 8 }),
        box(42, { x0: 0, y0: 8, x1: 8, y1: 20 }),
      ]),
    );
    assert.ok(footprint.ok);

    assert.strictEqual(footprint.meshCount, 2);
    const e = extent(footprint.ring);
    assert.ok(e.x1 >= 19, `the long wing must be in it, x1 ${e.x1}`);
    assert.ok(e.y1 >= 19, `the short wing must be in it, y1 ${e.y1}`);
    // Not a convex hull: the re-entrant corner has to survive, or an L-shaped
    // block would be handed to the fit as a rectangle it never was.
    const area = Math.abs(ringArea(footprint.ring));
    assert.ok(area < 20 * 20 * 0.9, `got ${area} m2, which is close to the hull`);
  });

  it('takes the RTC offset back out', () => {
    // A georeferenced model has its geometry rebased; a ring read straight off
    // the positions would be kilometres from where IfcMapConversion expects it.
    const plain = footprintFromSelection(
      new Set([41]),
      geometry([box(41, { x0: 0, y0: 0, x1: 20, y1: 12 })]),
    );
    const rebased = footprintFromSelection(
      new Set([41]),
      geometry(
        [box(41, { x0: 0, y0: 0, x1: 20, y1: 12 })],
        { wasmRtcOffset: { x: 1000, y: 500, z: 0 } },
      ),
    );
    assert.ok(plain.ok && rebased.ok);

    const before = extent(plain.ring);
    const after = extent(rebased.ring);
    assert.ok(Math.abs((after.x0 - before.x0) - 1000) < 1e-6, `x moved ${after.x0 - before.x0}`);
    assert.ok(Math.abs((after.y0 - before.y0) - 500) < 1e-6, `y moved ${after.y0 - before.y0}`);
  });

  it('separates an empty selection from a selection without geometry', () => {
    const scene = geometry([box(41, { x0: 0, y0: 0, x1: 20, y1: 12 })]);

    assert.deepStrictEqual(
      footprintFromSelection(new Set(), scene),
      { ok: false, reason: 'nothing-selected' },
    );
    assert.deepStrictEqual(
      footprintFromSelection(new Set([99]), scene),
      { ok: false, reason: 'no-geometry' },
    );
  });
});
