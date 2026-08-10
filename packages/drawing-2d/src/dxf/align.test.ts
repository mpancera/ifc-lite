/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Every test here checks the solved placement by APPLYING it with the real
 * `applyDxfPlacement` and asserting the picked points land where they were
 * said to belong.
 *
 * Deliberately not by re-deriving the arithmetic: the transform composes a
 * scale, a transposed rotation and a translation in one particular order, and
 * a test that repeats that order would agree with a wrong solver as happily as
 * with a right one.
 */

import { describe, it, expect } from 'vitest';
import { applyDxfPlacement } from './convert.js';
import {
  describeSolvedScale, inverseDxfPlacement, solveDxfPlacement, type AlignmentPair,
} from './align.js';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 1e-9) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  void tol;
};

/** Solve, then check both picks land. The property that matters. */
function expectLands(a: AlignmentPair, b: AlignmentPair, options?: { lockScale?: number }) {
  const result = solveDxfPlacement(a, b, options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');

  near(applyDxfPlacement(a.from, result.placement), a.to);
  if (options?.lockScale === undefined) {
    near(applyDxfPlacement(b.from, result.placement), b.to);
  }
  return result;
}

describe('solveDxfPlacement', () => {
  it('solves a pure translation', () => {
    expectLands(
      { from: { x: 0, y: 0 }, to: { x: 10, y: 5 } },
      { from: { x: 1, y: 0 }, to: { x: 11, y: 5 } },
    );
  });

  it('solves a rotation', () => {
    // A drawing at 90° to the model - the everyday case with a plan that was
    // set up in a different orientation.
    const r = expectLands(
      { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
      { from: { x: 2, y: 0 }, to: { x: 0, y: 2 } },
    );

    expect(Math.abs(r.rotationDeg)).toBeCloseTo(90, 6);
  });

  it('solves a scale', () => {
    const r = expectLands(
      { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
      { from: { x: 1, y: 0 }, to: { x: 4, y: 0 } },
    );

    expect(r.scale).toBeCloseTo(4, 9);
  });

  it('solves all three at once, which is the whole point', () => {
    // Typing these three by hand is trial and error, because correcting one
    // throws off the other two.
    const r = expectLands(
      { from: { x: 3, y: -7 }, to: { x: 120.5, y: 44.25 } },
      { from: { x: 19, y: 5 }, to: { x: 100.5, y: 60.75 } },
    );

    expect(r.scale).toBeGreaterThan(0);
  });

  it('recovers a millimetre drawing as a factor of 1000', () => {
    // The answer to the $INSUNITS question that a DXF often cannot give.
    const r = expectLands(
      { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
      { from: { x: 12000, y: 0 }, to: { x: 12, y: 0 } },
    );

    expect(1 / r.scale).toBeCloseTo(1000, 6);
  });

  it('reports a rotation in (-180, 180]', () => {
    // 359.7° reads as broken; -0.3° reads as a drawing very slightly askew.
    const r = solveDxfPlacement(
      { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
      { from: { x: 1, y: 0 }, to: { x: 1, y: -0.005 } },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rotationDeg).toBeGreaterThan(-180);
    expect(r.rotationDeg).toBeLessThanOrEqual(180);
    expect(Math.abs(r.rotationDeg)).toBeLessThan(1);
  });

  it('is exact for the pair it is anchored on even with a locked scale', () => {
    // With the size held, only the first pair can land exactly. That is the
    // honest outcome of asking for the scale to be left alone.
    const r = expectLands(
      { from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
      { from: { x: 10, y: 0 }, to: { x: 25, y: 5 } },
      { lockScale: 1 },
    );

    expect(r.scale).toBe(1);
  });
});

describe('solveDxfPlacement · refusals', () => {
  it('refuses two picks on the same spot of the drawing', () => {
    const r = solveDxfPlacement(
      { from: { x: 1, y: 1 }, to: { x: 0, y: 0 } },
      { from: { x: 1, y: 1 }, to: { x: 5, y: 0 } },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('coincident-source');
  });

  it('tells the two coincidence cases apart', () => {
    // Two picks on one spot of the DRAWING and two on one spot of the MODEL
    // are different mistakes, fixed in different places.
    const target = solveDxfPlacement(
      { from: { x: 0, y: 0 }, to: { x: 2, y: 2 } },
      { from: { x: 5, y: 0 }, to: { x: 2, y: 2 } },
    );

    expect(target.ok).toBe(false);
    if (target.ok) return;
    expect(target.reason).toBe('coincident-target');
  });
});

describe('describeSolvedScale', () => {
  it('names the round unit factors', () => {
    expect(describeSolvedScale(1000)).toBe('Millimeter');
    expect(describeSolvedScale(100)).toBe('Zentimeter');
    expect(describeSolvedScale(1)).toBe('Meter');
    expect(describeSolvedScale(304.8)).toBe('Fuss');
  });

  it('tolerates the rounding of a real drawing', () => {
    expect(describeSolvedScale(1000.9)).toBe('Millimeter');
  });

  it('says nothing about a scale that is merely close', () => {
    // 1.04 is a badly picked point, not "centimetres roughly". Naming it
    // would turn a mistake into a conclusion.
    expect(describeSolvedScale(1.04)).toBeNull();
    expect(describeSolvedScale(870)).toBeNull();
  });
});

describe('inverseDxfPlacement', () => {
  const placement = { offsetX: 12.5, offsetY: -3.25, rotationDeg: 37, scale: 2.5 };

  it('round-trips a point through the forward transform', () => {
    // The property that matters: whatever applyDxfPlacement does, this undoes.
    for (const p of [{ x: 0, y: 0 }, { x: 4, y: -9 }, { x: -1.5, y: 0.25 }]) {
      const there = applyDxfPlacement(p, placement);
      const back = inverseDxfPlacement(there, placement);

      expect(back).not.toBeNull();
      near(back!, p);
    }
  });

  it('round-trips through the identity placement', () => {
    const identity = { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 };

    near(inverseDxfPlacement({ x: 3, y: 4 }, identity)!, { x: 3, y: 4 });
  });

  it('refuses a scale it cannot invert', () => {
    // Not reachable through the UI, but reachable through a stored placement.
    // Guessing would put the picked point somewhere arbitrary.
    expect(inverseDxfPlacement({ x: 1, y: 1 }, { ...placement, scale: 0 })).toBeNull();
  });

  it('lets a placed underlay be re-aligned without compounding', () => {
    // Picking on an already-moved plan must express the pick in the drawing's
    // OWN coordinates; otherwise the new solve stacks on the old placement.
    const local = { x: 7, y: -2 };
    const placed = applyDxfPlacement(local, placement);

    near(inverseDxfPlacement(placed, placement)!, local);
  });
});
