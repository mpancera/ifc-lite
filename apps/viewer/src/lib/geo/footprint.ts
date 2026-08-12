/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The plan footprint of a closed body — the shape a building casts on the ground.
 *
 * {@link extractPlanOutline} recovers a ring from an OPEN surface by chaining
 * the edges that belong to one triangle only, and says outright that a closed
 * solid gives nothing: every edge is shared, so there is no border to find.
 * That is the right answer for a site plate. It is not an answer for a
 * building, and a building is what has to be laid onto an official footprint.
 *
 * So this computes the other thing the doc there names: the projected
 * silhouette. Not a boundary of the surface, but the union of every triangle
 * seen from above.
 *
 * ## Why a raster and not a hull
 *
 * A convex hull is wrong for the buildings that matter. An L-shaped block, a
 * courtyard, a wing set back from the street — the hull spans all of them and
 * would hand the fit a shape the building does not have, then report a
 * confident error. Real footprints are concave.
 *
 * A true polygon union is the exact operation, and it is also the one that
 * needs robust predicates: coincident edges, slivers from near-vertical walls,
 * and T-junctions all arrive in the same mesh. A raster gives up exactness for
 * a tolerance that can be STATED — the cell size — and a stated tolerance
 * beats an exact algorithm that fails on a degenerate triangle.
 *
 * The rings come back as staircases and are simplified afterwards, so the
 * vertex count reflects the shape rather than the grid.
 *
 * ## What it does not know
 *
 * The silhouette includes the ROOF OVERHANG, because that is what the building
 * covers when seen from above. An official footprint may be surveyed at the
 * facade instead. On a building with eaves the two differ by the overhang all
 * the way round — a constant inset, which a fit reports as a good match with a
 * uniform residual rather than as a position error. Read the residual before
 * trusting a shift.
 */

import type { Point2 } from './fit-outline';
import type { TriangleSoup } from './extract-outline';

export type FootprintFailure =
  /** No triangles at all. */
  | 'empty'
  /** Everything projected to a line — a flat vertical surface has no footprint. */
  | 'degenerate'
  /** The covered cells formed no closed ring, which should not happen. */
  | 'no-ring';

export type FootprintResult =
  | {
    ok: true;
    /** The largest ring, in IFC plan coordinates (X east, Y north), CCW, not closed. */
    ring: Point2[];
    /** Plan area of the ring, m². */
    area: number;
    /** Rings found in total; more than one means detached parts. */
    ringCount: number;
    /** The cell size actually used, metres — this is the accuracy. */
    cellSize: number;
  }
  | { ok: false; reason: FootprintFailure };

export interface FootprintOptions {
  /**
   * Target grid resolution in metres. Default 0.25 m.
   *
   * This IS the accuracy of the result, so it is reported back rather than
   * hidden. It may be coarsened automatically — see {@link maxCells}.
   */
  cellSize?: number;
  /**
   * Cap on grid cells per axis. Default 2000.
   *
   * A site model spanning a kilometre at 0.25 m would be four million cells per
   * axis; the cell size is grown until the grid fits instead of allocating it.
   */
  maxCells?: number;
  /**
   * Douglas–Peucker tolerance as a multiple of the cell size. Default 1.
   *
   * The traced ring is a staircase of one vertex per cell edge. Simplifying at
   * the cell size removes the stairs without moving the outline further than
   * the raster already did.
   */
  simplifyCells?: number;
}

const DEFAULT_CELL_SIZE = 0.25;
const DEFAULT_MAX_CELLS = 2000;

/**
 * Viewer space is Y-up and IFC is Z-up, related by `(vx,vy,vz) → (vx,-vz,vy)`.
 * The plan is therefore the viewer's X and negated Z — the same mapping
 * {@link extractPlanOutline} uses, and it has to stay the same or the two
 * outlines would be mirror images of one another.
 */
function toPlan(x: number, z: number): Point2 {
  return { x, y: -z };
}

