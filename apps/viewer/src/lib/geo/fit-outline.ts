/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Fitting a boundary modelled in a file onto the same boundary as surveyed.
 *
 * When a model carries its plot — an IfcSite outline, a flat site plate, a
 * terrain patch cut to the parcel — that outline and the official parcel
 * geometry are the same ring described twice. Laying one onto the other yields
 * the coordinate operation without anyone naming a single point.
 *
 * ## Why not compare bounding boxes
 *
 * Because it only works when the model happens to be axis-aligned, and says
 * nothing when it isn't. The extents of the case that prompted this agreed to
 * 2 and 8 cm, which was persuasive precisely because the plate was unrotated —
 * rotate the same plate 30° and its bounding box grows by tens of metres while
 * the outline is still a perfect match. The rotation has to be searched for.
 *
 * ## The method
 *
 * A coarse sweep over rotation, then closest-point refinement (ICP) with
 * {@link solveGeoreference} as the inner solver — so the transform arithmetic
 * lives in exactly one place and is the same code the reference-point table
 * uses.
 *
 * Two details that decide whether this works on real data:
 *
 * - **Area centroids, not vertex means.** A tessellated model outline carries
 *   hundreds of vertices along a curve and four along a straight run; the mean
 *   of its vertices sits wherever the mesher happened to put points. The
 *   shoelace centroid is a property of the shape, not of its sampling, so the
 *   two rings can be brought together before anything else is known.
 * - **A symmetric distance.** Measuring only model→parcel would score a small
 *   outline lying along one boundary edge as a superb fit. Measuring both ways
 *   makes covering the whole ring part of the score.
 *
 * ## What it cannot do
 *
 * Confirm that the outline IS the parcel. A modelled boundary might be a
 * setback line or a building footprint, and this will happily fit those too —
 * onto the wrong thing, with a plausible-looking error. The returned distances
 * are the caller's evidence, and a fit must never be applied without showing
 * them.
 */

import { solveGeoreference, type ControlPointPair, type GeoreferenceSolution } from './solve-georeference';

export interface Point2 { x: number; y: number }

export interface FitOutlineOptions {
  /**
   * Project length unit ÷ map unit, as IFC requires. The local ring is read in
   * project units and the map ring in map units; this bridges them and is
   * never solved for.
   */
  lockScale?: number;
  /** Rotation sweep step in degrees. */
  coarseStepDeg?: number;
  /**
   * Cap on how many vertices of each ring the sweep looks at. The sweep is
   * O(steps × |a| × |b|), and a tessellated outline brings far more points
   * than its shape needs. Refinement uses every vertex.
   */
  maxSweepVertices?: number;
  /** Closest-point refinement passes after the sweep. */
  icpIterations?: number;
}

export type FitOutlineResult =
  | {
    ok: true;
    solution: GeoreferenceSolution;
    /** Symmetric mean boundary distance after fitting, in map units. */
    meanDistance: number;
    /**
     * Worst single-vertex distance in EITHER direction, in map units.
     *
     * Symmetric like the mean, and for the same reason — but also because the
     * two are read side by side, and a max measured one way while the mean is
     * measured both ways can come out SMALLER than the mean. A live run on a
     * real site plate produced exactly that (mean 0.503 m against max 0.386 m),
     * which reads as a broken number rather than as the two different
     * measurements it was.
     */
    maxDistance: number;
  }
  | { ok: false; reason: 'degenerate-local' | 'degenerate-map' };

const DEFAULTS = {
  lockScale: 1,
  coarseStepDeg: 1,
  maxSweepVertices: 128,
  icpIterations: 4,
} as const;

/** A ring needs three distinct points to have a shape at all. */
const MIN_RING_VERTICES = 3;

/**
 * Centroid of the enclosed area (shoelace). Falls back to the vertex mean for
 * a ring of zero signed area — a degenerate or self-cancelling outline, where
 * the area centroid is undefined but the vertex mean is still somewhere sane.
 *
 * Computed about the ring's first vertex rather than about the coordinate
 * origin. The textbook formula cancels catastrophically at projected-CRS
 * magnitudes: for this module's own test parcel the individual cross products
 * run to 3e12 while twice the enclosed area is 2.2e4, so eight of float64's
 * sixteen digits are consumed by the subtraction alone, and the result then
 * depends on which vertex the ring happens to start at. Shifting to a local
 * origin first removes the common offset that causes it — the same reason a
 * georeferenced model keeps its geometry local and its position in
 * IfcMapConversion.
 */
