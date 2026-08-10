/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where a plan is cut, and which storeys it can be cut at.
 *
 * Plan mode reuses the 2D drawing pipeline, which takes its cut as a
 * PERCENTAGE along the model's vertical extent (`sectionPlane.position`, the
 * shape the section slider produces). A plan does not think that way — it
 * thinks "this storey, 1.25 m above its floor". This module is the one place
 * that turns the second into the first, so nothing else in plan mode has to
 * know that a percentage is involved.
 *
 * # Which floor level counts
 * The level a plan is measured from is the MESH-derived floor in the RTC-
 * shifted render frame, never `IfcBuildingStorey.Elevation`. The attribute
 * omits the building/site placement Z, so on a georeferenced model it is
 * simply a different number from the one the cutter works in — the cut would
 * land hundreds of metres from the storey it names. The derivation is shared
 * with the projection-band scoping (`storeyFloorLevelsFromMeshes`) so the cut
 * and the band boundaries can never disagree about where a floor is.
 *
 * The attribute elevation is still carried, but only as a LABEL: it is the
 * number written on the drawings people already have, so it is what makes a
 * storey recognisable in a picker.
 */

import { storeyFloorLevelsFromMeshes, type StoreyFloorMesh } from '@ifc-lite/drawing-2d';

/** A storey a plan can be cut at: it has geometry, so it has a real floor. */
export interface PlanStorey {
  /** Local express id of the `IfcBuildingStorey`. */
  readonly expressId: number;
  readonly name: string;
  /** Mesh-derived floor in the render frame — what the cut is measured from. */
  readonly floorLevel: number;
  /**
   * `IfcBuildingStorey.Elevation`, for display only.
   *
   * `null` when the model carries none. Never used for the cut: see the module
   * note above.
   */
  readonly elevation: number | null;
}

interface StoreyNames {
  /** storey express id -> name, as far as the model provides one. */
  readonly names: ReadonlyMap<number, string>;
  /** storey express id -> `Elevation` attribute. */
  readonly elevations: ReadonlyMap<number, number>;
  /** element express id -> storey express id. */
  readonly elementToStorey: ReadonlyMap<number, number>;
}

/**
 * The storeys a plan can be cut at, lowest first.
 *
 * Only storeys that produced geometry appear. That is not a shortcut: a storey
 * with no members has no derivable floor, and offering it would produce an
 * empty plan that looks like a broken one. It also quietly disposes of the
 * empty basement level that many models carry as a datum.
 */
export function planStoreys(
  meshes: ReadonlyArray<StoreyFloorMesh>,
  hierarchy: StoreyNames,
): PlanStorey[] {
  const levels = storeyFloorLevelsFromMeshes(meshes, hierarchy.elementToStorey);
  const storeys: PlanStorey[] = [];
  for (const [expressId, floorLevel] of levels) {
    storeys.push({
      expressId,
      name: hierarchy.names.get(expressId) ?? `#${expressId}`,
      floorLevel,
      elevation: hierarchy.elevations.get(expressId) ?? null,
    });
  }
  storeys.sort((a, b) => a.floorLevel - b.floorLevel);
  return storeys;
}

/**
 * The storey a plan opens at when nobody has chosen one.
 *
 * The lowest storey that has geometry. Predictable beats clever here: any
 * "find the ground floor" rule has to guess from elevations that a basement,
 * a split level, or a shifted datum each break differently, and guessing wrong
 * is worse than starting one click away — whereas "the bottom of the building,
 * then work up" is what somebody flipping through a set of plans expects.
 */
export function defaultPlanStorey(storeys: readonly PlanStorey[]): PlanStorey | null {
  return storeys[0] ?? null;
}

export type PlanCut =
  | {
      readonly ok: true;
      /** Cut height in the render frame. */
      readonly worldY: number;
      /** The same cut as the percentage-along-extent the drawing pipeline takes. */
      readonly percent: number;
    }
  | {
      readonly ok: false;
      /**
       * Why there is no usable cut.
       *
       * A condition, not an error: a cut above the roof is what you get when
       * the top storey is a plant deck with a low parapet, and the plan has to
       * be able to SAY that instead of rendering blank.
       */
      readonly reason: 'no-extent' | 'above-model' | 'below-model';
    };

/**
 * Turn "this storey, this height above its floor" into the cut the drawing
 * pipeline takes.
 *
 * `axisMin` / `axisMax` are the model's vertical extent in the same render
 * frame as `floorLevel` (`coordinateInfo.shiftedBounds` Y).
 *
 * A cut outside the model is REPORTED rather than clamped. Clamping would slide
 * the cut to the roof or the foundation and draw a perfectly plausible plan of
 * the wrong thing, which is the worse failure — nothing on screen would say the
 * height being displayed is not the height that was asked for.
 */
export function planCut(
  floorLevel: number,
  cutHeight: number,
  axisMin: number,
  axisMax: number,
): PlanCut {
  const extent = axisMax - axisMin;
  if (!Number.isFinite(extent) || extent <= 0) return { ok: false, reason: 'no-extent' };

  const worldY = floorLevel + cutHeight;
  if (worldY > axisMax) return { ok: false, reason: 'above-model' };
  if (worldY < axisMin) return { ok: false, reason: 'below-model' };

  return { ok: true, worldY, percent: ((worldY - axisMin) / extent) * 100 };
}
