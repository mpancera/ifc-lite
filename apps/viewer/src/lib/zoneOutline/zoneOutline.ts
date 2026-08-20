/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The line around a zone, the way a fire plan draws it.
 *
 * An Auslösezone is a set of rooms. What has to appear on the drawing is not
 * each room's own outline but the boundary AROUND the group — the line a fire
 * officer follows to see how far the zone reaches — interrupted wherever a door
 * or a passage lets you through it.
 *
 * # Why not a polygon union
 * The obvious answer, unioning the room polygons, is the wrong shape: two rooms
 * of one zone are separated by a WALL, so their footprints do not touch and the
 * union is simply both outlines, internal wall faces and all. Cancelling shared
 * edges fails for the same reason — the two rooms' edges lie on opposite faces
 * of the wall and are nowhere identical.
 *
 * So the test is not geometric identity but neighbourhood: step out of each
 * boundary edge and ask what is there. Land in another room of the same zone
 * and the edge is internal, whatever the wall between them looks like. That is
 * the same construction the space graph crosses a doorway with, and it holds up
 * on real exports where nothing lines up exactly.
 *
 * # Coordinates
 * Drawing space: x is world x, y is world z, in metres — the frame `planPick`
 * pins. Nothing here knows about the plan's rotation.
 *
 * Pure — no store, no React, no IFC.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';

/**
 * How far out of an edge to step when asking what is on the other side.
 *
 * Has to clear the wall, or every edge reads as external. Half a metre covers
 * the ordinary partition and stops short of the next room but one; a wall
 * thicker than this reads as the zone's outer edge, which is the safe way to be
 * wrong — an outline drawn too far out is visible, one drawn too far in is not.
 */
export const NEIGHBOUR_PROBE_M = 0.5;

/** How far a door reaches along the outline it interrupts, beyond its own width. */
export const DOOR_MARGIN_M = 0.05;

/**
 * How parallel a door's axis has to be to the line before it counts as being
 * IN that wall — the cosine between them.
 *
 * 0.7 is 45°. Below that the door belongs to another wall, most often the one
 * meeting this one at the corner it is standing next to.
 */
export const PARALLEL_ENOUGH = 0.7;

/** A room of the zone, as this module needs it. */
export interface OutlineRoom {
  readonly id: number;
  /**
   * The room's boundary, as loose edges — see {@link boundaryEdges}.
   *
   * Edges rather than a closed contour, because a contour is a harder thing
   * than this needs and a harder thing than a mesh reliably gives: a room can
   * come back as two pieces, or with a hole, and both are perfectly good
   * boundaries to draw.
   */
  readonly edges: readonly OutlineSegment[];
  /**
   * Projected triangles, flat `[ax, ay, bx, by, …]` — the exact "is this point
   * inside" test, the same one `spaceGraph` uses and for the same reason.
   */
  readonly triangles: Float32Array;
}

/** A doorway that breaks the line. */
export interface OutlineDoor {
  readonly centre: Point2D;
  /** Unit vector along the door's width. */
  readonly along: Point2D;
  /** Clear width in metres. */
  readonly width: number;
}

/** One drawn stretch of the zone's boundary. */
export interface OutlineSegment {
  readonly a: Point2D;
  readonly b: Point2D;
}

/** Quantised endpoint pair, so an edge and its reverse hash the same. */
function edgeKey(ax: number, ay: number, bx: number, by: number): string {
  const q = (v: number) => Math.round(v * 10000);
  const p = `${q(ax)},${q(ay)}`;
  const r = `${q(bx)},${q(by)}`;
  return p < r ? `${p}|${r}` : `${r}|${p}`;
}

/** Doubled area, for throwing away the triangles that are really lines. */
function doubledArea(p: readonly Point2D[]): number {
  return Math.abs(
    (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[2].x - p[0].x) * (p[1].y - p[0].y),
  );
}

/** A triangle's identity regardless of vertex order or winding. */
function triangleKey(p: readonly Point2D[]): string {
  const q = (v: number) => Math.round(v * 10000);
  return [`${q(p[0].x)},${q(p[0].y)}`, `${q(p[1].x)},${q(p[1].y)}`, `${q(p[2].x)},${q(p[2].y)}`]
    .sort()
    .join('|');
}

