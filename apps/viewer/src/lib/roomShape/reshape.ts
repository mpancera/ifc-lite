/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Writing a new outline onto a room that already exists.
 *
 * # Why in place and not rebuild
 * The split tool answers a similar question by building fresh elements and
 * tombstoning the source. That cannot work here: a room carries its number, the
 * zone it is painted into, the detectors contained in it and its space
 * boundaries, and every one of those is a relationship pointing at THIS express
 * id. Replacing the room would leave them pointing at a tombstone.
 *
 * So the element, its placement and all its relationships stay, and only its
 * swept area is replaced.
 *
 * # Coordinates
 * The outline arrives in STOREY-LOCAL IFC metres — the frame
 * `readSlabFootprint` hands back, X east and Y north. That is NOT the plan's
 * drawing space, whose y is the renderer's z and therefore the negative of
 * this one; the plan flips on the way in and on the way out, and everything
 * from here down is IFC's frame, which is the frame the file is written in.
 *
 * # What gets normalised on the way
 * To
 * land it on the profile, everything the chain folded IN has to be folded back
 * OUT: the placement origin, the profile's own origin, the solid's Position
 * transform and the file's length unit. Rather than invert all four, three of
 * them are cleared — the profile origin and the solid Position are set to the
 * identity and the polygon carries the shape outright. That is exactly what the
 * in-store builders emit, so a reshaped room and a drawn one come out the same.
 *
 * The one thing that cannot be cleared is the element's own placement, because
 * other things (the room's contained devices) are positioned relative to it. A
 * placement carrying a ROTATION therefore cannot be folded out by subtracting
 * an origin, and this refuses rather than writing a room that is subtly turned.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { emitPolygonProfile } from '@ifc-lite/create';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { resolveSlabEditChain } from '@/lib/slab-edit';
import { readAttributes as readAttrs } from '@/lib/placement-core';
import { outlineProblem, polygonArea } from './roomShape.js';

/** `IfcExtrudedAreaSolid.Position`, the transform that gets cleared. */
const SOLID_POSITION = 1;
/** `IfcExtrudedAreaSolid.SweptArea`, repointed at the new profile. */
const SOLID_SWEPT_AREA = 0;

export interface ReshapeResult {
  /**
   * The two positional writes that change the shape, for the caller to apply
   * through the undoable batch path.
   *
   * Handed back rather than made here so ONE Ctrl+Z puts the room back: the
   * old profile is still in the overlay untouched, so restoring the pointer to
   * it restores the outline exactly.
   */
  writes: Array<{ entityId: number; index: number; value: string | null }>;
  /** New footprint area in m², for the quantities the caller updates. */
  area: number;
  /** Extrusion height in metres, unchanged. */
  height: number;
  /** The outline as written, in storey-local IFC metres. */
  outline: Point2D[];
}

/**
 * Replace a room's outline. Returns a message on refusal, never throws.
 *
 * `outline` is in storey-local IFC metres (see the note above), with the
 * plan's rotation already undone by the caller.
 */
export function reshapeRoomOutline(
  dataStore: IfcDataStore,
  view: MutablePropertyView,
  editor: StoreEditor,
  expressId: number,
  outline: readonly Point2D[],
  lengthUnitScale: number,
): ReshapeResult | { error: string } {
  const problem = outlineProblem(outline);
  if (problem) return { error: problem };

  const chain = resolveSlabEditChain(dataStore, view, editor, expressId, lengthUnitScale);
  if (!chain) {
    return {
      error: 'Dieser Raum hat keine Form, die sich hier bearbeiten lässt — '
        + 'erwartet wird ein Rechteck- oder Polygonprofil, entlang Z extrudiert.',
    };
  }
  if (chain.elementType !== 'IfcSpace') {
    return { error: 'Nur Räume lassen sich so umformen.' };
  }
  if (placementIsRotated(dataStore, view, editor, expressId)) {
    return {
      error: 'Die Platzierung dieses Raums ist gedreht. Das Umformen würde ihn '
        + 'verschoben zurückschreiben — noch nicht unterstützt.',
    };
  }

  // Authored entities are held in metres by the in-store builders; only
  // entities read from the file need the unit scale applied. Same rule
  // `resolveSlabEditChain` follows when it scales the chain on the way out.
  const isAuthored = editor.getNewEntity(expressId) != null;
  const scale = isAuthored ? 1 : lengthUnitScale;
  if (!(scale > 0)) return { error: 'Die Längeneinheit des Modells ist unbrauchbar.' };

  const [ox, oy] = chain.placementOrigin;
  const profilePoints: Array<[number, number]> = outline.map((p) => [
    (p.x - ox) / scale,
    (p.y - oy) / scale,
  ]);

  const profileId = emitPolygonProfile(editor, profilePoints);

  return {
    writes: [
      { entityId: chain.extrudedSolidId, index: SOLID_SWEPT_AREA, value: `#${profileId}` },
      // Cleared, not inverted: the polygon above already carries everything
      // this transform used to say. Leaving it would apply the offset twice.
      { entityId: chain.extrudedSolidId, index: SOLID_POSITION, value: null },
    ],
    area: polygonArea(outline),
    height: chain.thickness,
    outline: outline.map((p) => ({ x: p.x, y: p.y })),
  };
}

/**
 * Whether the element's placement turns it.
 *
 * `IfcAxis2Placement3D` states direction in `Axis` (attr 1) and `RefDirection`
 * (attr 2); both absent means the identity, which is the case the caller can
 * fold out by subtracting an origin.
 */
function placementIsRotated(
  dataStore: IfcDataStore,
  view: MutablePropertyView,
  editor: StoreEditor,
  expressId: number,
): boolean {
  const attrs = readAttrs(dataStore, view, editor, expressId);
  const placementId = refOf(attrs?.[5]);
  if (placementId === null) return false;
  const placement = readAttrs(dataStore, view, editor, placementId);
  const axisId = refOf(placement?.[1]);
  if (axisId === null) return false;
  const axis = readAttrs(dataStore, view, editor, axisId);
  return refOf(axis?.[1]) !== null || refOf(axis?.[2]) !== null;
}

function refOf(value: unknown): number | null {
  if (typeof value !== 'string' || !value.startsWith('#')) return null;
  const id = Number(value.slice(1));
  return Number.isFinite(id) ? id : null;
}
