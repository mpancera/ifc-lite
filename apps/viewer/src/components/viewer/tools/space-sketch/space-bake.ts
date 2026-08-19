/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Pure bake planning for Space Sketch: what a storey's draft rooms become when
 * the user confirms, decided without React, wasm, or the viewer store.
 *
 * The bake half of the overlay reads the plate and never mutates it, and its
 * failure stories are all decisions rather than plumbing: a room emitted on top
 * of an authored space (duplicate rooms in the file), a floor-to-floor taken
 * from a storey list that is unsorted or has a nonsense gap (spaces a hundred
 * metres tall, or the wall band the derive reads collapsing to nothing), and
 * gross floor area measured off the wrong outline (the display boundary rather
 * than the centreline, which would make the quantity describe the wall face).
 * Those are the decisions this module owns; `useSpaceBake` owns the emitting.
 */

import { centroid, pointInPoly, polyArea, type Pt } from '@/lib/space-sketch-geometry';

/** Floor-to-floor used when the storey list offers no usable one. */
export const BAKE_HEIGHT = 3;
/** A storey gap outside this range is a data artefact, not a floor height. */
const MIN_FLOOR_TO_FLOOR = 0.1;
const MAX_FLOOR_TO_FLOOR = 50;

/** The subset of the overlay's storey list this module needs. */
export interface StoreyElevation {
  id: number;
  elev: number;
}

/**
 * Floor-to-floor for storey `sid`: the elevation gap to the storey above it in
 * `storeys`, which the caller keeps sorted low → high.
 *
 * Falls back to {@link BAKE_HEIGHT} for the top storey, an unknown storey, and
 * for a gap that cannot be a storey height. That guard is not cosmetic: this
 * height is also the band `wallRectsFromMeshes` slices to find the storey's
 * walls, so a zero/negative gap (two storeys at the same elevation, a common
 * export artefact) would find no walls at all, and a 500 m gap (a storey
 * elevation left in millimetres) would sweep the whole building into one plan.
 */
export function floorToFloorHeight(storeys: StoreyElevation[], sid: number): number {
  const idx = storeys.findIndex((s) => s.id === sid);
  if (idx < 0) return BAKE_HEIGHT;
  const next = storeys[idx + 1];
  const ff = next ? next.elev - storeys[idx].elev : BAKE_HEIGHT;
  return ff > MIN_FLOOR_TO_FLOOR && ff < MAX_FLOOR_TO_FLOOR ? ff : BAKE_HEIGHT;
}

/**
 * One drafted room as the bake sees it: the topology outline (always the wall
 * centreline) and the display/emit boundary at the user's chosen boundary mode.
 */
export interface DraftRoom {
  outline: Pt[];
  boundary: Pt[];
}

/** An IfcSpace footprint the caller is cleared to create. */
export interface PlannedSpace {
  /** The emitted profile — the net/gross/centre boundary the user picked. */
  OuterCurve: Pt[];
  Height: number;
  /** Measured on the CENTRELINE outline, so the quantity is the room. */
  grossFloorArea: number;
}

/** The storey-wide gross-floor-area space, named after its storey. */
export interface PlannedGfaSpace {
  readonly OuterCurve: Pt[];
  readonly Height: number;
  readonly Name: string;
  readonly LongName: string | null;
  readonly grossFloorArea: number;
}

/**
 * Decide which of a storey's draft rooms become IfcSpace.
 *
 * Two reasons a room is left out, kept apart because they mean different
 * things to the person watching:
 *
 * - **skipped**: its centroid falls inside an already-authored space. The tool
 *   derives rooms from walls, so on a model that already has spaces every one
 *   of them would otherwise be emitted a second time.
 * - **discarded**: the author said no to this one. That is a decision, not a
 *   duplicate, and reporting the two as one number would make a deliberate
 *   choice look like the tool being clever.
 *
 * # Why discarding is matched by OUTLINE and not by face id
 * A DCEL face id is a handle into a live topology: split a room, undo an edit,
 * and the same number can name a different piece of floor. Discarding by id
 * would then quietly drop whatever inherited the id. An outline is a statement
 * about a PLACE, so the room that is skipped is the room the author pointed at
 * — and a room later edited until its centre leaves that place comes back,
 * which is the honest reading of having changed it.
 */
export function planStoreySpaces(
  rooms: DraftRoom[],
  authored: Pt[][],
  height: number,
  discarded: Pt[][] = [],
): { planned: PlannedSpace[]; skipped: number; discarded: number } {
  const planned: PlannedSpace[] = [];
  let skipped = 0;
  let dropped = 0;

  for (const room of rooms) {
    const [cx, cy] = centroid(room.outline);
    // The author's decision is checked FIRST: a room they discarded stays
    // discarded even where it also overlaps an authored space, so the count
    // they see reflects what they did.
    if (discarded.some((fp) => pointInPoly(cx, cy, fp))) {
      dropped++;
      continue;
    }
    if (authored.some((fp) => pointInPoly(cx, cy, fp))) {
      skipped++;
      continue;
    }
    planned.push({
      OuterCurve: room.boundary,
      Height: height,
      grossFloorArea: polyArea(room.outline),
    });
  }
  return { planned, skipped, discarded: dropped };
}

/** Whether a point falls in any of the given outlines. */
export function outlineContaining(point: Pt, outlines: Pt[][]): number {
  return outlines.findIndex((fp) => pointInPoly(point[0], point[1], fp));
}

/**
 * The storey's own space: `IfcSpace.GFA`, one per floor.
 *
 * Not a room somebody stands in — a measured area for the floor as a whole,
 * which is why it carries the STOREY's name rather than a room number, and why
 * its height is the raw floor-to-floor rather than a clear internal height.
 *
 * `null` for an outline that cannot enclose anything: two points do not bound
 * a floor, and emitting a degenerate space would put a zero-area quantity into
 * the file that later reads as a real measurement of nothing.
 */
export function planStoreyGfa(
  outline: Pt[],
  height: number,
  storey: { name: string; longName?: string | null },
): PlannedGfaSpace | null {
  if (outline.length < 3) return null;
  const area = polyArea(outline);
  if (!(area > 0)) return null;

  return {
    OuterCurve: outline,
    Height: height,
    // The storey names it, both fields, because that is what the figure is
    // about — a reader seeing "Space 7" would look for a room.
    Name: storey.name,
    LongName: storey.longName?.trim() || null,
    grossFloorArea: area,
  };
}