export function extractPlanFootprint(
  mesh: TriangleSoup,
  options: FootprintOptions = {},
): FootprintResult {
  const triangleCount = Math.floor(mesh.indices.length / 3);
  if (triangleCount === 0) return { ok: false, reason: 'empty' };

  // ── Bounds in plan ──────────────────────────────────────────────────────
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let v = 0; v < mesh.positions.length; v += 3) {
    const p = toPlan(mesh.positions[v], mesh.positions[v + 2]);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return { ok: false, reason: 'degenerate' };

  // ── Grid ────────────────────────────────────────────────────────────────
  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS;
  let cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
  cellSize = Math.max(cellSize, width / maxCells, height / maxCells);

  const nx = Math.max(1, Math.ceil(width / cellSize));
  const ny = Math.max(1, Math.ceil(height / cellSize));
  const covered = new Uint8Array(nx * ny);

  // ── Rasterise ───────────────────────────────────────────────────────────
  // Cell-centre sampling. A near-vertical wall projects to a sliver that covers
  // no centre and so contributes nothing — which is correct, because the floor
  // and roof of the same body cover that ground anyway. A mesh of walls ALONE
  // would come back empty, and that is reported rather than patched, since a
  // thickened sliver would invent a footprint nobody modelled.
  for (let t = 0; t < triangleCount; t += 1) {
    const i0 = mesh.indices[t * 3] * 3;
    const i1 = mesh.indices[t * 3 + 1] * 3;
    const i2 = mesh.indices[t * 3 + 2] * 3;

    const a = toPlan(mesh.positions[i0], mesh.positions[i0 + 2]);
    const b = toPlan(mesh.positions[i1], mesh.positions[i1 + 2]);
    const c = toPlan(mesh.positions[i2], mesh.positions[i2 + 2]);

    const twiceArea = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(twiceArea) < 1e-12) continue;

    const loX = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / cellSize));
    const hiX = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - minX) / cellSize));
    const loY = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - minY) / cellSize));
    const hiY = Math.min(ny - 1, Math.floor((Math.max(a.y, b.y, c.y) - minY) / cellSize));

    for (let cy = loY; cy <= hiY; cy += 1) {
      const py = minY + (cy + 0.5) * cellSize;
      for (let cx = loX; cx <= hiX; cx += 1) {
        const index = cy * nx + cx;
        if (covered[index]) continue;
        const px = minX + (cx + 0.5) * cellSize;
        if (pointInTriangle(px, py, a, b, c, twiceArea)) covered[index] = 1;
      }
    }
  }

  // ── Trace ───────────────────────────────────────────────────────────────
  const rings = traceCoveredBoundary(covered, nx, ny, minX, minY, cellSize);
  if (rings.length === 0) return { ok: false, reason: 'no-ring' };

  const tolerance = (options.simplifyCells ?? 1) * cellSize;
  let best: Point2[] = [];
  let bestArea = -Infinity;
  for (const ring of rings) {
    const simplified = simplifyRing(ring, tolerance);
    const area = Math.abs(ringArea(simplified));
    if (area > bestArea) {
      bestArea = area;
      best = simplified;
    }
  }
  if (best.length < 3) return { ok: false, reason: 'no-ring' };

  // Counter-clockwise, so the ring agrees with what the fit and the outline
  // extractor both produce.
  if (ringArea(best) < 0) best.reverse();

  return { ok: true, ring: best, area: bestArea, ringCount: rings.length, cellSize };
}

/** Barycentric side test against a triangle of known orientation. */
function pointInTriangle(
  px: number, py: number,
  a: Point2, b: Point2, c: Point2,
  twiceArea: number,
): boolean {
  const s = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / twiceArea;
  if (s < 0 || s > 1) return false;
  const t = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / twiceArea;
  if (t < 0 || t > 1) return false;
  return s + t <= 1;
}

/**
 * The outlines of the covered cells, as closed rings of grid corners.
 *
 * Same idea as the surface extractor, one dimension down: a cell edge with no
 * covered neighbour across it is a border edge, and chaining the border edges
 * gives the outline. Emitting each edge with the covered side on its LEFT
 * makes the chain unambiguous at every corner except a diagonal pinch, and
 * makes outer rings come out counter-clockwise and holes clockwise for free.
 */
