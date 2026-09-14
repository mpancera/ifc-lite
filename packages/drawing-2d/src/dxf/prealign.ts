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
 * That leaves a quarter-turn ambiguity: an orthogonal building's histogram has
 * peaks every ninety degrees, so four candidates score alike. They are told
 * apart by MEASURING each one — centre it, then count how much of the drawing's
 * line work lands on the model's. Proxies for that (does the bounding box have
 * the right proportions, does the weight sit in the right corner) are cheaper
 * and they are what this did first; they chose a half-turn on the first real
 * drawing it met, because a box is the same box upside down and the weights of
 * two different floors say nothing about each other. Counting what actually
 * overlaps answers the question that was being asked all along.
 *
 * The same count says whether the drawing belongs here at all. A plan of
 * another storey — or another building — has no candidate that fits, and
 * reporting that is worth more than turning it to the least bad angle.
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
  /**
   * The share of the drawing's line work that ended up on the model's, 0..1.
   *
   * The one number that says whether this drawing belongs over this plan. A
   * plan of a different storey scores low at every angle, and the caller
   * should say so rather than present the least bad turn as an alignment.
   */
  fit: number;
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

/** Points along a polyline at roughly `step` apart, ends included. */
function samplePoints(lines: readonly Polyline[], step: number, into: (x: number, y: number) => void): void {
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      const a = line[i];
      const b = line[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(length / step));
      for (let k = 0; k <= n; k += 1) {
        into(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
      }
    }
  }
}

/**
 * How much of `source` lies on `target`, as a share of the source, 0..1.
 *
 * A hash grid at the tolerance, so this stays linear in the number of sampled
 * points — the drawings this runs on have tens of thousands of segments, and a
 * pairwise comparison over four candidate angles would be minutes.
 *
 * Tolerance is half a metre. A drawn wall and the model's cut through the same
 * wall differ by the thickness of a finish and by whatever the surveyor
 * rounded to; asking for centimetres would score a correct alignment as a
 * failure.
 */
function coverage(source: readonly Polyline[], target: readonly Polyline[], tol = 0.5): number {
  const grid = new Set<string>();
  samplePoints(target, tol / 2, (x, y) => {
    grid.add(`${Math.round(x / tol)},${Math.round(y / tol)}`);
  });
  if (grid.size === 0) return 0;

  let total = 0;
  let hit = 0;
  samplePoints(source, tol / 2, (x, y) => {
    total += 1;
    const gx = Math.round(x / tol);
    const gy = Math.round(y / tol);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (grid.has(`${gx + dx},${gy + dy}`)) {
          hit += 1;
          return;
        }
      }
    }
  });
  return total > 0 ? hit / total : 0;
}

/** Move `lines` so their bounding box centre sits on `centre`. */
function centredOn(lines: readonly Polyline[], centre: { cx: number; cy: number }): { lines: Polyline[]; dx: number; dy: number } {
  const b = boundsOf(lines);
  if (!b) return { lines: [...lines], dx: 0, dy: 0 };
  const dx = centre.cx - b.cx;
  const dy = centre.cy - b.cy;
  return {
    lines: lines.map((line) => line.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
    dx,
    dy,
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
    fit: 0,
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

  // Four quarter turns fit the histogram equally. Each is MEASURED: turn the
  // drawing, centre it, and count how much of its line work lands on the
  // model's. Proxies for this — box proportions, where the weight sits — chose
  // a half-turn on the first real drawing, because a box is the same box
  // upside down.
  const base = (bestShift / BINS) * Math.PI;
  let bestRad = base;
  let bestFit = -1;
  let bestShiftXY = { dx: 0, dy: 0 };
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const rad = base + (quarter * Math.PI) / 2;
    const placedLines = centredOn(turned(source, rad, scale), targetBounds);
    const fit = coverage(placedLines.lines, target);
    if (fit > bestFit) {
      bestFit = fit;
      bestRad = rad;
      bestShiftXY = { dx: placedLines.dx, dy: placedLines.dy };
    }
  }

  let deg = (-(bestRad * 180) / Math.PI) % 360;
  if (deg > 180) deg -= 360;
  if (deg <= -180) deg += 360;
  // The offset the winning candidate was measured AT, not one recomputed
  // afterwards: a second derivation is a second chance to disagree with the
  // number the fit was scored on.
  return {
    placement: { offsetX: bestShiftXY.dx, offsetY: bestShiftXY.dy, rotationDeg: deg, scale },
    rotationDeg: deg,
    scale,
    sharpness,
    fit: bestFit,
  };
}
