/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Correcting a model's georeference against a surveyed building.
 *
 * The opposite direction from a drawing underlay: there the plan is moved onto
 * the model, here the MODEL is moved onto what was measured on site. The
 * machinery is the same either way — {@link fitOutline} only ever wanted two
 * rings — so this module is the small amount that is specific to the building
 * case: the unit bridge, the CRS check, and the two numbers a person needs to
 * decide whether the fit may be applied.
 *
 * ## The rotation is normally held
 *
 * The usual defect is a model placed at the wrong point but built on the right
 * bearing, and searching for the angle then does harm rather than nothing. Two
 * footprints never agree exactly — survey tolerance, a roof overhang, a bay
 * window in one source and not the other — and a free sweep spends that
 * disagreement on a degree or two of rotation that looks like a better fit
 * while quietly turning the building. Held, the disagreement stays visible in
 * the residual, which is where it can be judged.
 *
 * ## What the residual does not mean
 *
 * The model footprint is the silhouette from above, so it includes the roof
 * overhang. swissBUILDINGS3D is likewise the outer hull. Against a reference
 * surveyed at the facade instead, the two differ by the overhang ALL THE WAY
 * ROUND: a uniform gap, not a position error, and moving the model would not
 * close it. {@link looksLikeUniformInset} names that case so the panel can say
 * it rather than leaving a plausible-looking half-metre unexplained.
 */

import { fitOutline, type FitOutlineResult, type Point2 } from './fit-outline';
import { metreFitToMapConversion, type MapConversionAttributes } from './mesh-to-map';
import { normaliseEpsg } from './reference-outline';

export interface FootprintFitRequest {
  /** The model's own footprint, IFC plan coordinates in METRES. */
  localRing: readonly Point2[];
  /** The surveyed outline, in the CRS's MAP UNIT. */
  referenceRing: readonly Point2[];
  /** Map unit → metres (1 for METRE). */
  mapUnitScale: number;
  /** Project length unit → metres (0.001 for a millimetre file). */
  lengthUnitScale: number;
  /**
   * Hold the map rotation at this angle, degrees counter-clockwise. Omit to
   * search for it — see the note above on why holding is the default the panel
   * offers.
   */
  lockRotationDeg?: number;
}

export interface FootprintFitReport {
  /** The five `IfcMapConversion` numbers, in map units. */
  attributes: MapConversionAttributes;
  /** The map rotation of the fit, degrees CCW. Equals the lock when held. */
  rotationDeg: number;
  rotationWasHeld: boolean;
  /** Symmetric mean boundary distance after fitting, METRES. */
  meanDistance: number;
  /** Worst single-vertex distance in either direction, METRES. */
  maxDistance: number;
  /** Vertices in the model footprint that was fitted. */
  localVertexCount: number;
  /** Vertices in the reference outline. */
  referenceVertexCount: number;
}

export type FootprintFitResult =
  | { ok: true; report: FootprintFitReport }
  | { ok: false; reason: 'degenerate-local' | 'degenerate-map' };

/**
 * Fit a model footprint onto a surveyed outline and return the coordinate
 * operation that does it.
 *
 * Everything is fitted in metres. The reference arrives in the map unit, which
 * for every Swiss and most European CRSs is the metre — but not for a US survey
 * foot grid, and reading feet as metres would put the building a third of the
 * way out of its own plot while the residual still looked ordinary. So the
 * reference is converted first, the fit runs metre against metre with its scale
 * a plain 1, and {@link metreFitToMapConversion} puts the units back afterwards.
 */
export function fitFootprintToReference(request: FootprintFitRequest): FootprintFitResult {
  const mapUnitScale = request.mapUnitScale > 0 ? request.mapUnitScale : 1;
  const referenceInMetres = mapUnitScale === 1
    ? request.referenceRing
    : request.referenceRing.map(p => ({ x: p.x * mapUnitScale, y: p.y * mapUnitScale }));

  const fit: FitOutlineResult = fitOutline(request.localRing, referenceInMetres, {
    lockScale: 1,
    ...(request.lockRotationDeg === undefined ? {} : { lockRotationDeg: request.lockRotationDeg }),
  });
  if (!fit.ok) return { ok: false, reason: fit.reason };

  return {
    ok: true,
    report: {
      attributes: metreFitToMapConversion(fit.solution, mapUnitScale, request.lengthUnitScale),
      rotationDeg: fit.solution.rotationDeg,
      rotationWasHeld: request.lockRotationDeg !== undefined,
      meanDistance: fit.meanDistance,
      maxDistance: fit.maxDistance,
      localVertexCount: request.localRing.length,
      referenceVertexCount: request.referenceRing.length,
    },
  };
}

/**
 * How far the model's placement would move, in metres.
 *
 * The residual says whether the fit is good; this says whether it is a
 * correction anyone asked for. A metre or two is a georeference being tidied
 * up. Two hundred metres means the reference file is a different building, and
 * that is worth seeing before the button is pressed rather than after.
 *
 * `null` when there is no placement yet — nothing moves, it is being set.
 */
export function placementShiftMetres(
  current: { eastings?: number; northings?: number } | undefined,
  next: MapConversionAttributes,
  mapUnitScale: number,
): number | null {
  if (current?.eastings === undefined || current?.northings === undefined) return null;
  const scale = mapUnitScale > 0 ? mapUnitScale : 1;
  return Math.hypot(next.eastings - current.eastings, next.northings - current.northings) * scale;
}

/**
 * Whether the residual sits at roughly the same distance the whole way round.
 *
 * Offsetting a ring inward by `d` leaves every edge `d` from its counterpart and
 * every corner `d√2`, so a uniform inset caps the max at about 1.41 × the mean
 * while a genuine position or shape error spreads them much further apart. The
 * threshold sits a little above √2 to leave room for the raster's own stepping.
 *
 * Below `MIN_UNIFORM_INSET` there is nothing to explain: that is survey
 * tolerance plus the footprint's cell size, and calling it an overhang would
 * invent a cause for noise.
 */
export function looksLikeUniformInset(meanDistance: number, maxDistance: number): boolean {
  if (!(meanDistance > MIN_UNIFORM_INSET)) return false;
  return maxDistance < meanDistance * UNIFORM_INSET_RATIO;
}

/** Metres. Under this, the gap is tolerance rather than a systematic offset. */
const MIN_UNIFORM_INSET = 0.15;
const UNIFORM_INSET_RATIO = 1.6;

/**
 * Whether two CRS names describe the same system.
 *
 * `unknown` is a real third answer and not a failure: `CH1903+ / LV95` names a
 * system without carrying a code, and a name-to-name string comparison would
 * turn that into a false mismatch. What this exists to catch is the file that
 * says 21781 while the model says 2056 — the two Swiss grids are 100-odd metres
 * apart, close enough that the fit succeeds and far enough that the building
 * ends up in the wrong place.
 */
export type CrsAgreement = 'match' | 'mismatch' | 'unknown';

export function compareCrsNames(a: string | undefined, b: string | undefined): CrsAgreement {
  const left = a ? normaliseEpsg(a) : null;
  const right = b ? normaliseEpsg(b) : null;
  if (!left || !right) return 'unknown';
  return left === right ? 'match' : 'mismatch';
}
