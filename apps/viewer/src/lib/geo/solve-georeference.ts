/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deriving a coordinate operation by naming points instead of typing numbers.
 *
 * The georeferencing panel asks for `XAxisAbscissa` and `XAxisOrdinate`, which
 * are the cosine and sine of an angle. Nobody has that angle. What people do
 * have is points: a building corner, a survey mark, a boundary point — a place
 * in the model whose real coordinates are known from a survey list or readable
 * off a cadastral plan. Two such pairs determine position and rotation at
 * once, and the numbers fall out.
 *
 * ## Why this is not `solveDxfPlacement`
 *
 * `@ifc-lite/drawing-2d`'s `solveDxfPlacement` solves the same family of
 * transform, and this is deliberately not it:
 *
 * - **Handedness.** Drawing space renders +y downward, so that solver's
 *   rotation is negated to match `applyDxfPlacement`. Map space is +y north.
 *   Sharing the code would mean a sign flag at the boundary — exactly the kind
 *   of parameter that is read wrong once and silently mirrors a building.
 * - **The scale means the opposite thing.** For a DXF the solved scale is the
 *   missing unit, an answer worth reporting. Here the scale is *known*: IFC
 *   fixes it as the bridge between the project length unit and the map unit.
 *   So it is locked, and what the pairs imply becomes a **check** on the picks
 *   rather than a result (see `scaleDeviationPpm`).
 * - **Number of pairs.** Two is all a drawing alignment wants, because a third
 *   would be averaged in and hide a mis-pick. Surveying answers that objection
 *   differently: take all the points and publish the residual of each, so the
 *   bad one is named rather than absorbed. Hence N ≥ 2 with per-pair residuals.
 *
 * If those three ever converge, the shared core is small — centroids plus a
 * dot/cross accumulation — and worth extracting then, not before.
 *
 * ## The transform
 *
 * Matches the IFC4 `IfcMapConversion` definition, so the outputs drop straight
 * into the entity's attributes:
 *
 * ```
 * E = Eastings  + Scale * (x * XAxisAbscissa - y * XAxisOrdinate)
 * N = Northings + Scale * (x * XAxisOrdinate + y * XAxisAbscissa)
 * ```
 *
 * with `XAxisAbscissa = cos θ`, `XAxisOrdinate = sin θ` — the direction of the
 * model's local X axis expressed in map coordinates.
 */

/** One named correspondence: a point in the model, and where it really is. */
export interface ControlPointPair {
  /** Model plan coordinates (IFC X/Y) in the project length unit. */
  local: { x: number; y: number };
  /** The same point in the map CRS, in map units. */
  map: { easting: number; northing: number };
  /** Shown beside this pair's residual, e.g. "NE building corner". */
  label?: string;
}

export interface GeoreferenceSolution {
  /** `IfcMapConversion.Eastings`, in map units. */
  eastings: number;
  /** `IfcMapConversion.Northings`, in map units. */
  northings: number;
  /** `IfcMapConversion.XAxisAbscissa` — cos of the angle to grid north. */
  xAxisAbscissa: number;
  /** `IfcMapConversion.XAxisOrdinate` — sin of the same angle. */
  xAxisOrdinate: number;
  /** The same rotation in degrees, counter-clockwise, in (-180, 180]. */
  rotationDeg: number;
  /** The scale the solution was built with (the locked one, when locked). */
  scale: number;
  /**
   * The scale the pairs imply on their own. With `scale` locked this is a
   * measurement, not a parameter: it should land on the lock, and how far off
   * it lands says whether the picks are trustworthy.
   */
  solvedScale: number;
  /**
   * `solvedScale` against `scale`, in parts per million. Positive means the
   * model is larger than the control points say. Survey work reads scale error
   * in ppm, and it keeps a 1.0004 legible as "400 ppm".
   *
   * `null` when nothing was locked, because then there is nothing to deviate
   * from — `scale` and `solvedScale` are the same number.
   */
  scaleDeviationPpm: number | null;
  /** Distance from each pair's map point to where the solution puts it, in
   *  map units, in input order. */
  residuals: number[];
  /** The worst pair. With two pairs and a locked scale this is the whole story. */
  maxResidual: number;
  /** Root mean square of `residuals`. */
  rmsResidual: number;
  /** Index of the pair holding `maxResidual` — the one to re-check first. */
  worstPairIndex: number;
}

export type SolveGeoreferenceResult =
  | { ok: true; solution: GeoreferenceSolution }
  | { ok: false; reason: SolveGeoreferenceFailure };

/**
 * Reported separately on purpose: points stacked in the MODEL and points
 * stacked on the MAP are different mistakes, made in different places, and
 * fixed by looking at different things.
 */
