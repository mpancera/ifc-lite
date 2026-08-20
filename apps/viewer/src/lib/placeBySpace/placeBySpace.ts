/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where the devices go, when the rooms decide.
 *
 * An installation planner does not place detectors by eye; they cover an area.
 * The rule is the one the Langmatt generator was built on: a device covers so
 * many m², a room needs `ceil(area / coverage)` of them, and a cap keeps a hall
 * from filling with a hundred pucks. Everything here is a pure function of the
 * rooms — it decides nothing about IFC.
 *
 * # Why the room's own triangles and not its outline
 * A room here is an `IfcSpace` mesh, and reconstructing a clean contour from a
 * mesh is its own hard problem. Every question this module asks is "is this
 * point in this room", which the triangles answer exactly — see `spaceGraph`,
 * which made the same call for the same reason.
 *
 * # Why spread and not just the centre
 * One device goes in the middle, and the middle is the label point, which is
 * already known to be inside even in an L-shaped room. Two or more must not sit
 * on top of each other: candidates are sampled on a grid, and each further one
 * is the candidate farthest from everything picked so far. It is not a coverage
 * optimum — it is a starting point somebody drags into place, and a pile in the
 * centre is not.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';
import type { CatalogMounting } from '@/lib/catalog';
import { pointInSpace, type SpaceNode } from '@/lib/spaceGraph/spaceGraph';

/** The rule, in numbers the panel can show and change. */
export interface PlaceBySpaceParams {
  /** m² one device covers. 45 is the value the Langmatt BMA was built with. */
  readonly CoverageArea: number;
  /** Never more than this in one room, however big it is. */
  readonly MaxPerRoom: number;
  /** Rooms below this area (m²) get nothing — cupboards, shafts, wall cavities. */
  readonly MinArea: number;
}

/** How far under the ceiling a ceiling-mounted device hangs. */
export const CEILING_CLEARANCE_M = 0.05;
/** Metres above the floor a wall-mounted device sits — reachable, by hand. */
export const WALL_MOUNT_HEIGHT_M = 1.2;

/**
 * Metres above the storey floor a device is placed at.
 *
 * A detector belongs at the ceiling and a call point at hand height, and which
 * of the two a product is is something the catalog already states — so the
 * default is derived rather than typed. The ceiling is a property of the
 * STOREY, and a storey whose height the model does not state falls back to the
 * floor, which is where the click tool puts things. Silently guessing a height
 * would be worse: wrong by a metre is invisible in plan and obvious in section.
 *
 * A number entered in the panel overrides all of it, for every room in the run.
 */
export function mountingHeight(
  requested: number | null,
  storeyHeight: number | null,
  mounting: CatalogMounting = 'ceiling',
): number {
  if (requested !== null) return requested;
  if (mounting === 'wall') return WALL_MOUNT_HEIGHT_M;
  if (mounting !== 'ceiling') return 0;
  if (storeyHeight === null || !(storeyHeight > CEILING_CLEARANCE_M)) return 0;
  return storeyHeight - CEILING_CLEARANCE_M;
}

export type PlaceBySpaceSkip = 'too-small' | 'occupied' | 'no-geometry';

export interface DevicePlacement {
  readonly spaceId: number;
  readonly roomLabel: string;
  /** 1-based, within this room. */
  readonly index: number;
  /** How many this room gets in total. */
  readonly count: number;
  /** Drawing space — x is world x, y is world z. */
  readonly at: Point2D;
}

export interface PlaceBySpacePlan {
  readonly placements: readonly DevicePlacement[];
  readonly skipped: ReadonlyArray<{
    readonly spaceId: number;
    readonly roomLabel: string;
    readonly reason: PlaceBySpaceSkip;
  }>;
  /** Rooms the plan looked at, skipped ones included. */
  readonly roomsConsidered: number;
}

export interface PlaceBySpaceOptions {
  /**
   * Rooms that already carry a device of this kind.
   *
   * Running the tool twice must not double the installation, and re-running it
   * after drawing three more rooms is the ordinary way to work — so an
   * already-equipped room is skipped rather than the whole run refused.
   */
  readonly occupied?: ReadonlySet<number>;
  /** What to call the room in the summary — the room NUMBER, where there is one. */
  readonly labelOf?: (space: SpaceNode) => string;
}

