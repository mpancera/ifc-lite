/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Plane geometry the interpretation stage needs: nothing clever, everything
 * checkable by hand. Polygons are point lists without a repeated closing
 * point; a loop that repeats its first point is normalised on the way in.
 */

import type { Point2 } from '../types.js';

/** Drop a repeated closing point and consecutive duplicates. */
export function normaliseLoop(points: readonly Point2[], epsilon = 1e-9): Point2[] {
  const out: Point2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < epsilon && Math.abs(last.y - p.y) < epsilon) continue;
    out.push({ x: p.x, y: p.y });
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon) out.pop();
  }
  return out;
}

/** Signed area by the shoelace formula; positive when counter-clockwise. */
export function signedArea(poly: readonly Point2[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function area(poly: readonly Point2[]): number {
  return Math.abs(signedArea(poly));
}

export function perimeter(poly: readonly Point2[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

/**
 * The "width" of a region: 2·A/P. For a long thin shape this is its
 * thickness, for a compact one about half the shorter side. It is what
 * separates a wall cavity (0.19 m for a 6 × 0.2 m wall) from a WC (0.67 m).
 */
export function regionWidth(poly: readonly Point2[]): number {
  const p = perimeter(poly);
  return p > 0 ? (2 * area(poly)) / p : 0;
}

export function centroid(poly: readonly Point2[]): Point2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-12) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(points: readonly Point2[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Ray casting; a point on an edge counts as inside. */
export function pointInPolygon(p: Point2, poly: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** A polygon approximating a circle or an arc, `steps` segments. */
export function arcPoints(cx: number, cy: number, r: number, startDeg: number, endDeg: number, steps = 12): Point2[] {
  const a0 = (startDeg * Math.PI) / 180;
  let a1 = (endDeg * Math.PI) / 180;
  if (a1 <= a0) a1 += Math.PI * 2;
  const out: Point2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** A stable text handle for a piece of geometry: rounded to the millimetre, order preserved. */
export function geometryHandle(kind: string, layer: string | undefined, points: readonly Point2[]): string {
  const coords = points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';');
  return `${kind}@${layer ?? ''}@${coords}`;
}