function traceCoveredBoundary(
  covered: Uint8Array,
  nx: number, ny: number,
  minX: number, minY: number,
  cellSize: number,
): Point2[][] {
  const isCovered = (cx: number, cy: number): boolean =>
    cx >= 0 && cy >= 0 && cx < nx && cy < ny && covered[cy * nx + cx] === 1;

  // Corner key: a grid corner is (cx, cy) with 0 ≤ cx ≤ nx.
  const key = (cx: number, cy: number): number => cy * (nx + 1) + cx;
  const outgoing = new Map<number, Array<[number, number]>>();
  const push = (from: [number, number], to: [number, number]): void => {
    const k = key(from[0], from[1]);
    const list = outgoing.get(k);
    if (list) list.push(to); else outgoing.set(k, [to]);
  };

  for (let cy = 0; cy < ny; cy += 1) {
    for (let cx = 0; cx < nx; cx += 1) {
      if (!isCovered(cx, cy)) continue;
      // Covered side on the left of each directed edge.
      if (!isCovered(cx, cy - 1)) push([cx, cy], [cx + 1, cy]);          // south → east
      if (!isCovered(cx + 1, cy)) push([cx + 1, cy], [cx + 1, cy + 1]);  // east  → north
      if (!isCovered(cx, cy + 1)) push([cx + 1, cy + 1], [cx, cy + 1]);  // north → west
      if (!isCovered(cx - 1, cy)) push([cx, cy + 1], [cx, cy]);          // west  → south
    }
  }

  const rings: Point2[][] = [];
  const toWorld = (cx: number, cy: number): Point2 => ({
    x: minX + cx * cellSize,
    y: minY + cy * cellSize,
  });

  while (outgoing.size > 0) {
    const startKey = outgoing.keys().next().value as number;
    const start: [number, number] = [startKey % (nx + 1), Math.floor(startKey / (nx + 1))];

    const ring: Point2[] = [];
    let current = start;
    let guard = outgoing.size * 4 + 8;

    while (guard-- > 0) {
      const k = key(current[0], current[1]);
      const list = outgoing.get(k);
      if (!list || list.length === 0) break;
      const next = list.pop()!;
      if (list.length === 0) outgoing.delete(k);

      ring.push(toWorld(current[0], current[1]));
      current = next;
      if (current[0] === start[0] && current[1] === start[1]) break;
    }

    if (ring.length >= 3) rings.push(ring);
  }

  return rings;
}

/** Signed area; positive is counter-clockwise. */
export function ringArea(ring: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Douglas–Peucker on a closed ring.
 *
 * Run on the ring split at its two most distant vertices, so the result does
 * not depend on where the trace happened to start — otherwise the same shape
 * traced from a different cell simplifies differently, and a fit run twice
 * would report two different residuals.
 */
export function simplifyRing(ring: readonly Point2[], tolerance: number): Point2[] {
  if (ring.length < 4 || tolerance <= 0) return [...ring];

  // Split at vertex 0 and the vertex farthest from it. Both are extreme points
  // of the shape, so both survive simplification in any case — which is what
  // makes the result independent of where the trace started.
  let far = 0;
  let farthest = -1;
  for (let i = 1; i < ring.length; i += 1) {
    const d = Math.hypot(ring[i].x - ring[0].x, ring[i].y - ring[0].y);
    if (d > farthest) { farthest = d; far = i; }
  }

  const first = ring.slice(0, far + 1);
  const second = [...ring.slice(far), ring[0]];

  const out = [...douglasPeucker(first, tolerance), ...douglasPeucker(second, tolerance).slice(1, -1)];
  return out.length >= 3 ? out : [...ring];
}

function douglasPeucker(points: readonly Point2[], tolerance: number): Point2[] {
  if (points.length < 3) return [...points];

  const first = points[0];
  const last = points[points.length - 1];
  let index = -1;
  let worst = 0;

  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > worst) { worst = d; index = i; }
  }

  if (worst <= tolerance || index < 0) return [first, last];

  const left = douglasPeucker(points.slice(0, index + 1), tolerance);
  const right = douglasPeucker(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
