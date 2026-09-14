/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Put a DXF underlay roughly where it belongs, before anybody picks a point.
 *
 * Centring alone is not enough. It leaves the drawing turned — nine degrees on
 * a georeferenced model, ninety when the sheet was set up on a different axis —
 * and a plan lying across the model is hard to pick corresponding points on,
 * which is exactly what the two-point alignment then asks you to do. The gross
 * transform should come from the drawings themselves; the two points are for
 * the correction (Marc, 2026-09-15).
 *
 * # The rotation comes from the direction histogram
 *
 * A building's walls point in a handful of directions. The histogram of those
 * directions is the same shape in the drawing and in the model, merely turned,
 * so cross-correlating the two reads the angle off without knowing which wall
 * is which. Taken modulo 180 degrees, because a wall drawn left to right and
 * the same wall drawn right to left are one wall.
 *
 * That leaves a QUARTER-TURN ambiguity: an orthogonal building's histogram has
 * peaks every ninety degrees, so four candidates score alike. Two things tell
 * them apart. The bounding box settles the quarter — a turned drawing should
 * be as wide and as tall as the model. The half-turn survives that, because a
 * box is the same box upside down, and is settled by where the line work sits
 * INSIDE the box: an L-shaped plan has its weight off-centre, and a half-turn
 * puts it on the opposite side. A centrally symmetric plan defeats both, and
 * then the two-point line is the honest place for it.
 *
 * # The scale is only guessed when it is grossly wrong
 *
 * Tempting to take the ratio of the two bounding boxes. That is wrong here for
 * an ordinary reason: a floor plan usually draws more than the building — the
 * plot, a neighbouring wing, a north arrow off to one side — so the ratio is
 * some number near but not at one, and applying it shrinks a correct drawing.
 * A factor of a thousand, on the other hand, is a unit that was never
 * declared, and that IS worth correcting. So the estimate is snapped to a
 * power of ten and anything within a factor of two of one is left alone.
 */

import type { Point2D } from '../types.js';
import type { DxfPlacement } from './types.js';

/** A polyline. Only its segment directions and extent are read. */
export type Polyline = readonly Point2D[];

export interface PrealignResult {
  placement: DxfPlacement;
  /** Clockwise degrees, as `DxfPlacement` counts them. */
  rotationDeg: number;
  scale: number;
  /**
   * How strongly the two direction histograms agreed at the chosen angle,
   * relative to their average agreement: 1 means no better than chance.
   * Below ~1.5 the rotation is a guess and the caller should say so.
   */
  sharpness: number;
}

const BINS = 720;

interface Segment { dx: number; dy: number; length: number }

function segmentsOf(lines: readonly Polyline[], minLength: number): Segment[] {
  const out: Segment[] = [];
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      const dx = line[i + 1].x - line[i].x;
      const dy = line[i + 1].y - line[i].y;
      const length = Math.hypot(dx, dy);
      // Short segments are stair-steps, arc facets and hatch ticks. They
      // outnumber the walls and point everywhere.
      if (length >= minLength) out.push({ dx, dy, length });
    }
  }
  return out;
}

/** Direction histogram, modulo 180 degrees, weighted by length. */
function histogram(segments: readonly Segment[]): number[] {
  const h = new Array<number>(BINS).fill(0);
  for (const s of segments) {
    let a = Math.atan2(s.dy, s.dx) % Math.PI;
    if (a < 0) a += Math.PI;
    // Length-weighted: one long wall says more about a building's orientation
    // than twenty short jogs, and counting entities alone lets a dense hatch
    // outvote the walls.
    h[Math.min(BINS - 1, Math.floor((a / Math.PI) * BINS))] += s.length;
  }
  return h;
}

function boundsOf(lines: readonly Polyline[]): { w: number; h: number; cx: number; cy: number } | null {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const line of lines) {
    for (const p of line) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Rotate by `rad` counter-clockwise and scale about the origin. */
function turned(lines: readonly Polyline[], rad: number, scale: number): Polyline[] {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return lines.map((line) => line.map((p) => ({
    x: (p.x * c - p.y * s) * scale,
    y: (p.x * s + p.y * c) * scale,
  })));
}

/**
 * How badly a turned drawing's box disagrees with the model's.
 *
 * Width and height SEPARATELY, and that is the whole point: a ratio of the
 * two — an aspect — is identical for a shape and the same shape turned a
 * quarter, which is precisely the ambiguity this has to resolve. Compared as
 * logarithms so a drawing that shows twice as much as the building is still
 * the right shape.
 */
function boxMiss(b: { w: number; h: number }, want: { w: number; h: number }): number {
  const safe = (v: number) => (v > 1e-9 ? v : 1e-9);
  return Math.abs(Math.log(safe(b.w) / safe(want.w)))
    + Math.abs(Math.log(safe(b.h) / safe(want.h)));
}

/**
 * Where the line work sits inside its own bounding box, as a fraction of it.
 *
 * This is what tells a plan from the same plan turned half around: their boxes
 * are identical, but an L has its weight in one corner and the turned L has it
 * in the opposite one. Length-weighted, for the same reason the histogram is.
 */
function weightOffset(lines: readonly Polyline[]): { u: number; v: number } {
  let sum = 0;
  let cx = 0;
  let cy = 0;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      const a = line[i];
      const b = line[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length <= 0) continue;
      sum += length;
      cx += ((a.x + b.x) / 2) * length;
      cy += ((a.y + b.y) / 2) * length;
    }
  }
  const box = boundsOf(lines);
  if (sum <= 0 || !box) return { u: 0, v: 0 };
  const safe = (v: number) => (v > 1e-9 ? v : 1e-9);
  return {
    u: (cx / sum - box.cx) / safe(box.w),
    v: (cy / sum - box.cy) / safe(box.h),
  };
}