/** How many devices a room of this area needs. Always at least one. */
export function deviceCount(area: number, params: PlaceBySpaceParams): number {
  const coverage = params.CoverageArea > 0 ? params.CoverageArea : Infinity;
  const cap = Math.max(1, Math.floor(params.MaxPerRoom));
  return Math.max(1, Math.min(cap, Math.ceil(area / coverage)));
}

/** Axis-aligned bounds of the room's triangles, in drawing space. */
function boundsOf(triangles: Float32Array): {
  minX: number; maxX: number; minY: number; maxY: number;
} | null {
  if (triangles.length < 2) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < triangles.length; i += 2) {
    const x = triangles[i];
    const y = triangles[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) && Number.isFinite(minY) ? { minX, maxX, minY, maxY } : null;
}

/** Grid resolution over the room's bounding box, per axis. */
const SAMPLE_STEPS = 12;

/**
 * `n` points inside the room, spread out.
 *
 * The first is the label point — the one point guaranteed to be inside. Each
 * further one is the sampled candidate farthest from everything picked so far.
 */
export function spreadPoints(space: SpaceNode, n: number): Point2D[] {
  if (n <= 1) return [space.labelPoint];

  const box = boundsOf(space.triangles);
  if (!box) return Array.from({ length: n }, () => space.labelPoint);

  const candidates: Point2D[] = [];
  for (let i = 1; i < SAMPLE_STEPS; i += 1) {
    for (let j = 1; j < SAMPLE_STEPS; j += 1) {
      const point = {
        x: box.minX + (box.maxX - box.minX) * (i / SAMPLE_STEPS),
        y: box.minY + (box.maxY - box.minY) * (j / SAMPLE_STEPS),
      };
      if (pointInSpace(point, space)) candidates.push(point);
    }
  }
  // A room narrower than the grid spacing catches no sample. It is small
  // enough that one point in the middle is the honest answer anyway.
  if (candidates.length === 0) return Array.from({ length: n }, () => space.labelPoint);

  const picked: Point2D[] = [space.labelPoint];
  while (picked.length < n) {
    let best: Point2D | null = null;
    let bestDistance = -1;
    for (const candidate of candidates) {
      let nearest = Infinity;
      for (const taken of picked) {
        const d = (candidate.x - taken.x) ** 2 + (candidate.y - taken.y) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = candidate;
      }
    }
    // Every candidate already taken: stop spreading and repeat the last, so
    // the count the panel promised is the count that gets placed.
    picked.push(best ?? picked[picked.length - 1]);
  }
  return picked;
}

/**
 * The whole run, decided before anything is written.
 *
 * Returned rather than executed so the panel can say "58 devices in 42 rooms"
 * before the author commits — a batch that authors 58 elements is not something
 * to find out about afterwards.
 */
export function planDevicesBySpace(
  spaces: readonly SpaceNode[],
  params: PlaceBySpaceParams,
  options: PlaceBySpaceOptions = {},
): PlaceBySpacePlan {
  const label = options.labelOf ?? ((space: SpaceNode) => space.name);
  const placements: DevicePlacement[] = [];
  const skipped: Array<{ spaceId: number; roomLabel: string; reason: PlaceBySpaceSkip }> = [];

  for (const space of spaces) {
    const roomLabel = label(space);
    if (options.occupied?.has(space.id)) {
      skipped.push({ spaceId: space.id, roomLabel, reason: 'occupied' });
      continue;
    }
    if (space.triangles.length === 0) {
      skipped.push({ spaceId: space.id, roomLabel, reason: 'no-geometry' });
      continue;
    }
    if (space.area < params.MinArea) {
      skipped.push({ spaceId: space.id, roomLabel, reason: 'too-small' });
      continue;
    }

    const count = deviceCount(space.area, params);
    const points = spreadPoints(space, count);
    for (let i = 0; i < count; i += 1) {
      placements.push({
        spaceId: space.id,
        roomLabel,
        index: i + 1,
        count,
        at: points[i] ?? space.labelPoint,
      });
    }
  }

  return { placements, skipped, roomsConsidered: spaces.length };
}

export default planDevicesBySpace;
