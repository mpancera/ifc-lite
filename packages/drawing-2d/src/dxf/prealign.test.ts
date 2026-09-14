/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The rough alignment, checked the way the two-point solver is checked: by
 * running the answer back through `applyDxfPlacement` and seeing where the
 * drawing lands. The sign of a rotation in this pipeline is not something to
 * argue about in a comment — the y axis flips between world and drawing space,
 * and the placement turns clockwise — so it is pinned here instead.
 */

import { describe, expect, it } from 'vitest';
import { prealignDxf, type Polyline } from './prealign.js';
import { applyDxfPlacement } from './convert.js';
import type { Point2D } from '../types.js';

/** An L-shaped building outline, so a quarter turn is detectable. */
const PLAN: Polyline[] = [
  [{ x: 0, y: 0 }, { x: 40, y: 0 }],
  [{ x: 40, y: 0 }, { x: 40, y: 12 }],
  [{ x: 40, y: 12 }, { x: 22, y: 12 }],
  [{ x: 22, y: 12 }, { x: 22, y: 20 }],
  [{ x: 22, y: 20 }, { x: 0, y: 20 }],
  [{ x: 0, y: 20 }, { x: 0, y: 0 }],
  // Some interior walls, on the same two axes.
  [{ x: 10, y: 0 }, { x: 10, y: 20 }],
  [{ x: 0, y: 8 }, { x: 22, y: 8 }],
  [{ x: 28, y: 0 }, { x: 28, y: 12 }],
];

function move(lines: readonly Polyline[], deg: number, scale: number, dx: number, dy: number): Polyline[] {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return lines.map((line) => line.map((p) => ({
    x: (p.x * c - p.y * s) * scale + dx,
    y: (p.x * s + p.y * c) * scale + dy,
  })));
}

/** Where the drawing ends up once the answer is applied. */
function placed(source: readonly Polyline[], result: ReturnType<typeof prealignDxf>): Point2D[] {
  return source.flatMap((line) => line.map((p) => applyDxfPlacement(p, result.placement)));
}