/**
 * A unit that was never declared, or nothing.
 *
 * Only powers of ten, and only beyond a factor of two: see the module note.
 */
function unitScale(sourceSpan: number, targetSpan: number): number {
  if (!(sourceSpan > 0) || !(targetSpan > 0)) return 1;
  const ratio = targetSpan / sourceSpan;
  if (ratio > 0.5 && ratio < 2) return 1;
  const power = Math.round(Math.log10(ratio));
  const snapped = 10 ** power;
  // Still not close after snapping: the difference is not a unit, so leave it
  // to the person who can see both drawings.
  return ratio / snapped > 0.5 && ratio / snapped < 2 ? snapped : 1;
}

/**
 * Estimate the placement that lays `source` over `target`.
 *
 * Both must already be in the SAME space — the caller maps the underlay into
 * drawing space first, because only it knows the render frame. Returns a
 * centring-only placement when there is too little line work to read a
 * direction from, which is the same answer the button gave before and is never
 * worse than no answer.
 */
export function prealignDxf(
  source: readonly Polyline[],
  target: readonly Polyline[],
  options: { minSegment?: number } = {},
): PrealignResult {
  const min = options.minSegment ?? 1;
  const sourceBounds = boundsOf(source);
  const targetBounds = boundsOf(target);
  const identity: PrealignResult = {
    placement: { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 },
    rotationDeg: 0,
    scale: 1,
    sharpness: 1,
  };
  if (!sourceBounds || !targetBounds) return identity;

  const centre = (result: PrealignResult): PrealignResult => {
    const moved = turned(source, -(result.rotationDeg * Math.PI) / 180, result.scale);
    const b = boundsOf(moved);
    if (!b) return result;
    return {
      ...result,
      placement: {
        offsetX: targetBounds.cx - b.cx,
        offsetY: targetBounds.cy - b.cy,
        rotationDeg: result.rotationDeg,
        scale: result.scale,
      },
    };
  };

  const scale = unitScale(
    Math.hypot(sourceBounds.w, sourceBounds.h),
    Math.hypot(targetBounds.w, targetBounds.h),
  );

  const a = segmentsOf(source, min / scale);
  const b = segmentsOf(target, min);
  if (a.length < 8 || b.length < 8) return centre({ ...identity, scale });

  const ha = histogram(a);
  const hb = histogram(b);
  let bestShift = 0;
  let best = -Infinity;
  let total = 0;
  for (let shift = 0; shift < BINS; shift += 1) {
    let sum = 0;
    for (let i = 0; i < BINS; i += 1) sum += ha[i] * hb[(i + shift) % BINS];
    total += sum;
    if (sum > best) {
      best = sum;
      bestShift = shift;
    }
  }
  const mean = total / BINS;
  const sharpness = mean > 0 ? best / mean : 1;

  // Four quarter turns fit the histogram equally; the one whose bounding box
  // has the model's proportions is the one meant.
  const base = (bestShift / BINS) * Math.PI;
  const wantWeight = weightOffset(target);
  let bestRad = base;
  let bestMiss = Infinity;
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const rad = base + (quarter * Math.PI) / 2;
    const rotated = turned(source, rad, scale);
    const bounds = boundsOf(rotated);
    if (!bounds) continue;
    const weight = weightOffset(rotated);
    // The box settles the quarter, the weight settles the half. Both are
    // scale-free, so a drawing that shows more than the building still scores
    // as the right shape.
    const miss = boxMiss(bounds, targetBounds)
      + Math.hypot(weight.u - wantWeight.u, weight.v - wantWeight.v)
      + 1e-6 * quarter;
    if (miss < bestMiss) {
      bestMiss = miss;
      bestRad = rad;
    }
  }

  // `DxfPlacement.rotationDeg` turns CLOCKWISE (see `applyDxfPlacement`), and
  // `bestRad` is the counter-clockwise angle that lays source on target. The
  // sign is pinned by a round-trip test rather than argued for here.
  //
  // Normalised into (-180, 180]: the same turn either way, but "9.25" is a
  // number somebody can check against a drawing and "-350.75" is not.
  let deg = (-(bestRad * 180) / Math.PI) % 360;
  if (deg > 180) deg -= 360;
  if (deg <= -180) deg += 360;
  return centre({ placement: identity.placement, rotationDeg: deg, scale, sharpness });
}