export type SolveGeoreferenceFailure =
  | 'too-few-pairs'
  | 'coincident-local'
  | 'coincident-map';

/**
 * Below this the points are effectively one point and no direction exists.
 * Squared extent, so the unit is (project length unit)² — 1e-12 is a micrometre
 * of spread in a metre model, far under any real pick.
 */
const MIN_SPREAD = 1e-12;

export interface SolveGeoreferenceOptions {
  /**
   * Force the scale instead of solving for it. Pass the value IFC requires —
   * project length unit ÷ map unit, i.e. 0.001 for a millimetre model against
   * a metre CRS, 1 when both are metres.
   *
   * Leave unset only to investigate: an unlocked solve tells you what the
   * points think the scale is, which is how a mis-typed coordinate or a model
   * in the wrong unit announces itself.
   */
  lockScale?: number;
}

/**
 * Solve the coordinate operation that carries every `local` point onto its
 * `map` point as closely as a rigid transform allows.
 *
 * Least squares over all pairs (the closed-form 2D similarity), anchored on
 * the centroids. With two pairs and a free scale it fits both exactly. With a
 * locked scale the leftover is split between the pairs rather than dumped on
 * whichever one happens to be second — the misfit belongs to the pair as a
 * whole, and hiding it in one point invites blaming the wrong pick.
 */
export function solveGeoreference(
  pairs: readonly ControlPointPair[],
  options: SolveGeoreferenceOptions = {},
): SolveGeoreferenceResult {
  if (pairs.length < 2) return { ok: false, reason: 'too-few-pairs' };

  const n = pairs.length;
  let localCx = 0;
  let localCy = 0;
  let mapCx = 0;
  let mapCy = 0;
  for (const pair of pairs) {
    localCx += pair.local.x;
    localCy += pair.local.y;
    mapCx += pair.map.easting;
    mapCy += pair.map.northing;
  }
  localCx /= n;
  localCy /= n;
  mapCx /= n;
  mapCy /= n;

  // Centred sums: `dot` and `cross` carry the rotation, `localSpread` the size.
  let dot = 0;
  let cross = 0;
  let localSpread = 0;
  let mapSpread = 0;
  for (const pair of pairs) {
    const ax = pair.local.x - localCx;
    const ay = pair.local.y - localCy;
    const bx = pair.map.easting - mapCx;
    const by = pair.map.northing - mapCy;
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
    localSpread += ax * ax + ay * ay;
    mapSpread += bx * bx + by * by;
  }

  if (localSpread < MIN_SPREAD) return { ok: false, reason: 'coincident-local' };
  if (mapSpread < MIN_SPREAD) return { ok: false, reason: 'coincident-map' };

  const theta = Math.atan2(cross, dot);
  const solvedScale = Math.hypot(dot, cross) / localSpread;
  const scale = options.lockScale ?? solvedScale;

  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Centroid-anchored translation: the transform maps the local centroid onto
  // the map centroid, which is the least-squares optimum for any fixed scale.
  const eastings = mapCx - scale * (localCx * cos - localCy * sin);
  const northings = mapCy - scale * (localCx * sin + localCy * cos);

  const residuals = pairs.map((pair) => {
    const e = eastings + scale * (pair.local.x * cos - pair.local.y * sin);
    const nrt = northings + scale * (pair.local.x * sin + pair.local.y * cos);
    return Math.hypot(pair.map.easting - e, pair.map.northing - nrt);
  });

  let maxResidual = 0;
  let worstPairIndex = 0;
  let sumSquares = 0;
  residuals.forEach((residual, index) => {
    sumSquares += residual * residual;
    if (residual > maxResidual) {
      maxResidual = residual;
      worstPairIndex = index;
    }
  });

  return {
    ok: true,
    solution: {
      eastings,
      northings,
      xAxisAbscissa: cos,
      xAxisOrdinate: sin,
      rotationDeg: normaliseDegrees((theta * 180) / Math.PI),
      scale,
      solvedScale,
      scaleDeviationPpm: options.lockScale === undefined
        ? null
        : ((solvedScale - options.lockScale) / options.lockScale) * 1e6,
      residuals,
      maxResidual,
      rmsResidual: Math.sqrt(sumSquares / n),
      worstPairIndex,
    },
  };
}

/**
 * To (-180, 180]. Two rotations a full turn apart are the same rotation, and
 * one shown as 359.7° reads as broken.
 *
 * Same convention as `normaliseDegrees` in the DXF aligner — kept here rather
 * than imported, because the georeferencing path has no business depending on
 * a DXF package for four lines of arithmetic. Shared with `fit-outline`, which
 * builds a solution directly when the rotation is held.
 */
export function normaliseDegrees(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}
