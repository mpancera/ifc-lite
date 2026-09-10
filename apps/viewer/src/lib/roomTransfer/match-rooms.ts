/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Carry room numbers from one model's spaces onto another's, by where the
 * rooms are.
 *
 * # Why this exists
 *
 * Rooms get re-derived. The walls come back from the architect remodelled, the
 * detection improves, a storey is redone — and the geometry is cheap to make
 * again while the NUMBERING is not. A room number is a decision: it was agreed
 * with the client, it is printed on a door, it is quoted in a fire concept, and
 * somebody spent an afternoon on the sequence. Re-deriving the rooms and
 * retyping seventy numbers is how a plan acquires typos nobody catches until
 * the wrong door gets a detector.
 *
 * So the geometry is thrown away and the names are kept, matched by position.
 *
 * # The offset is found, not asked for
 *
 * Two models of one building rarely share an origin: they are exported at
 * different times, with different site placements, sometimes different units.
 * Asking the user for the offset means asking them to measure it, and a wrong
 * answer silently numbers every room after its neighbour.
 *
 * Instead every (source, target) pair proposes the translation that would make
 * those two coincide. The proposals are binned to find where they crowd, and
 * the best few crowds are then each refined against ALL the rooms: match every
 * target to its nearest source, keep the ones that landed close, re-average.
 * Whichever hypothesis ends up explaining the most rooms wins.
 *
 * The refinement is not a flourish. Rooms move by a metre or two between two
 * states of a building, which is enough to spread the correct translation
 * across several bins and leave the tallest bin holding two votes by luck —
 * measured on the case this was built for, the raw peak was 5 m wrong, while
 * refinement found the transform that put fourteen of twenty-one rooms within
 * a metre. Bins are a good way to find candidates and a bad way to choose
 * between them.
 *
 * # The turn is solved for too
 *
 * Two exports of one building are usually TURNED as well: georeference one of
 * them and the site's true-north angle is baked into every coordinate. That
 * angle is not searched for here — it is measured from each plan's own walls
 * (`plan-axis.ts`) and handed in, so the search stays one-dimensional. What is
 * left is which quarter turn: an axis is only known modulo 90°, so the caller
 * passes the few candidates and the one that explains the most rooms is kept.
 * A wrong quarter turn cannot pass, because a plan laid across its own
 * footprint matches almost nothing.
 *
 * # One storey at a time
 *
 * The caller pairs the storeys, because elevations do not survive a remodel:
 * the same storey can sit at 7.47 m in one file and 8.23 m in the other, while
 * its NAME is stable. Matching in 3D would either miss those or, worse, pair a
 * room with the one above it.
 */

export type Pt = [number, number];

/** A room that carries a name, and the position it carries it at. */
export interface SourceRoom {
  id: number;
  name: string | null;
  longName: string | null;
  centre: Pt;
}

/** A room that needs one. */
export interface TargetRoom {
  id: number;
  centre: Pt;
}

export interface RoomMatch {
  target: number;
  source: number;
  /** Between the two centres once the offset is applied, in metres. */
  distance: number;
  /** How much further away the runner-up was. Under `ambiguousRatio` the
   *  match is reported as ambiguous rather than applied silently. */
  runnerUpRatio: number;
}

export interface TransferPlan {
  /** Degrees the source plan was turned by, about its own centre, first. */
  rotationDeg: number;
  /** Added to a source centre AFTER that turn, to land on its target. */
  offset: Pt;
  /** How many rooms the transform actually brought together — the confidence
   *  in it, and the thing that decided it against the alternatives. */
  votes: number;
  matched: RoomMatch[];
  /** Matched, but a second source was nearly as close. Decide these by hand. */
  ambiguous: RoomMatch[];
  /** Targets with no source within `maxDistance`. */
  unmatchedTargets: number[];
  /** Sources whose name was not placed on anything. */
  unusedSources: number[];
}