export function polygonAreaCentroid(ring: readonly Point2[]): Point2 {
  const origin = ring[0];
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const ax = ring[i].x - origin.x;
    const ay = ring[i].y - origin.y;
    const next = ring[(i + 1) % ring.length];
    const bx = next.x - origin.x;
    const by = next.y - origin.y;
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    cx += (ax + bx) * cross;
    cy += (ay + by) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) { sx += p.x - origin.x; sy += p.y - origin.y; }
    return { x: origin.x + sx / ring.length, y: origin.y + sy / ring.length };
  }
  return {
    x: origin.x + cx / (3 * twiceArea),
    y: origin.y + cy / (3 * twiceArea),
  };
}

/** Closest point on a segment, clamped to its ends. */
function closestOnSegment(p: Point2, a: Point2, b: Point2): Point2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-18) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Closest point anywhere on a closed ring's boundary, and how far away it is. */
export function closestPointOnRing(p: Point2, ring: readonly Point2[]): { point: Point2; distance: number } {
  let best = ring[0];
  let bestSquared = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const candidate = closestOnSegment(p, ring[i], ring[(i + 1) % ring.length]);
    const dx = candidate.x - p.x;
    const dy = candidate.y - p.y;
    const squared = dx * dx + dy * dy;
    if (squared < bestSquared) {
      bestSquared = squared;
      best = candidate;
    }
  }
  return { point: best, distance: Math.sqrt(bestSquared) };
}

/** Evenly thin a ring to at most `limit` vertices, keeping its shape. */
function decimate(ring: readonly Point2[], limit: number): Point2[] {
  if (ring.length <= limit) return [...ring];
  const step = ring.length / limit;
  const out: Point2[] = [];
  for (let i = 0; i < limit; i += 1) out.push(ring[Math.floor(i * step)]);
  return out;
}

/** Mean distance from every vertex of `from` to the boundary of `to`. */
function meanDistanceToRing(from: readonly Point2[], to: readonly Point2[]): number {
  let total = 0;
  for (const p of from) total += closestPointOnRing(p, to).distance;
  return total / from.length;
}

/**
 * Both directions averaged. One direction alone rewards an outline that hugs a
 * single edge of the other and ignores the rest.
 */
function symmetricMeanDistance(a: readonly Point2[], b: readonly Point2[]): number {
  return (meanDistanceToRing(a, b) + meanDistanceToRing(b, a)) / 2;
}

function rotateAbout(ring: readonly Point2[], pivot: Point2, cos: number, sin: number, target: Point2): Point2[] {
  return ring.map((p) => {
    const dx = p.x - pivot.x;
    const dy = p.y - pivot.y;
    return {
      x: target.x + dx * cos - dy * sin,
      y: target.y + dx * sin + dy * cos,
    };
  });
}

/**
 * Fit `localRing` (model plan coordinates, project length unit) onto
 * `mapRing` (map units) and return the coordinate operation that does it.
 *
 * The rings need not share a vertex count, a starting vertex, or a winding
 * direction — only a shape.
 */
