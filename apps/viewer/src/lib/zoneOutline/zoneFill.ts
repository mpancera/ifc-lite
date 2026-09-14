/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The tint inside a zone boundary.
 *
 * A Feuerwehrlageplan fills its Auslösezonen: the line says where the zone
 * ends, the colour says which zone you are standing in — and on a busy plan
 * the second question is the one asked from across a room.
 *
 * # One path, many triangles
 *
 * The rooms arrive as projected triangles, and painting each one as its own
 * shape at 18 % opacity draws every shared edge twice: the seams show up as a
 * brighter web over the whole zone, which is exactly the pattern a reader
 * mistakes for structure. Collecting every triangle into ONE path as separate
 * subpaths and filling it with the nonzero rule paints the union once, so the
 * tint is flat no matter how the mesher happened to cut it.
 *
 * Pure — no store, no React, no IFC.
 */

/** Where a point goes on the surface being drawn. */
export type ProjectPoint = (x: number, y: number) => { x: number; y: number };

/** Painted once, whatever the triangles overlap — see the module note. */
export const ZONE_FILL_RULE = 'nonzero';

/**
 * SVG path data for a zone's rooms, as one closed subpath per triangle.
 *
 * `triangles` is the flat `[ax, ay, bx, by, cx, cy, …]` layout the space graph
 * and the outline already work in. A trailing partial triangle is dropped
 * rather than closed with whatever came before it — half a triangle is a bug
 * upstream, and inventing its third corner would hide it behind a shape that
 * looks plausible.
 */
export function trianglesToPathData(
  triangles: Float32Array,
  project: ProjectPoint,
  decimals = 3,
): string {
  const parts: string[] = [];
  const n = Math.floor(triangles.length / 6) * 6;
  for (let i = 0; i < n; i += 6) {
    const a = project(triangles[i], triangles[i + 1]);
    const b = project(triangles[i + 2], triangles[i + 3]);
    const c = project(triangles[i + 4], triangles[i + 5]);
    parts.push(
      `M ${a.x.toFixed(decimals)} ${a.y.toFixed(decimals)}`
      + ` L ${b.x.toFixed(decimals)} ${b.y.toFixed(decimals)}`
      + ` L ${c.x.toFixed(decimals)} ${c.y.toFixed(decimals)} Z`,
    );
  }
  return parts.join(' ');
}

/**
 * How strongly a zone is tinted.
 *
 * Low enough that the walls, doors and room names underneath stay readable —
 * the fill answers "which zone", the plan underneath answers everything else,
 * and a tint that wins that argument makes the drawing useless for the work it
 * is printed for.
 */
export const ZONE_FILL_OPACITY = 0.16;
