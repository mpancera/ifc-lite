/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which way a plan faces, measured from its own walls.
 *
 * # Why a room transfer needs this
 *
 * Two models of one building are usually turned relative to each other, and
 * nothing in the files says by how much. One is exported in project
 * coordinates and the other georeferenced, so the second carries the site's
 * true-north rotation baked into every coordinate — in the case this was built
 * for, 9.6°. Nine degrees is invisible on screen and fatal to matching: across
 * a 50 m plan it moves the far rooms 8 m, which is further than the rooms are
 * apart, so every name lands on a stranger. Solving only for a translation
 * matched 102 of 343 walls; solving for the turn as well matched 284.
 *
 * # Read from the walls, not guessed
 *
 * A building's walls are overwhelmingly parallel or perpendicular to each
 * other, so their directions pile up on one axis — here 92 % of 17 km of wall
 * length. That makes the dominant direction a property of the plan rather than
 * a fit to be searched for, and it is measured the same way in both models
 * before either is compared with the other.
 *
 * Directions are taken modulo 90°, since a wall running "along" the building
 * and one running "across" it say the same thing about its orientation. That
 * is done by quadrupling the angle, averaging on the circle, and quartering it
 * again — the standard way to average a direction that wraps, and it avoids
 * the false zero that a plain mean gives for walls scattered either side of it.
 *
 * The consequence is that the answer lands in (−45°, 45°] and says nothing
 * about which way is "along": two plans whose axes differ by 87° may in truth
 * differ by −3°. The caller resolves that, by trying the quarter turns and
 * keeping whichever actually brings the rooms together.
 */

import type { MeshData } from '@ifc-lite/geometry';

export interface PlanAxis {
  /** Degrees CCW in the plan frame (model x, −render z), in (−45, 45]. */
  deg: number;
  /** 0…1: how much of the wall length agrees. Below ~0.5 the plan has no
   *  dominant direction and its axis should not be trusted. */
  coherence: number;
  /** Metres of wall edge the answer rests on. */
  length: number;
}

/** Edges shorter than this are corner noise rather than a wall's direction. */
const MIN_EDGE_M = 0.5;
/** An edge climbing more than this is not a horizontal run of the wall. */
const LEVEL_TOLERANCE_M = 0.05;

/**
 * The dominant wall direction of a model, or `null` when it has no walls.
 *
 * Only horizontal edges count, so the sloping edges of a gable or a stair
 * soffit do not drag the answer off the plan's actual axis.
 */
export function dominantAxis(meshes: readonly MeshData[]): PlanAxis | null {
  let sx = 0;
  let sy = 0;
  let total = 0;

  for (const mesh of meshes) {
    if (mesh.ifcType !== 'IfcWall') continue;
    const p = mesh.positions;
    const idx = mesh.indices;
    const count = idx ? idx.length : p.length / 3;
    for (let k = 0; k + 2 < count; k += 3) {
      for (let e = 0; e < 3; e++) {
        const a = (idx ? idx[k + e] : k + e) * 3;
        const b = (idx ? idx[k + ((e + 1) % 3)] : k + ((e + 1) % 3)) * 3;
        if (Math.abs(p[b + 1] - p[a + 1]) > LEVEL_TOLERANCE_M) continue;
        // Plan frame: x as it is, y = −z, the same frame the rooms are read in.
        const dx = p[b] - p[a];
        const dy = -(p[b + 2] - p[a + 2]);
        const len = Math.hypot(dx, dy);
        if (len < MIN_EDGE_M) continue;
        const quadrupled = Math.atan2(dy, dx) * 4;
        sx += len * Math.cos(quadrupled);
        sy += len * Math.sin(quadrupled);
        total += len;
      }
    }
  }

  if (total === 0) return null;
  return {
    deg: (Math.atan2(sy, sx) / 4) * (180 / Math.PI),
    coherence: Math.hypot(sx, sy) / total,
    length: total,
  };
}