/**
 * The outline of a triangulated room: every edge that belongs to exactly one
 * triangle — once the projection has been flattened back to one layer.
 *
 * # Why the flattening
 * A room is a SOLID, and what arrives here is its whole mesh projected onto the
 * plan: the top face, the bottom face directly under it, and the side faces
 * edge-on. So each face is present twice and every side is a triangle with no
 * area. Counted naively, every edge appears an even number of times and the
 * boundary comes out empty — which is exactly what it did: four zones found,
 * nothing drawn.
 *
 * Dropping the zero-area triangles and de-duplicating the rest leaves one
 * layer, and on one layer the rule holds again: an interior edge belongs to two
 * triangles, a boundary edge to one.
 *
 * Exact here, unlike between two rooms: one room's triangles come from one
 * vertex buffer, so an interior edge really is shared to the last bit and
 * cancels cleanly. That is why the neighbour test further down needs a probe
 * and this does not.
 */
export function boundaryEdges(triangles: Float32Array): OutlineSegment[] {
  const seen = new Map<string, { a: Point2D; b: Point2D; count: number }>();
  const layer = new Set<string>();
  for (let i = 0; i + 5 < triangles.length; i += 6) {
    const pts: Point2D[] = [
      { x: triangles[i], y: triangles[i + 1] },
      { x: triangles[i + 2], y: triangles[i + 3] },
      { x: triangles[i + 4], y: triangles[i + 5] },
    ];
    // A side face seen edge-on. It carries no boundary and would double every
    // edge it lies along.
    if (doubledArea(pts) < 1e-9) continue;
    // The face and its twin on the other side of the slab are one face here.
    const key = triangleKey(pts);
    if (layer.has(key)) continue;
    layer.add(key);

    for (let e = 0; e < 3; e += 1) {
      const a = pts[e];
      const b = pts[(e + 1) % 3];
      const key = edgeKey(a.x, a.y, b.x, b.y);
      const hit = seen.get(key);
      if (hit) hit.count += 1;
      else seen.set(key, { a, b, count: 1 });
    }
  }
  const out: OutlineSegment[] = [];
  for (const { a, b, count } of seen.values()) {
    if (count === 1) out.push({ a, b });
  }
  return out;
}

function inTriangles(point: Point2D, triangles: Float32Array): boolean {
  for (let i = 0; i + 5 < triangles.length; i += 6) {
    const ax = triangles[i];
    const ay = triangles[i + 1];
    const bx = triangles[i + 2];
    const by = triangles[i + 3];
    const cx = triangles[i + 4];
    const cy = triangles[i + 5];
    const d1 = (point.x - bx) * (ay - by) - (ax - bx) * (point.y - by);
    const d2 = (point.x - cx) * (by - cy) - (bx - cx) * (point.y - cy);
    const d3 = (point.x - ax) * (cy - ay) - (cx - ax) * (point.y - ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(hasNeg && hasPos)) return true;
  }
  return false;
}

/**
 * Whether the far side of this edge is another room of the same zone.
 *
 * Probed from the midpoint in BOTH directions, because the outline's winding is
 * not guaranteed: a footprint read back from a mesh can come out either way
 * round, and guessing wrong would invert the whole test.
 */
function facesSameZone(
  a: Point2D,
  b: Point2D,
  self: number,
  rooms: readonly OutlineRoom[],
  probe: number,
): boolean {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return false;
  const nx = -dy / length;
  const ny = dx / length;

  for (const sign of [1, -1]) {
    const at = { x: mx + nx * probe * sign, y: my + ny * probe * sign };
    for (const room of rooms) {
      if (room.id === self) continue;
      if (inTriangles(at, room.triangles)) return true;
    }
  }
  return false;
}

