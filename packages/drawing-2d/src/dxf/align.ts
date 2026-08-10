/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Aligning an underlay by naming two points instead of guessing three numbers.
 *
 * Placing a drawing by typing offset, rotation and scale is not aligning, it
 * is trial and error: the three interact, so correcting one throws off the
 * other two. Two point pairs determine all three at once — pick two features
 * on the drawing, name where they actually are, and the transform follows.
 *
 * Two pairs is exactly enough for a similarity transform and no more. A third
 * pair would be over-determined and need a least-squares fit, which silently
 * averages away a mis-picked point instead of showing it.
 *
 * ## The scale is an answer, not just a parameter
 *
 * A DXF carries no reliable unit. `$INSUNITS` is optional and frequently
 * absent, so an import can be out by a factor of 1000 with nothing to say so.
 * The solved scale IS that missing information — a result near 1000 means the
 * drawing was in millimetres. Which is why {@link solveDxfPlacement} reports
 * it rather than only applying it: a factor silently absorbed is a fact
 * nobody learns.
 */

import type { Point2D } from '../types.js';
import type { DxfPlacement } from './types.js';

/** One picked feature: where it is on the drawing, and where it belongs. */
export interface AlignmentPair {
  /** A point on the underlay, in its own drawing coordinates. */
  from: Point2D;
  /** Where that point actually belongs, in the target's drawing space. */
  to: Point2D;
}

export type SolveAlignmentResult =
  | { ok: true; placement: DxfPlacement; scale: number; rotationDeg: number }
  | { ok: false; reason: 'coincident-source' | 'coincident-target' };

/** Below this the two picks are the same point and no direction exists. */
const MIN_SEPARATION = 1e-9;

/**
 * The placement that carries both `from` points onto their `to` points.
 *
 * Composed to match `applyDxfPlacement` exactly — scale, then rotate by the
 * transposed matrix (counter-clockwise as seen on a plan, because drawing
 * space renders with +y downward), then translate. The test applies the real
 * `applyDxfPlacement` to the solved result rather than re-deriving the
 * arithmetic, so the two cannot drift apart.
 *
 * `lockScale` keeps the drawing's size and uses the pairs for position and
 * rotation only — for a drawing already known to be at the right scale, where
 * a solved 1.003 would be pick jitter rather than a real difference.
 */
export function solveDxfPlacement(
  a: AlignmentPair,
  b: AlignmentPair,
  options: { lockScale?: number } = {},
): SolveAlignmentResult {
  const srcDx = b.from.x - a.from.x;
  const srcDy = b.from.y - a.from.y;
  const dstDx = b.to.x - a.to.x;
  const dstDy = b.to.y - a.to.y;

  const srcLen = Math.hypot(srcDx, srcDy);
  const dstLen = Math.hypot(dstDx, dstDy);

  // Reported separately: two picks on the same spot on the DRAWING and two on
  // the same spot on the MODEL are different mistakes, and the person fixes
  // them in different places.
  if (srcLen < MIN_SEPARATION) return { ok: false, reason: 'coincident-source' };
  if (dstLen < MIN_SEPARATION) return { ok: false, reason: 'coincident-target' };

  const scale = options.lockScale ?? dstLen / srcLen;

  // `applyDxfPlacement` rotates by R(-θ), so the angle it removes is the
  // difference the other way round.
  const rad = Math.atan2(srcDy, srcDx) - Math.atan2(dstDy, dstDx);
  const c = Math.cos(rad);
  const s = Math.sin(rad);

  // Translate so that the first pair lands exactly. With a locked scale the
  // second pair then lands only approximately, which is the honest outcome:
  // the caller asked for the size to be left alone.
  const rx = a.from.x * scale;
  const ry = a.from.y * scale;
  return {
    ok: true,
    placement: {
      offsetX: a.to.x - (rx * c + ry * s),
      offsetY: a.to.y - (-rx * s + ry * c),
      rotationDeg: normaliseDegrees((rad * 180) / Math.PI),
      scale,
    },
    scale,
    rotationDeg: normaliseDegrees((rad * 180) / Math.PI),
  };
}

/**
 * What a solved scale says about the drawing's unit, or `null` when it says
 * nothing in particular.
 *
 * Only the round factors are named. A scale of 1.04 is not "centimetres
 * roughly", it is a badly picked point, and calling it a unit would turn a
 * mistake into a conclusion.
 */
export function describeSolvedScale(scale: number): string | null {
  const known: [number, string][] = [
    [1000, 'Millimeter'],
    [100, 'Zentimeter'],
    [1, 'Meter'],
    [0.001, 'Kilometer'],
    [304.8, 'Fuss'],
    [25.4, 'Zoll'],
  ];
  for (const [factor, unit] of known) {
    // 0.5 % — tight enough that a mis-pick does not qualify, loose enough for
    // the rounding in a real drawing.
    if (Math.abs(scale - factor) / factor < 0.005) return unit;
  }
  return null;
}

/** To (-180, 180]. Two placements a full turn apart are the same placement,
 *  and a rotation shown as 359.7° reads as broken. */
function normaliseDegrees(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * The inverse of `applyDxfPlacement`: from placed drawing space back to the
 * underlay's own coordinates.
 *
 * Needed the moment a person picks a feature ON a placed underlay. What they
 * clicked is a point in drawing space, but the alignment has to be expressed
 * in the drawing's OWN coordinates — otherwise every solve would be relative
 * to wherever the plan happened to sit at the time, and re-aligning a plan
 * that was already moved would compound the two placements instead of
 * replacing one.
 *
 * Returns `null` for a degenerate scale, which cannot be inverted. A zero
 * scale is not reachable through the UI (the field rejects it) but is
 * reachable through a stored placement, and guessing here would put the point
 * somewhere arbitrary.
 */
export function inverseDxfPlacement(p: Point2D, placement: DxfPlacement): Point2D | null {
  if (!Number.isFinite(placement.scale) || Math.abs(placement.scale) < 1e-12) return null;

  const rad = (placement.rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);

  const dx = p.x - placement.offsetX;
  const dy = p.y - placement.offsetY;

  // The forward rotation is [[c, s], [-s, c]]; its inverse is the transpose.
  return {
    x: (dx * c - dy * s) / placement.scale,
    y: (dx * s + dy * c) / placement.scale,
  };
}