export interface MatchOptions {
  /** Bin width for the translation vote, metres. Wide enough that pairs of the
   *  same rooms land together despite a remodel, narrow enough that two
   *  different offsets do not. */
  binSize?: number;
  /** A source further than this from a target (after the offset) is not that
   *  target's room, however near it happens to be. */
  maxDistance?: number;
  /** A match whose runner-up is within this multiple of the winner's distance
   *  is reported as ambiguous. 1 would mean a tie; 1.5 means "not clearly
   *  better than the next one". */
  ambiguousRatio?: number;
  /** How close a room must land to count as evidence FOR a hypothesis. Well
   *  under the spacing of rooms, so a transform cannot be credited for putting
   *  a name vaguely in the right part of the building. */
  consensusRadius?: number;
}

const DEFAULTS: Required<MatchOptions> = {
  binSize: 0.5,
  maxDistance: 4,
  ambiguousRatio: 1.5,
  consensusRadius: 1.5,
};

/** How many crowded bins are worth refining. The right answer has never been
 *  far down this list; going deeper costs time and finds nothing. */
const SEEDS = 8;
/** Passes of re-fitting. Each lets rooms that were just outside the radius
 *  pull the answer, and it settles well before this many. */
const REFINEMENTS = 4;

/** Turn a set of rooms about its own centre, so the numbers stay small even
 *  when the coordinates are a national grid's. */
function turn(rooms: readonly SourceRoom[], deg: number): readonly SourceRoom[] {
  if (!deg || rooms.length === 0) return rooms;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const mx = rooms.reduce((t, r) => t + r.centre[0], 0) / rooms.length;
  const my = rooms.reduce((t, r) => t + r.centre[1], 0) / rooms.length;
  return rooms.map((r) => {
    const dx = r.centre[0] - mx;
    const dy = r.centre[1] - my;
    return { ...r, centre: [mx + dx * cos - dy * sin, my + dx * sin + dy * cos] as Pt };
  });
}

/**
 * The translation that brings the most rooms together.
 *
 * Candidates come from binning every pair's translation; each of the best few
 * is then refined against all the rooms and scored by how many land within
 * `consensusRadius`. Returns `null` when nothing explains at least two rooms:
 * one pair agreeing with itself is not evidence, it is arithmetic.
 */
export function findOffset(
  sources: readonly SourceRoom[],
  targets: readonly TargetRoom[],
  options: Pick<MatchOptions, 'binSize' | 'consensusRadius'> = {},
): { offset: Pt; votes: number } | null {
  const { binSize, consensusRadius } = { ...DEFAULTS, ...options };
  if (sources.length === 0 || targets.length === 0) return null;

  const bins = new Map<string, { sum: Pt; n: number }>();
  for (const s of sources) {
    for (const t of targets) {
      const dx = t.centre[0] - s.centre[0];
      const dy = t.centre[1] - s.centre[1];
      const key = `${Math.round(dx / binSize)},${Math.round(dy / binSize)}`;
      const bin = bins.get(key) ?? { sum: [0, 0] as Pt, n: 0 };
      bin.sum[0] += dx;
      bin.sum[1] += dy;
      bin.n += 1;
      bins.set(key, bin);
    }
  }

  /** Re-fit an offset to the rooms it already brings together. */
  const refine = (offset: Pt): { offset: Pt; votes: number } => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const t of targets) {
      let best = Infinity;
      let winner: SourceRoom | null = null;
      for (const s of sources) {
        const d = Math.hypot(
          t.centre[0] - (s.centre[0] + offset[0]),
          t.centre[1] - (s.centre[1] + offset[1]),
        );
        if (d < best) {
          best = d;
          winner = s;
        }
      }
      if (winner && best <= consensusRadius) {
        sx += t.centre[0] - winner.centre[0];
        sy += t.centre[1] - winner.centre[1];
        n += 1;
      }
    }
    return n > 0 ? { offset: [sx / n, sy / n], votes: n } : { offset, votes: 0 };
  };

  const seeds = [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, SEEDS)
    .map((b) => [b.sum[0] / b.n, b.sum[1] / b.n] as Pt);

  let best: { offset: Pt; votes: number } | null = null;
  for (const seed of seeds) {
    let cur = refine(seed);
    for (let i = 0; i < REFINEMENTS && cur.votes > 0; i++) cur = refine(cur.offset);
    if (!best || cur.votes > best.votes) best = cur;
  }
  return best && best.votes >= 2 ? best : null;
}

