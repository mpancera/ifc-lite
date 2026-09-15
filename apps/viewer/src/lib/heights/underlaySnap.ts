/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Snapping a click onto the imported plan.
 *
 * The measure tool already snaps to the MODEL section. Aligning needs the
 * other half: the fitting line is drawn on the plan, and it has to catch the
 * plan's own corners — a wall end, an axis crossing — because those are the
 * features somebody picks when they say "this is that".
 *
 * Kept separate from the model's snapping on purpose. Snapping both to
 * whatever happens to be nearest would quietly pull a plan point onto the very
 * geometry the plan is being aligned against, which then looks like a perfect
 * fit and is really a tautology.
 *
 * Works in DRAWING space, and takes the lines AS DRAWN rather than the stored
 * underlay. That is not a convenience: the stored geometry is in world plan
 * coordinates, and reaching drawing space means the placement AND the render
 * frame — the origin shift, the mirror of a flipped section, the map
 * transform of a georeferenced plan. Applying only the placement, which is
 * what this did, left every snap target displaced by the model's origin shift:
 * on a georeferenced model the markers sat far from the lines they belonged to
 * and nothing caught (Marc, 2026-09-15). Snapping to what is drawn cannot
 * disagree with what is drawn.
 */

interface Point {
  x: number;
  y: number;
}

/** The lines of one underlay, already mapped into drawing space. */
export interface SnapLines {
  readonly lines: ReadonlyArray<{ readonly points: readonly Point[] }>;
}

/**
 * A point of the drawn plan worth catching, within `tolerance`, or `null`.
 *
 * Three kinds of candidate, and the order between them is the whole point:
 *
 * 1. **Where lines CROSS.** A CAD plan draws wall faces as long lines that run
 *    through a junction; the corner you see is where two of them cross, and
 *    there is no vertex there at all. Snapping to vertices alone left a clean
 *    wall corner catching nothing (Marc, 2026-09-15: "sitzt sauber auf einer
 *    Wandecke des DXF"), which is the failure this was rewritten for.
 * 2. **A SHARED vertex**, where two or more lines end at the same place. Also
 *    a corner, drawn by a plan that trims its lines instead of crossing them.
 * 3. **A lone vertex** last. On a real drawing most of these are hatch strokes
 *    — 8207 of 11864 lines on the plan this was found with — and they are the
 *    reason a nearest-point rule catches noise: they are everywhere, and one
 *    of them is always closer than the corner.
 *
 * Never a point along an edge. A point picked halfway down a wall cannot be
 * found again on the other drawing, and finding the same feature twice is the
 * entire job of a two-point alignment.
 */
/** Rank of a candidate: a crossing and a shared end are corners, a lone end
 *  is usually noise. Distance only breaks ties within a rank. */
const RANK_CROSSING = 3;
const RANK_SHARED = 2;
const RANK_LONE = 1;

interface Segment { a: Point; b: Point }

/** Segments whose own extent comes near `point` — the only ones that can
 *  contribute a candidate, and a cheap way to avoid comparing 12000 lines
 *  against each other. */
function segmentsNear(drawn: SnapLines | null | undefined, point: Point, reach: number): Segment[] {
  const out: Segment[] = [];
  for (const line of drawn?.lines ?? []) {
    // A one-point path — a marker, a POINT entity — is a place worth catching
    // and has no segment. Emitted as a degenerate one so the vertex pass sees
    // it; `crossing` rejects it, which is right, as it crosses nothing.
    if (line.points.length === 1) {
      const p = line.points[0];
      if (Math.abs(p.x - point.x) <= reach && Math.abs(p.y - point.y) <= reach) {
        out.push({ a: p, b: p });
      }
      continue;
    }
    for (let i = 0; i + 1 < line.points.length; i += 1) {
      const a = line.points[i];
      const b = line.points[i + 1];
      if (Math.min(a.x, b.x) - reach > point.x || Math.max(a.x, b.x) + reach < point.x) continue;
      if (Math.min(a.y, b.y) - reach > point.y || Math.max(a.y, b.y) + reach < point.y) continue;
      out.push({ a, b });
    }
  }
  return out;
}

/** Where two segments cross, or `null` — parallel, or crossing outside their
 *  own extents. An "apparent" intersection off the end of a line is somewhere
 *  neither drawing has anything, so it is not offered. */
function crossing(p: Segment, q: Segment): Point | null {
  const r = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
  const s = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-12) return null;
  const dx = q.a.x - p.a.x;
  const dy = q.a.y - p.a.y;
  const t = (dx * s.y - dy * s.x) / denominator;
  const u = (dx * r.y - dy * r.x) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p.a.x + r.x * t, y: p.a.y + r.y * t };
}

export function snapToUnderlay(
  drawn: SnapLines | null | undefined,
  point: Point,
  tolerance: number,
): Point | null {
  let best: Point | null = null;
  let bestRank = 0;
  let bestDist = Infinity;

  const consider = (candidate: Point, rank: number) => {
    const dist = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (dist >= tolerance) return;
    if (rank > bestRank || (rank === bestRank && dist < bestDist)) {
      best = candidate;
      bestRank = rank;
      bestDist = dist;
    }
  };

  // Hidden layers need no special case: a layer switched off is not in the
  // drawn lines, so it cannot be caught.
  const near = segmentsNear(drawn, point, tolerance);

  // How many line ends meet at each place. Quantised to a millimetre, because
  // two lines that share a corner rarely share the bit pattern.
  const shared = new Map<string, number>();
  const key = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  for (const line of drawn?.lines ?? []) {
    for (const vertex of line.points) shared.set(key(vertex), (shared.get(key(vertex)) ?? 0) + 1);
  }

  for (const segment of near) {
    for (const vertex of [segment.a, segment.b]) {
      consider(vertex, (shared.get(key(vertex)) ?? 1) > 1 ? RANK_SHARED : RANK_LONE);
    }
  }
  for (let i = 0; i < near.length; i += 1) {
    for (let j = i + 1; j < near.length; j += 1) {
      const hit = crossing(near[i], near[j]);
      if (hit) consider(hit, RANK_CROSSING);
    }
  }

  return best;
}

/**
 * Every place near `point` that a click would actually catch, nearest first.
 *
 * The same three kinds `snapToUnderlay` takes, so what is drawn and what is
 * caught cannot disagree. Showing vertices alone would point at the ends of
 * wall lines while the snap takes the crossings between them — advice that is
 * worse than none.
 *
 * `limit` because a dense plan has hundreds within any radius worth drawing,
 * and a screen full of dots is its own kind of blindness.
 */
export function underlaySnapTargetsNear(
  drawn: SnapLines | null | undefined,
  point: Point,
  radius: number,
  limit = 40,
): Point[] {
  const near = segmentsNear(drawn, point, radius);
  const found: Array<{ p: Point; d: number }> = [];
  const seen = new Set<string>();
  const key = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

  const add = (candidate: Point) => {
    const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (d > radius) return;
    const k = key(candidate);
    // One dot per place, however many lines meet there.
    if (seen.has(k)) return;
    seen.add(k);
    found.push({ p: candidate, d });
  };

  for (const segment of near) {
    add(segment.a);
    add(segment.b);
  }
  for (let i = 0; i < near.length; i += 1) {
    for (let j = i + 1; j < near.length; j += 1) {
      const hit = crossing(near[i], near[j]);
      if (hit) add(hit);
    }
  }

  found.sort((a, b) => a.d - b.d);
  return found.slice(0, limit).map((f) => f.p);
}