/** The part of `a→b` that a door covers, as a span in `[0, 1]`, or `null`. */
function doorSpan(a: Point2D, b: Point2D, door: OutlineDoor): [number, number] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) return null;
  const length = Math.sqrt(lengthSq);

  // Where the door's centre falls along the edge, and how far off it is.
  const t = ((door.centre.x - a.x) * dx + (door.centre.y - a.y) * dy) / lengthSq;
  const foot = { x: a.x + dx * t, y: a.y + dy * t };
  const away = Math.hypot(door.centre.x - foot.x, door.centre.y - foot.y);
  // A door in a different wall must not punch a hole in this one. The reach is
  // the probe distance, the same "is this the wall next to me" question.
  if (away > NEIGHBOUR_PROBE_M) return null;

  // The door has to sit IN this wall, not merely near it. `along` is the
  // door's width axis, so a door in a wall meeting this one at a corner points
  // across the line rather than along it — and dividing by that near-zero
  // cosine below would blow a metres-wide hole in the wrong wall, which is
  // exactly what it did.
  const alongDotEdge = Math.abs((door.along.x * dx + door.along.y * dy) / length);
  if (alongDotEdge < PARALLEL_ENOUGH) return null;

  // Measured along ITS axis and projected onto the edge: a door meeting the
  // line at an angle covers more of it than its clear width.
  const half = door.width / 2 + DOOR_MARGIN_M;
  const reach = half / alongDotEdge;
  const span: [number, number] = [t - reach / length, t + reach / length];
  if (span[1] <= 0 || span[0] >= 1) return null;
  return [Math.max(0, span[0]), Math.min(1, span[1])];
}

/** `a→b` with every door span cut out of it. */
export function cutDoors(
  a: Point2D,
  b: Point2D,
  doors: readonly OutlineDoor[],
): OutlineSegment[] {
  const spans: Array<[number, number]> = [];
  for (const door of doors) {
    const span = doorSpan(a, b, door);
    if (span) spans.push(span);
  }
  if (spans.length === 0) return [{ a, b }];

  spans.sort((p, q) => p[0] - q[0]);
  const out: OutlineSegment[] = [];
  const at = (t: number): Point2D => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  let cursor = 0;
  for (const [from, to] of spans) {
    if (from > cursor) out.push({ a: at(cursor), b: at(from) });
    cursor = Math.max(cursor, to);
  }
  if (cursor < 1) out.push({ a: at(cursor), b: at(1) });
  // Slivers left between two overlapping doors are not a line anybody wants.
  return out.filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 0.01);
}

export interface ZoneOutlineOptions {
  /** How far out of an edge to look for a neighbour. */
  readonly probe?: number;
  /**
   * Metres to move the line INTO the room it belongs to.
   *
   * A boundary drawn on the room's edge sits half in the wall, and on a fire
   * plan the heavy line is meant to read as lying inside the compartment it
   * encloses. Pass half the line's drawn weight and it comes to rest against
   * the wall face rather than straddling it.
   */
  readonly inset?: number;
}

/** Which side of `a→b` the room is on: `+1` for the left normal, `-1` for the right. */
function inwardSign(a: Point2D, b: Point2D, room: OutlineRoom): number {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return 1;
  const nx = -dy / length;
  const ny = dx / length;
  // A short step, so a thin room is not stepped straight through.
  const step = 0.02;
  if (inTriangles({ x: mx + nx * step, y: my + ny * step }, room.triangles)) return 1;
  if (inTriangles({ x: mx - nx * step, y: my - ny * step }, room.triangles)) return -1;
  return 1;
}

/**
 * The zone's boundary: every room edge that does NOT face another room of the
 * same zone, with the doorways cut out.
 *
 * Returned as loose segments rather than a closed ring. The boundary of a zone
 * is not one ring — a zone can be in two parts, and cutting the doors out
 * breaks it further — so a ring would be a shape the answer does not have.
 */
export function zoneOutline(
  rooms: readonly OutlineRoom[],
  doors: readonly OutlineDoor[],
  options: ZoneOutlineOptions = {},
): OutlineSegment[] {
  const probe = options.probe ?? NEIGHBOUR_PROBE_M;
  const out: OutlineSegment[] = [];

  const inset = options.inset ?? 0;

  for (const room of rooms) {
    for (const edge of room.edges) {
      let { a, b } = edge;
      if (facesSameZone(a, b, room.id, rooms, probe)) continue;
      if (inset > 0) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length > 1e-9) {
          const sign = inwardSign(a, b, room);
          const ox = (-dy / length) * inset * sign;
          const oy = (dx / length) * inset * sign;
          a = { x: a.x + ox, y: a.y + oy };
          b = { x: b.x + ox, y: b.y + oy };
        }
      }
      out.push(...cutDoors(a, b, doors));
    }
  }
  return out;
}