/**
 * Plan which source room's name goes on which target room.
 *
 * Matching is mutual-nearest: a pair is kept only when each is the other's
 * closest. A greedy nearest-first pass would let one crowded corner consume a
 * name its neighbour needed, and the mistake would look like a correct match
 * from either end.
 *
 * `rotations` are the turns worth trying, in degrees — see the header. Each is
 * planned in full and the one that places the most names is returned, so the
 * caller need not know which quarter turn its axis measurement meant.
 */
export function planRoomTransfer(
  sources: readonly SourceRoom[],
  targets: readonly TargetRoom[],
  options: MatchOptions & { offset?: Pt; rotations?: readonly number[] } = {},
): TransferPlan | null {
  const rotations = options.rotations?.length ? options.rotations : [0];
  if (rotations.length > 1) {
    let best: TransferPlan | null = null;
    for (const deg of rotations) {
      const plan = planRoomTransfer(sources, targets, { ...options, rotations: [deg] });
      if (plan && (!best || plan.matched.length > best.matched.length)) best = plan;
    }
    return best;
  }

  const rotationDeg = rotations[0];
  const turned = turn(sources, rotationDeg);
  const opts = { ...DEFAULTS, ...options };
  const found = options.offset
    ? { offset: options.offset, votes: 0 }
    : findOffset(turned, targets, opts);
  if (!found) return null;
  const [ox, oy] = found.offset;

  /** Distances from every target to every source, with the offset applied. */
  const dist = (t: TargetRoom, s: SourceRoom) =>
    Math.hypot(t.centre[0] - (s.centre[0] + ox), t.centre[1] - (s.centre[1] + oy));

  const rank = <A, B>(a: A, list: readonly B[], d: (a: A, b: B) => number) => {
    let best: { item: B; d: number } | null = null;
    let second = Infinity;
    for (const b of list) {
      const dd = d(a, b);
      if (!best || dd < best.d) {
        second = best ? best.d : second;
        best = { item: b, d: dd };
      } else if (dd < second) {
        second = dd;
      }
    }
    return best ? { best: best.item, d: best.d, second } : null;
  };

  const matched: RoomMatch[] = [];
  const ambiguous: RoomMatch[] = [];
  const unmatchedTargets: number[] = [];
  const takenSources = new Set<number>();

  for (const t of targets) {
    const r = rank(t, turned, dist);
    if (!r || r.d > opts.maxDistance) {
      unmatchedTargets.push(t.id);
      continue;
    }
    // Mutual: the source has to want this target back.
    const back = rank(r.best, targets, (s, tt) => dist(tt, s));
    if (!back || back.best.id !== t.id) {
      unmatchedTargets.push(t.id);
      continue;
    }
    const ratio = r.second === Infinity ? Infinity : r.second / Math.max(r.d, 1e-9);
    const m: RoomMatch = { target: t.id, source: r.best.id, distance: r.d, runnerUpRatio: ratio };
    if (ratio < opts.ambiguousRatio) ambiguous.push(m);
    else matched.push(m);
    takenSources.add(r.best.id);
  }

  return {
    rotationDeg,
    offset: found.offset,
    votes: found.votes,
    matched,
    ambiguous,
    unmatchedTargets,
    unusedSources: turned.filter((s) => !takenSources.has(s.id)).map((s) => s.id),
  };
}
