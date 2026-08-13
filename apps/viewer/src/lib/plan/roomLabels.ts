/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What is written inside a room on a plan: its name, and its area.
 *
 * Cheap once rooms exist (#49), and most of what makes a drawing read as a
 * plan rather than a section through a building. Everything here is pure — the
 * hook that finds the spaces and the component that paints them live
 * elsewhere, so the two decisions that are easy to get wrong (where the label
 * goes, and which number it states) can be tested without a parsed model.
 *
 * # Where the label goes
 * The area-weighted centroid of the footprint, EXCEPT when that point is not
 * in the room. An L-shaped flat, a corridor bent round a core, a room wrapped
 * about a stair: the centroid of each of those sits in the notch, and a label
 * floating in the neighbouring room is worse than no label. So the centroid is
 * tested against the footprint and, when it misses, the largest triangle's own
 * centroid is used — a point that is inside by construction.
 *
 * # Why the area comes from the mesh and not only from the model
 * `Qto_SpaceBaseQuantities.NetFloorArea` is the number the room schedule
 * carries, so it wins when the model states it. But exported models very often
 * carry no quantities at all, and a plan whose rooms are labelled with a name
 * and a blank is not the feature. The geometry is then the only answer, and it
 * has the compensating virtue of never contradicting the drawing it is written
 * on. Which of the two was used is carried on the result rather than being
 * quietly averaged over.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';

/**
 * One mesh of a space, as the geometry pipeline delivers it.
 *
 * A single `IfcSpace` can arrive as several of these (submesh splits), so
 * every function here takes a list and treats it as one body.
 */
export interface RoomMesh {
  /** Interleaved `[x, y, z, …]` in the element-local frame. */
  readonly positions: Float32Array;
  /** Triangle indices, 3 per face. */
  readonly indices: Uint32Array;
  /** Local-frame origin; world = origin + position. Absent means world-space. */
  readonly origin?: readonly [number, number, number];
}

export interface RoomFootprint {
  /** Floor area in m², from the geometry. */
  readonly area: number;
  /** A point INSIDE the footprint — where the label goes. */
  readonly anchor: Point2D;
  /** Extent in drawing units, for deciding whether a label fits. */
  readonly width: number;
  readonly height: number;
}

/**
 * Walk every triangle of a space, projected onto the plan.
 *
 * Drawing x IS world x and drawing y IS world z, with no negation — the same
 * mapping picking and placing use (see `planPick.ts`, which carries the full
 * argument and the measurement that pins it).
 */
function forEachProjectedTriangle(
  meshes: readonly RoomMesh[],
  fn: (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => void,
): void {
  for (const mesh of meshes) {
    const { positions, indices } = mesh;
    const ox = mesh.origin?.[0] ?? 0;
    const oz = mesh.origin?.[2] ?? 0;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const ia = indices[i] * 3;
      const ib = indices[i + 1] * 3;
      const ic = indices[i + 2] * 3;
      fn(
        positions[ia] + ox, positions[ia + 2] + oz,
        positions[ib] + ox, positions[ib + 2] + oz,
        positions[ic] + ox, positions[ic + 2] + oz,
      );
    }
  }
}

/** Doubled area of a triangle, unsigned — winding is unreliable here by design. */
function doubledArea(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number {
  return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
}

/** Inside or on the edge, without caring which way the triangle is wound. */
function pointInTriangle(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * The footprint of a space: how big it is, and where to write in it.
 *
 * # Why the area is half the projected surface
 * A space is a closed solid, so its surface projects onto its own shadow
 * exactly twice — once coming down through the ceiling, once through the
 * floor — and the walls project to nothing at all. Summing the UNSIGNED
 * projected triangle areas and halving therefore gives the footprint, without
 * needing reliable normals, a consistent winding, or any polygon union. Both
 * of those are things this mesh does not offer: `MeshData` states outright
 * that winding is unreliable because the meshes are double-sided.
 *
 * The one shape this over-reports is a space that is not vertically convex —
 * a vertical line entering, leaving and re-entering it, as in a room wrapped
 * over a mezzanine floor. Those are rare enough, and wrong in a stated
 * direction (too large), that the alternative — an actual footprint union —
 * is not worth its complexity here.
 *
 * `null` when the meshes carry no area at all: a space with no geometry has no
 * place to put a label, and inventing one would put it at the world origin.
 */
export function roomFootprint(meshes: readonly RoomMesh[]): RoomFootprint | null {
  let projected = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let largest = 0;
  let largestCentre: Point2D | null = null;

  forEachProjectedTriangle(meshes, (ax, ay, bx, by, cx, cy) => {
    if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
    if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
    if (by < minY) minY = by; if (by > maxY) maxY = by;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;

    const area = doubledArea(ax, ay, bx, by, cx, cy) / 2;
    if (!(area > 0)) return;

    projected += area;
    const gx = (ax + bx + cx) / 3;
    const gy = (ay + by + cy) / 3;
    sumX += gx * area;
    sumY += gy * area;
    if (area > largest) {
      largest = area;
      largestCentre = { x: gx, y: gy };
    }
  });

  if (!(projected > 0) || largestCentre === null) return null;

  const centroid: Point2D = { x: sumX / projected, y: sumY / projected };

  // Is the centroid actually in the room? For anything convex it is, and this
  // pass stops at the first triangle that contains it. Only a room with a
  // notch pays for the full walk, and only once.
  let inside = false;
  forEachProjectedTriangle(meshes, (ax, ay, bx, by, cx, cy) => {
    if (inside) return;
    if (doubledArea(ax, ay, bx, by, cx, cy) <= 0) return;
    if (pointInTriangle(centroid.x, centroid.y, ax, ay, bx, by, cx, cy)) inside = true;
  });

  return {
    area: projected / 2,
    anchor: inside ? centroid : largestCentre,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Where a room's stated area came from. */
export type RoomAreaSource = 'quantity' | 'geometry';

export interface RoomArea {
  /** Area in m². */
  readonly value: number;
  readonly source: RoomAreaSource;
  /** The IFC quantity that supplied it, when one did. */
  readonly quantityName?: string;
}

/** The shape this module needs out of a parsed quantity set. */
export interface QuantitySetLike {
  readonly quantities: ReadonlyArray<{ readonly name: string; readonly value: number }>;
}

/**
 * The authored floor area of a space, in m², or `null`.
 *
 * `NetFloorArea` before `GrossFloorArea`: net is the measure inside the
 * finished surfaces, which is what the room outline on a plan encloses, so it
 * is the one that agrees with what the reader is looking at.
 *
 * `lengthUnitScale` is metres per file length unit (`IfcDataStore`). Areas
 * scale with its SQUARE — a millimetre model states 24 650 000, not 24.65, and
 * writing that on a plan is not a rounding error but a different building.
 */
export function roomAreaFromQuantities(
  sets: readonly QuantitySetLike[],
  lengthUnitScale: number,
): RoomArea | null {
  const scale = lengthUnitScale * lengthUnitScale;
  if (!(scale > 0)) return null;

  for (const wanted of ['NetFloorArea', 'GrossFloorArea'] as const) {
    for (const set of sets) {
      for (const q of set.quantities) {
        if (q.name !== wanted) continue;
        const value = q.value * scale;
        // A zero or negative area is a quantity that was never filled in
        // rather than a room of no size; falling through to the geometry
        // says more than printing "0.0 m²".
        if (Number.isFinite(value) && value > 0) {
          return { value, source: 'quantity', quantityName: wanted };
        }
      }
    }
  }
  return null;
}

/**
 * One decimal, because that is how an area is written on a plan.
 *
 * Two would imply a precision the drawing cannot carry — a footprint derived
 * from a mesh is not accurate to the square centimetre, and neither is the
 * wall thickness it was measured between.
 */
export function formatRoomArea(squareMetres: number): string {
  return `${squareMetres.toFixed(1)} m²`;
}

/**
 * A block of text on the plan, whatever it describes.
 *
 * A room label and a door label are the same object on a drawing — text, at a
 * point, that disappears when it stops fitting. Composing both into this
 * before anything draws them means one renderer, one fit rule and one export
 * block, rather than two of each drifting apart.
 */
export interface PlanLabel {
  /** Identifies the OCCURRENCE this describes. */
  readonly key: string;
  /** The entity it describes, for selection and tooltips. */
  readonly expressId: number;
  readonly kind: 'room' | 'door';
  /** Where the text goes, in drawing units. */
  readonly anchor: Point2D;
  /** Lines top to bottom. The first is the mark, and carries weight. */
  readonly lines: readonly string[];
  /**
   * The box the text has to fit inside, in drawing units — the room's
   * footprint, or the doorway's own width.
   */
  readonly width: number;
  readonly height: number;
  /** Native tooltip, where there is something worth being able to check. */
  readonly title?: string;
}

export interface RoomLabel {
  /** Identifies this OCCURRENCE — instanced rooms share an express id. */
  readonly key: string;
  /** Express id of the `IfcSpace`, local to its model. */
  readonly expressId: number;
  /** Where the text goes, in drawing units. */
  readonly anchor: Point2D;
  /**
   * `IfcSpace.Name` — by convention the room NUMBER. Empty when the model
   * states none.
   */
  readonly name: string;
  /**
   * `IfcSpace.LongName` — by convention the room's description. Empty when
   * absent, or when it merely repeats `name`.
   */
  readonly longName: string;
  readonly area: RoomArea | null;
  /** Footprint extent in drawing units, for the fit test. */
  readonly width: number;
  readonly height: number;
}

/**
 * The lines to draw, longest-lived first: number, description, area.
 *
 * Returned rather than concatenated so the caller can lay them out and, more
 * to the point, measure them.
 */
export function roomLabelLines(label: RoomLabel): string[] {
  const lines: string[] = [];
  if (label.name) lines.push(label.name);
  if (label.longName) lines.push(label.longName);
  if (label.area) lines.push(formatRoomArea(label.area.value));
  return lines;
}

/**
 * A room, as a block of text on the plan.
 *
 * Where the area came from is carried in the tooltip rather than shown: a plan
 * whose areas silently came from geometry reads exactly like one whose areas
 * came from the model, and the difference is worth being able to check.
 */
export function roomPlanLabel(label: RoomLabel): PlanLabel {
  return {
    key: label.key,
    expressId: label.expressId,
    kind: 'room',
    anchor: label.anchor,
    lines: roomLabelLines(label),
    width: label.width,
    height: label.height,
    title: label.area
      ? label.area.source === 'quantity'
        ? `${label.area.quantityName}: ${formatRoomArea(label.area.value)}`
        : `Aus der Geometrie gerechnet: ${formatRoomArea(label.area.value)} (das Modell nennt keine Fläche)`
      : undefined,
  };
}

/**
 * Whether the label fits inside the room it belongs to, at this zoom.
 *
 * Without this, zooming out turns a floor of small rooms into a mat of
 * overlapping text — which is worse than no labels, because it also hides the
 * drawing underneath. A plan hides what it cannot show legibly.
 *
 * Measured against the footprint's SMALLER extent for the height and its
 * LARGER one for the width. That pair is the same whichever way the plan is
 * turned, so a label does not appear and disappear as the drawing is rotated —
 * the text stays upright while the room underneath does not.
 *
 * `charWidth` is the width of one character as a fraction of the font size;
 * 0.6 is the usual approximation for a proportional sans at this size, and
 * being approximate is fine — the test decides whether text is legible, not
 * where it lands.
 */
export function labelFits(
  lines: readonly string[],
  metrics: { readonly width: number; readonly height: number },
  /** Drawing units per screen pixel is `1 / scale`; scale is px per unit. */
  scale: number,
  fontSizePx: number,
  lineHeightPx: number,
  charWidth = 0.6,
): boolean {
  if (lines.length === 0) return false;
  if (!(scale > 0)) return false;

  const longest = Math.max(...lines.map((l) => l.length));
  const needWidth = longest * fontSizePx * charWidth;
  const needHeight = lines.length * lineHeightPx;

  const available = [metrics.width * scale, metrics.height * scale];
  const shorter = Math.min(available[0], available[1]);
  const longer = Math.max(available[0], available[1]);

  return longer >= needWidth && shorter >= needHeight;
}