function bounds(points: readonly Point2D[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

function near(a: number, b: number, tol = 0.5) {
  expect(Math.abs(a - b)).toBeLessThan(tol);
}

describe('prealignDxf', () => {
  it('lands a turned drawing back on the model', () => {
    // The whole point, and the reason the sign is not reasoned about: the
    // answer is applied and the result is measured.
    const source = move(PLAN, 9.25, 1, 500, -300);
    const result = prealignDxf(source, PLAN);

    const got = bounds(placed(source, result));
    const want = bounds(PLAN.flat());
    near(got.minX, want.minX);
    near(got.maxX, want.maxX);
    near(got.minY, want.minY);
    near(got.maxY, want.maxY);
  });

  it('reads back the angle it was given, as a number a person can check', () => {
    // The source was turned 9.25 degrees anticlockwise, so undoing it is 9.25
    // CLOCKWISE — which is how DxfPlacement counts. Normalised into
    // (-180, 180], because the same turn expressed as -350.75 is useless to
    // anybody comparing it against a drawing.
    const result = prealignDxf(move(PLAN, 9.25, 1, 0, 0), PLAN);

    near(result.rotationDeg, 9.25, 0.6);
    expect(result.rotationDeg).toBeGreaterThan(-180);
    expect(result.rotationDeg).toBeLessThanOrEqual(180);
  });

  it('resolves the quarter turn by measuring what overlaps', () => {
    // An orthogonal building's direction histogram peaks every ninety
    // degrees, so four angles fit it equally. The winner is the one whose
    // line work actually lands on the model's.
    const source = move(PLAN, 90, 1, 120, 40);
    const result = prealignDxf(source, PLAN);

    const got = bounds(placed(source, result));
    const want = bounds(PLAN.flat());
    near(got.maxX - got.minX, want.maxX - want.minX);
    near(got.maxY - got.minY, want.maxY - want.minY);
    expect(result.fit).toBeGreaterThan(0.9);
  });

  it('resolves the HALF turn, which a bounding box cannot', () => {
    // The failure this measure was built for. A plan and the same plan turned
    // half around have identical boxes, and on the first real drawing the box
    // proxy duly chose the wrong one — 171 degrees where 9 was meant.
    const source = move(PLAN, 180, 1, -30, 60);
    const result = prealignDxf(source, PLAN);

    const got = placed(source, result);
    // Corner for corner, not just the box: a half-turn passes a box check.
    const want = PLAN.flat();
    for (const p of want) {
      const nearest = Math.min(...got.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      expect(nearest).toBeLessThan(0.5);
    }
  });

  it('reports a poor fit for a drawing of somewhere else', () => {
    // A plan of another storey has no candidate that fits. Saying so is worth
    // more than turning it to the least bad angle and calling that aligned.
    const elsewhere: Polyline[] = [
      [{ x: 0, y: 0 }, { x: 6, y: 0 }],
      [{ x: 6, y: 0 }, { x: 6, y: 34 }],
      [{ x: 6, y: 34 }, { x: 0, y: 34 }],
      [{ x: 0, y: 34 }, { x: 0, y: 0 }],
      [{ x: 0, y: 17 }, { x: 6, y: 17 }],
      [{ x: 3, y: 0 }, { x: 3, y: 34 }],
    ];
    const result = prealignDxf(elsewhere, PLAN);

    expect(result.fit).toBeLessThan(0.6);
  });

  it('corrects a millimetre drawing', () => {
    // A factor of a thousand is a unit nobody declared, and it is the one
    // scale worth guessing.
    const result = prealignDxf(move(PLAN, 0, 1000, 0, 0), PLAN);

    expect(result.scale).toBe(0.001);
    const got = bounds(placed(move(PLAN, 0, 1000, 0, 0), result));
    near(got.maxX - got.minX, 40);
  });

  it('leaves a drawing that merely shows MORE than the building alone', () => {
    // A plan usually draws the plot as well. The bounding-box ratio is then
    // some number near one, and applying it would shrink a correct drawing.
    const wider: Polyline[] = [
      ...PLAN,
      [{ x: -12, y: -10 }, { x: 55, y: -10 }],
      [{ x: 55, y: -10 }, { x: 55, y: 30 }],
    ];
    const result = prealignDxf(wider, PLAN);

    expect(result.scale).toBe(1);
  });

  it('centres without turning when there is no line work to read', () => {
    const scrap: Polyline[] = [[{ x: 100, y: 100 }, { x: 101, y: 100 }]];
    const result = prealignDxf(scrap, PLAN);

    expect(result.rotationDeg).toBe(0);
    expect(result.scale).toBe(1);
    // Still centred: the old behaviour is the floor, never the worse answer.
    const got = bounds(placed(scrap, result));
    const want = bounds(PLAN.flat());
    near((got.minX + got.maxX) / 2, (want.minX + want.maxX) / 2);
  });

  it('says when the angle is a guess', () => {
    // Line work pointing everywhere gives a flat histogram; a caller that
    // reports "aligned" on that is claiming something it does not know.
    const noise: Polyline[] = [];
    for (let i = 0; i < 40; i += 1) {
      const a = (i / 40) * Math.PI;
      noise.push([{ x: 0, y: 0 }, { x: Math.cos(a) * 10, y: Math.sin(a) * 10 }]);
    }
    const vague = prealignDxf(noise, noise);
    const sharp = prealignDxf(PLAN, PLAN);

    expect(sharp.sharpness).toBeGreaterThan(vague.sharpness * 2);
  });

  it('answers the identity for empty input rather than throwing', () => {
    const result = prealignDxf([], PLAN);

    expect(result.rotationDeg).toBe(0);
    expect(result.placement.offsetX).toBe(0);
  });
});
