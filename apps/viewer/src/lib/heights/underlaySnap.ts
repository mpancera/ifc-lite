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
 * A vertex of the drawn plan within `tolerance`, or `null`.
 *
 * **Vertices only, not points along an edge.** A person aligning two drawings
 * picks corners, and an edge snap sliding along a wall would land somewhere
 * that cannot be found again on the other drawing — which is exactly what has
 * to match.
 *
 * **A SHARED vertex beats a nearer lone one.** The nearest vertex is the wrong
 * answer on a real drawing: a hatch is drawn as hundreds of separate strokes,
 * so within ten pixels of anywhere inside a hatched room there are dozens of
 * stroke ends and the corner you are aiming at is never the closest of them.
 * On the plan this was found with, 8207 of 11864 lines were hatch strokes —
 * two thirds of the drawing, all of it noise for this purpose (Marc,
 * 2026-09-15: "die Passlinie kann immer noch nicht gesnappt werden").
 *
 * Where lines MEET is what a corner is. A stroke end belongs to one line, a
 * wall corner to two or more, and ranking by that costs one pass and needs to
 * know nothing about layers or line types — a drawing that names its hatch
 * layer something else is handled by the same rule.
 */
export function snapToUnderlay(
  drawn: SnapLines | null | undefined,
  point: Point,
  tolerance: number,
): Point | null {
  const lines = drawn?.lines ?? [];

  // How many line ENDS meet at each vertex. Quantised to a millimetre, because
  // two lines that share a corner in the drawing rarely share the bit pattern.
  const shared = new Map<string, number>();
  const key = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  for (const line of lines) {
    for (const vertex of line.points) {
      const k = key(vertex);
      shared.set(k, (shared.get(k) ?? 0) + 1);
    }
  }

  // Hidden layers need no special case: a layer switched off is not in the
  // drawn lines, so it cannot be caught.
  let best: Point | null = null;
  let bestRank = -1;
  let bestDist = tolerance;
  for (const line of lines) {
    for (const vertex of line.points) {
      const dist = Math.hypot(vertex.x - point.x, vertex.y - point.y);
      if (dist >= tolerance) continue;
      const rank = shared.get(key(vertex)) ?? 1;
      // Rank first, distance second. A corner slightly further away is the
      // point being aimed at; the nearer stroke end is not.
      if (rank > bestRank || (rank === bestRank && dist < bestDist)) {
        bestRank = rank;
        bestDist = dist;
        best = vertex;
      }
    }
  }

  return best;
}
