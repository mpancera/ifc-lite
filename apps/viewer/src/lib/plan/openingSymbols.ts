/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Doors and windows drawn as plan symbols instead of as lumps of cut solid.
 *
 * Without these a floor plan reads as a maze (#50): a door cut at 1.25 m is a
 * gap with a slab of leaf in it, and nothing says which way it opens or which
 * side is hinged. A window cut anywhere is just a hole.
 *
 * # Where this does and does not apply
 * A model that carries its OWN 2D plan representation already draws its swing
 * arcs — the symbolic-representation path reads them straight out of the file,
 * and that is what most authoring tools export. This module is for the models
 * that carry none, where the alternative is not a different symbol but no
 * symbol at all.
 *
 * # The two frames, and the trap between them
 * `MeshData.localToWorld` is the resolved `IfcLocalPlacement` chain, and it is
 * used HERE FOR ITS ROTATION ONLY. Its translation is in the model's original
 * world, while `positions`/`origin` are in the RTC-shifted render frame that
 * the drawing lives in — on a georeferenced model those differ by kilometres.
 * So the axes come from the matrix and the position comes from the mesh, and
 * mixing the two the other way round produces a symbol that is correctly
 * oriented and nowhere near its door.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';

/** A straight piece of a symbol, in drawing units. */
export interface SymbolLine {
  readonly start: Point2D;
  readonly end: Point2D;
}

/** How a door leaf moves. The IFC enum collapsed to what a plan draws. */
export type DoorMotion = 'swing' | 'double-swing' | 'sliding' | 'none';

/** Which end of the opening the leaf is hinged at, along the door's local X. */
export type HingeEnd = 'start' | 'end';

export interface DoorOperation {
  readonly motion: DoorMotion;
  /** Meaningless for `double-swing`, `sliding` and `none`. */
  readonly hinge: HingeEnd;
}

/**
 * ── THE CONVENTION ──────────────────────────────────────────────────────────
 *
 * `IfcDoorTypeOperationEnum` to a hinge end and a motion, per IfcDoor §6.1.3.16
 * ("Door Attributes / General", figures D–G and table 6.1.3.16.M).
 *
 * Two sentences from there carry the whole mapping:
 *
 * 1. **"The door panel (for swinging doors) opens always into the direction of
 *    the positive Y axis of the local placement."** So the side a door opens
 *    towards is NOT in the enum — it is in the placement, and {@link planAxes}
 *    reads it from there. A door meant to open the other way is authored by
 *    turning its placement (figures E and G), which means this module must
 *    never try to infer the side; doing so would overrule the model.
 * 2. **The enum states only which side is hung.** `SingleSwingLeft` is the left
 *    side opening door (figure D), `SingleSwingRight` the right (figure F),
 *    both swinging into +Y. Read in the door's own XY plane from +Z — which is
 *    to say, in plan, with local X to the right — "left" is the local X
 *    MINIMUM, `'start'` here, and "right" is the maximum, `'end'`.
 *
 * Worth knowing while reading this in German: IFC's naming is the OPPOSITE of
 * the DIN convention. Table 6.1.3.16.M maps `SingleSwingLeft` to **DIN-R**
 * (rechts angeschlagen) and `SingleSwingRight` to **DIN-L**. The names here
 * follow IFC, because that is what the file says; anybody comparing against a
 * German door schedule should expect the labels to swap.
 *
 * **The hinge end is the one thing here that cannot be derived from the
 * geometry**, so it is deliberately the whole of one small function: a model
 * whose plans say otherwise is a two-line fix here rather than a hunt through
 * the drawing code. `openingSymbols.test.ts` pins the mapping, so changing it
 * is a visible, deliberate edit.
 *
 * Unknown, user-defined and absent values become `'none'`: the opening is
 * drawn as an opening, with no leaf. That is a plan saying "the model does not
 * state how this opens", which is true and readable, rather than a confident
 * arc pointing into whichever room the default happened to pick.
 */
export function doorOperationFromIfc(operationType: string | undefined | null): DoorOperation {
  const value = (operationType ?? '').trim().toUpperCase();

  switch (value) {
    case 'SINGLE_SWING_LEFT':
    case 'DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT':
    case 'SWING_FIXED_LEFT':
      return { motion: 'swing', hinge: 'start' };

    case 'SINGLE_SWING_RIGHT':
    case 'DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT':
    case 'SWING_FIXED_RIGHT':
      return { motion: 'swing', hinge: 'end' };

    // Two leaves meeting in the middle, each hinged at its own jamb. Drawn as
    // two half-width swings rather than one wide one, which is what the
    // building actually does and what the space it needs looks like.
    case 'DOUBLE_DOOR_SINGLE_SWING':
    case 'DOUBLE_SWING_LEFT':
    case 'DOUBLE_SWING_RIGHT':
    case 'DOUBLE_DOOR_DOUBLE_SWING':
      return { motion: 'double-swing', hinge: 'start' };

    // A sliding or folding leaf sweeps nothing, so it gets no arc. Folding is
    // lumped in with sliding on purpose: at plan scale both are "a leaf that
    // stacks to the side", and drawing a fake concertina would be a detail the
    // model never stated.
    case 'SLIDING_TO_LEFT':
    case 'FOLDING_TO_LEFT':
      return { motion: 'sliding', hinge: 'start' };
    case 'SLIDING_TO_RIGHT':
    case 'FOLDING_TO_RIGHT':
      return { motion: 'sliding', hinge: 'end' };
    case 'DOUBLE_DOOR_SLIDING':
    case 'DOUBLE_DOOR_FOLDING':
      return { motion: 'sliding', hinge: 'start' };

    default:
      // REVOLVING, ROLLINGUP, USERDEFINED, NOTDEFINED, and anything absent.
      return { motion: 'none', hinge: 'start' };
  }
}

export interface PlanAxes {
  /** Along the opening's width, unit length, in drawing space. */
  readonly along: Point2D;
  /** The door's local +Y — the side a swing opens towards — unit length. */
  readonly across: Point2D;
}

/**
 * The opening's own axes, in the drawing's plane.
 *
 * `localToWorld` is row-major and WebGL Y-up, so its columns are the local
 * axes in world space. Drawing x IS world x and drawing y IS world z (the
 * mapping `planPick.ts` pins), which leaves:
 *
 * - local X (column 0) → the width direction,
 * - local Y in IFC → the opening direction. The Y-up conversion sends IFC
 *   `(x, y, z)` to `(x, z, -y)`, so IFC +Y is GL −Z: column 2, NEGATED.
 *
 * `null` when either axis vanishes in plan — a door lying flat in a ceiling
 * has no plan symbol, and projecting one would draw a zero-width arc.
 */
export function planAxes(localToWorld: ArrayLike<number> | undefined | null): PlanAxes | null {
  if (!localToWorld || localToWorld.length !== 16) return null;

  const alongX = localToWorld[0];
  const alongY = localToWorld[8];
  const acrossX = -localToWorld[2];
  const acrossY = -localToWorld[10];

  const alongLen = Math.hypot(alongX, alongY);
  const acrossLen = Math.hypot(acrossX, acrossY);
  if (!(alongLen > 1e-9) || !(acrossLen > 1e-9)) return null;

  return {
    along: { x: alongX / alongLen, y: alongY / alongLen },
    across: { x: acrossX / acrossLen, y: acrossY / acrossLen },
  };
}

/** Local-frame extents of an element, unioned over its submeshes. */
export interface LocalExtent {
  /** Along local X — the opening's width direction. */
  readonly width: number;
  /** Along local Z in the GL frame — the opening's depth through the wall. */
  readonly depth: number;
}

/**
 * How wide to draw the opening, in metres.
 *
 * The GEOMETRY leads and `OverallWidth` is only the fallback, which is the
 * opposite of the obvious choice and is what the schema asks for: IfcDoor
 * §6.1.3.16 ends with "The OverallWidth and OverallHeight parameters are for
 * informational purpose only." They are a convenience copy that nothing
 * obliges an exporter to keep in step with the shape it ships, and a swing arc
 * drawn to a stale number would overhang its own doorway.
 *
 * The mesh extent spans the lining rather than the clear opening, so the arc
 * is a few centimetres generous. On a plan that is the right way to be wrong:
 * the symbol shows the space the door needs, and the lining is part of it.
 *
 * `overallWidth` must already be in metres — see the length-unit trap in
 * `roomLabels.ts`; a millimetre model states 885, not 0.885.
 */
export function openingWidth(
  extent: LocalExtent | null | undefined,
  overallWidth: number | null | undefined,
): number | null {
  if (extent && extent.width > 0) return extent.width;
  if (typeof overallWidth === 'number' && Number.isFinite(overallWidth) && overallWidth > 0) {
    return overallWidth;
  }
  return null;
}

/** How finely an arc is broken into segments. Twelve over 90° is smooth at
 *  every zoom a plan is read at and stays cheap in an SVG export. */
const ARC_SEGMENTS = 12;

/** The quarter circle a leaf sweeps, hinge to closed position. */
function swingArc(hinge: Point2D, from: Point2D, to: Point2D, radius: number): SymbolLine[] {
  const a0 = Math.atan2(from.y, from.x);
  let sweep = Math.atan2(to.y, to.x) - a0;
  // The short way round. A door sweeps a quarter turn; going the long way
  // would draw three quarters of a circle through the wall.
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;

  const lines: SymbolLine[] = [];
  let prev = { x: hinge.x + from.x * radius, y: hinge.y + from.y * radius };
  for (let i = 1; i <= ARC_SEGMENTS; i++) {
    const a = a0 + (sweep * i) / ARC_SEGMENTS;
    const next = { x: hinge.x + Math.cos(a) * radius, y: hinge.y + Math.sin(a) * radius };
    lines.push({ start: prev, end: next });
    prev = next;
  }
  return lines;
}

export interface DoorSymbolParams {
  /** Middle of the opening, in drawing units. */
  readonly centre: Point2D;
  /** Clear width of the opening, in metres. */
  readonly width: number;
  readonly axes: PlanAxes;
  readonly operation: DoorOperation;
}

/**
 * A door as a plan draws it: the leaf where it stands open, and the arc it
 * sweeps to get there.
 *
 * The leaf is drawn at 90°, which is the drafting convention rather than a
 * claim about how far the door actually opens — it is the position that shows
 * both the hinge side and the space the door needs.
 */
export function doorSymbol({ centre, width, axes, operation }: DoorSymbolParams): SymbolLine[] {
  if (!(width > 0)) return [];
  const { along, across } = axes;
  const half = width / 2;

  const at = (t: number): Point2D => ({ x: centre.x + along.x * t, y: centre.y + along.y * t });
  const startJamb = at(-half);
  const endJamb = at(half);

  if (operation.motion === 'none') return [];

  if (operation.motion === 'sliding') {
    // A leaf parked beside its opening, offset just off the wall line so it
    // reads as a panel rather than as part of the wall.
    const offset = Math.min(0.06, width / 8);
    const shift = (p: Point2D): Point2D => ({ x: p.x + across.x * offset, y: p.y + across.y * offset });
    const from = operation.hinge === 'start' ? startJamb : endJamb;
    const to = operation.hinge === 'start' ? at(half * 0.9) : at(-half * 0.9);
    return [{ start: shift(from), end: shift(to) }];
  }

  if (operation.motion === 'double-swing') {
    // Each leaf is half the opening and hinged at its own jamb, so the two
    // arcs meet in the middle.
    const leafWidth = half;
    const openDir = across;
    return [
      { start: startJamb, end: { x: startJamb.x + openDir.x * leafWidth, y: startJamb.y + openDir.y * leafWidth } },
      ...swingArc(startJamb, openDir, along, leafWidth),
      { start: endJamb, end: { x: endJamb.x + openDir.x * leafWidth, y: endJamb.y + openDir.y * leafWidth } },
      ...swingArc(endJamb, openDir, { x: -along.x, y: -along.y }, leafWidth),
    ];
  }

  // Single swing. The leaf stands on the hinge and points across the wall; the
  // arc runs from its tip back to the jamb it closes against.
  const hinge = operation.hinge === 'start' ? startJamb : endJamb;
  const closed = operation.hinge === 'start' ? along : { x: -along.x, y: -along.y };
  return [
    { start: hinge, end: { x: hinge.x + across.x * width, y: hinge.y + across.y * width } },
    ...swingArc(hinge, across, closed, width),
  ];
}

export interface WindowSymbolParams {
  readonly centre: Point2D;
  /** Clear width of the opening, in metres. */
  readonly width: number;
  /** Depth of the window in the wall, in metres. */
  readonly depth: number;
  readonly axes: PlanAxes;
}

/**
 * A window as a plan draws it: the glazing line across the opening, with the
 * two frame lines either side of it.
 *
 * Three lines rather than one. A single line reads as a wall closing the
 * opening; the pair around it says "there is a frame here and something
 * transparent in it", which is what distinguishes a window from a hole at a
 * glance.
 */
export function windowSymbol({ centre, width, depth, axes }: WindowSymbolParams): SymbolLine[] {
  if (!(width > 0)) return [];
  const { along, across } = axes;
  const half = width / 2;
  // A window modelled with no depth still needs a readable frame; 60 mm is a
  // thin sash rather than a guess at the wall.
  const halfDepth = Math.max(depth, 0.06) / 2;

  const span = (offset: number): SymbolLine => ({
    start: {
      x: centre.x - along.x * half + across.x * offset,
      y: centre.y - along.y * half + across.y * offset,
    },
    end: {
      x: centre.x + along.x * half + across.x * offset,
      y: centre.y + along.y * half + across.y * offset,
    },
  });

  return [span(-halfDepth), span(0), span(halfDepth)];
}