export function fitOutline(
  localRing: readonly Point2[],
  mapRing: readonly Point2[],
  options: FitOutlineOptions = {},
): FitOutlineResult {
  const { lockScale, coarseStepDeg, maxSweepVertices, icpIterations } = { ...DEFAULTS, ...options };

  if (localRing.length < MIN_RING_VERTICES) return { ok: false, reason: 'degenerate-local' };
  if (mapRing.length < MIN_RING_VERTICES) return { ok: false, reason: 'degenerate-map' };

  // Work in map units throughout: scaling the local ring up front means the
  // sweep compares like with like, and the scale never becomes a free
  // parameter of the search.
  const scaledLocal = localRing.map(p => ({ x: p.x * lockScale, y: p.y * lockScale }));
  const localCentroid = polygonAreaCentroid(scaledLocal);
  const mapCentroid = polygonAreaCentroid(mapRing);

  const sweepLocal = decimate(scaledLocal, maxSweepVertices);
  const sweepMap = decimate(mapRing, maxSweepVertices);

  // ── Coarse sweep ────────────────────────────────────────────────────────
  let bestTheta = 0;
  let bestScore = Infinity;
  const stepRad = (coarseStepDeg * Math.PI) / 180;
  for (let theta = 0; theta < 2 * Math.PI; theta += stepRad) {
    const placed = rotateAbout(sweepLocal, localCentroid, Math.cos(theta), Math.sin(theta), mapCentroid);
    const score = symmetricMeanDistance(placed, sweepMap);
    if (score < bestScore) {
      bestScore = score;
      bestTheta = theta;
    }
  }

  // ── Narrow the bracket ──────────────────────────────────────────────────
  // Successive halving around the winner. The objective is not smooth enough
  // for a derivative method, but it is unimodal within one coarse step, which
  // is all bisection needs.
  let span = stepRad;
  for (let pass = 0; pass < 12; pass += 1) {
    span /= 2;
    for (const candidate of [bestTheta - span, bestTheta + span]) {
      const placed = rotateAbout(sweepLocal, localCentroid, Math.cos(candidate), Math.sin(candidate), mapCentroid);
      const score = symmetricMeanDistance(placed, sweepMap);
      if (score < bestScore) {
        bestScore = score;
        bestTheta = candidate;
      }
    }
  }

  // ── Closest-point refinement ────────────────────────────────────────────
  // Every local vertex is paired with the point it sits nearest on the parcel
  // boundary, and solveGeoreference re-solves the whole transform from those
  // pairs. Repeating tightens the correspondences. The pairs use the ORIGINAL
  // local coordinates so the locked scale does its documented job inside the
  // solver rather than being applied twice.
  let cos = Math.cos(bestTheta);
  let sin = Math.sin(bestTheta);
  let eastings = mapCentroid.x - (localCentroid.x * cos - localCentroid.y * sin);
  let northings = mapCentroid.y - (localCentroid.x * sin + localCentroid.y * cos);
  let solution: GeoreferenceSolution | null = null;

  for (let iteration = 0; iteration < icpIterations; iteration += 1) {
    const pairs: ControlPointPair[] = [];
    for (let i = 0; i < localRing.length; i += 1) {
      const scaled = scaledLocal[i];
      const placed = {
        x: eastings + scaled.x * cos - scaled.y * sin,
        y: northings + scaled.x * sin + scaled.y * cos,
      };
      pairs.push({
        local: localRing[i],
        map: (({ point }) => ({ easting: point.x, northing: point.y }))(closestPointOnRing(placed, mapRing)),
      });
    }

    const solved = solveGeoreference(pairs, { lockScale });
    if (!solved.ok) break;
    solution = solved.solution;
    cos = solution.xAxisAbscissa;
    sin = solution.xAxisOrdinate;
    eastings = solution.eastings;
    northings = solution.northings;
  }

  if (!solution) {
    // Every local vertex mapped onto the same boundary point — the outline has
    // no extent the parcel can distinguish.
    return { ok: false, reason: 'degenerate-local' };
  }

  // Score the finished fit on the full rings, not the decimated ones.
  const placedFull = scaledLocal.map(p => ({
    x: eastings + p.x * cos - p.y * sin,
    y: northings + p.x * sin + p.y * cos,
  }));
  let maxDistance = 0;
  for (const p of placedFull) {
    const { distance } = closestPointOnRing(p, mapRing);
    if (distance > maxDistance) maxDistance = distance;
  }
  // The other direction too: a parcel corner the outline never reaches is a
  // mismatch the forward pass cannot see, and leaving it out lets the max
  // fall below the symmetric mean.
  for (const p of mapRing) {
    const { distance } = closestPointOnRing(p, placedFull);
    if (distance > maxDistance) maxDistance = distance;
  }

  return {
    ok: true,
    solution,
    meanDistance: symmetricMeanDistance(placedFull, mapRing),
    maxDistance,
  };
}
