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
  /**
   * Which side of the wall the leaf swings to, as a multiple of `across`.
   *
   * `+1` is the door's local +Y, which is where the schema says a panel always
   * opens. `-1` only ever comes from geometry that says otherwise, and
   * geometry outranks the schema here for the reason below.
   */
  readonly openTowards: 1 | -1;
}

/** An element's object-space box, as `MeshData.localBounds` delivers it. */
export interface LocalBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

const boxWidth = (b: LocalBox) => b.max[0] - b.min[0];
const boxHeight = (b: LocalBox) => b.max[1] - b.min[1];
const boxDepth = (b: LocalBox) => b.max[2] - b.min[2];

export interface OpeningParts {
  /**
   * The piece that spans the opening — the lining, which by definition sits IN
   * the wall. Everything positional is measured off this and not off the
   * element as a whole, because the whole is not necessarily in the wall.
   */
  readonly reveal: LocalBox;
  /** The leaf, when the model draws one standing open. `null` otherwise. */
  readonly leaf: LocalBox | null;
}

/**
 * Split an opening's pieces into the part in the wall and the swinging leaf.
 *
 * # Why this exists at all
 * A door is often modelled with its leaf STANDING OPEN — the 3D view of such a
 * model shows a building full of open doors, and that is correct, it is what
 * the file says. It also means the element's bounding box is as deep as the
 * door is wide, and its middle is half a leaf-length out in the room. Taking
 * the element's centre as the opening's centre therefore pushes every symbol
 * off its own doorway, in the swing direction, by an amount that looks like a
 * small bug and is actually a large misreading.
 *
 * The lining is found as the WIDEST piece across the opening. That works
 * whichever way the leaf is drawn: swung open, the leaf is thin along the wall
 * (four centimetres of panel edge); swung shut, it is inside the lining
 * anyway. Handles and hinges are dropped first by height — they are the only
 * parts substantially shorter than the door.
 */
export function classifyOpeningParts(boxes: readonly LocalBox[]): OpeningParts | null {
  if (boxes.length === 0) return null;

  const tallest = Math.max(...boxes.map(boxHeight));
  // Half the door's height keeps frame, leaf and glazing and drops the
  // ironmongery, which is an order of magnitude smaller.
  const structural = boxes.filter((b) => boxHeight(b) >= tallest * 0.5);
  if (structural.length === 0) return null;

  let reveal = structural[0];
  for (const b of structural) {
    if (boxWidth(b) > boxWidth(reveal)) reveal = b;
  }

  const span = boxWidth(reveal);
  if (!(span > 0)) return null;

  // A leaf standing open: narrow across the opening, and reaching well out of
  // the wall. Both conditions, because a glazing panel is narrow too and a
  // sill is deep too, and neither is a leaf.
  let leaf: LocalBox | null = null;
  for (const b of structural) {
    if (b === reveal) continue;
    if (boxWidth(b) > span * 0.3) continue;
    if (boxDepth(b) < span * 0.3) continue;
    if (leaf === null || boxDepth(b) > boxDepth(leaf)) leaf = b;
  }

  return { reveal, leaf };
}

/**
 * Hinge side and swing direction read off a leaf the model actually drew.
 *
 * This outranks `OperationType`, and not as a matter of taste. Measured over
 * the 27 doors of one real project model, the attribute and the geometry agree
 * no better than chance: of twenty doors marked `SINGLE_SWING_LEFT`, eleven
 * are hung at one end and nine at the other. The exporter writes the enum
 * without reference to the door it is describing — which is exactly the class
 * of "informational only" attribute the schema warns about for OverallWidth,
 * and the same answer applies. The drawn leaf cannot disagree with the 3D
 * view, because it IS the 3D view.
 *
 * `openTowards` is a multiple of `across`, and `across` is the door's local +Y
 * in the drawing, which is GL local −Z. So a leaf reaching past the lining
 * towards +Z is swinging to −across.
 */
export function swingFromGeometry(
  reveal: LocalBox, leaf: LocalBox,
): { hinge: HingeEnd; openTowards: 1 | -1 } {
  const leafCentre = (leaf.min[0] + leaf.max[0]) / 2;
  const revealCentre = (reveal.min[0] + reveal.max[0]) / 2;

  const beyondPlus = leaf.max[2] - reveal.max[2];
  const beyondMinus = reveal.min[2] - leaf.min[2];

  return {
    hinge: leafCentre < revealCentre ? 'start' : 'end',
    openTowards: beyondPlus > beyondMinus ? -1 : 1,
  };
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
      return { motion: 'swing', hinge: 'start', openTowards: 1 };

    case 'SINGLE_SWING_RIGHT':
    case 'DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT':
    case 'SWING_FIXED_RIGHT':
      return { motion: 'swing', hinge: 'end', openTowards: 1 };

    // Two leaves meeting in the middle, each hinged at its own jamb. Drawn as
    // two half-width swings rather than one wide one, which is what the
    // building actually does and what the space it needs looks like.
    case 'DOUBLE_DOOR_SINGLE_SWING':
    case 'DOUBLE_SWING_LEFT':
    case 'DOUBLE_SWING_RIGHT':
    case 'DOUBLE_DOOR_DOUBLE_SWING':
      return { motion: 'double-swing', hinge: 'start', openTowards: 1 };

    // A sliding or folding leaf sweeps nothing, so it gets no arc. Folding is
    // lumped in with sliding on purpose: at plan scale both are "a leaf that
    // stacks to the side", and drawing a fake concertina would be a detail the
    // model never stated.
    case 'SLIDING_TO_LEFT':
    case 'FOLDING_TO_LEFT':
      return { motion: 'sliding', hinge: 'start', openTowards: 1 };
    case 'SLIDING_TO_RIGHT':
    case 'FOLDING_TO_RIGHT':
      return { motion: 'sliding', hinge: 'end', openTowards: 1 };
    case 'DOUBLE_DOOR_SLIDING':
    case 'DOUBLE_DOOR_FOLDING':
      return { motion: 'sliding', hinge: 'start', openTowards: 1 };

    default:
      // REVOLVING, ROLLINGUP, USERDEFINED, NOTDEFINED, and anything absent.
      return { motion: 'none', hinge: 'start', openTowards: 1 };
  }
}

/**
 * The enum value that would describe a swing the geometry actually shows.
 *
 * The inverse of {@link doorOperationFromIfc}, and it exists so a wrong
 * attribute can be CORRECTED rather than only reported. Where a model's
 * `OperationType` disagrees with the leaf its own geometry draws, this is what
 * the attribute should have said.
 *
 * Only the swinging cases can be written back. A sliding leaf's enum carries
 * which way it slides, and that is not what `hinge` means for a sliding door
 * here — inventing a value from it would replace one wrong statement with
 * another. `null` says "the geometry does not determine this", which is the
 * true answer.
 */
export function operationTypeForSwing(operation: DoorOperation): string | null {
  switch (operation.motion) {
    case 'swing':
      return operation.hinge === 'start' ? 'SINGLE_SWING_LEFT' : 'SINGLE_SWING_RIGHT';
    case 'double-swing':
      return 'DOUBLE_DOOR_SINGLE_SWING';
    default:
      return null;
  }
}

/**
 * Whether the model's `OperationType` says the same thing the drawn leaf does.
 *
 * `null` when there is nothing to compare — no attribute, no leaf, or an
 * attribute that states no swing at all. That is a third answer and not a
 * quiet "yes": a door nobody described is not a door described correctly, and
 * counting it as agreement would hide exactly the models this exists for.
 */
export function attributeAgreesWithGeometry(
  stated: DoorOperation,
  drawn: { hinge: HingeEnd },
): boolean | null {
  if (stated.motion !== 'swing') return null;
  return stated.hinge === drawn.hinge;
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

/**
 * How thick the host wall is, measured off the wall AS DRAWN.
 *
 * The frame in a plan has to be as deep as the wall it sits in, and every
 * other source for that lies in some model or other:
 *
 * - the LINING's own depth is the frame, which frequently runs past the
 *   plaster — truthful in 3D, and in plan it draws frame outside the wall;
 * - `Qto_WallBaseQuantities.Width` came out as 150000 on a model whose
 *   `Length` and `Height` were honest millimetres, so it cannot be trusted
 *   without a sanity check that would itself need a second source;
 * - the wall mesh's own extent across the door measured 0.92 on two of three
 *   walls, because a wall mesh carries its returns and corners.
 *
 * The wall's CUT POLYGON cannot be wrong in the same way: it is the wall at
 * the height being drawn, in the frame being drawn, and if it disagreed with
 * the plan the plan would be visibly wrong.
 *
 * Only the vertices ACROSS the doorway are measured. Elsewhere along its
 * length a wall may thicken, turn a corner or meet another wall; at the
 * opening it is just the wall, and its two faces are what the reveal corners
 * sit on.
 *
 * `null` when the polygon has nothing in that span — a wall drawn without its
 * opening, or the wrong polygon entirely.
 */
export function wallThicknessAtOpening(
  rings: readonly (readonly Point2D[])[],
  axes: PlanAxes,
  /** The opening's extent along the wall, as `[min, max]` in the along axis. */
  alongSpan: readonly [number, number],
  /** How far past the jambs to still count as "at the opening", in metres. */
  tolerance = 0.05,
): number | null {
  const { along, across } = axes;
  const lo = alongSpan[0] - tolerance;
  const hi = alongSpan[1] + tolerance;

  let minB = Infinity;
  let maxB = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      const a = p.x * along.x + p.y * along.y;
      if (a < lo || a > hi) continue;
      const b = p.x * across.x + p.y * across.y;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }
  }

  if (!Number.isFinite(minB) || !(maxB > minB)) return null;
  return maxB - minB;
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

/**
 * The three widths a door has, which are three different numbers.
 *
 * Conflating them is what makes a derived symbol look almost right: the arc
 * has to sweep the CLEAR passage, because that is what the leaf spans, while
 * the jambs sit at the ROUGH opening where the frame meets the wall. Drawing
 * the arc to the rough width overhangs the doorway by the frame on each side.
 */
export interface DoorWidths {
  /** Outer width of the opening in the wall — where the jambs are drawn. */
  readonly rough: number;
  /** Frame member width, per side. */
  readonly lining: number;
  /** Clear passage: what the leaf spans and the arc sweeps. */
  readonly clear: number;
  /** Whether {@link lining} was read from the model or assumed. */
  readonly liningSource: 'model' | 'assumed';
}

export interface DoorSymbolParams {
  /** Middle of the opening, in drawing units. */
  readonly centre: Point2D;
  readonly widths: DoorWidths;
  /** How deep the frame sits through the wall, in metres. */
  readonly depth: number;
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
/**
 * A door symbol, in its two parts.
 *
 * Named rather than one flat bundle because they answer to different things:
 * the frame is measured and always drawable, the swing depends on the model
 * having said how the door opens. Keeping them apart also means a test can
 * point at one without counting past the other.
 */
export interface DoorSymbolParts {
  /** The lining at each jamb. Always present for a real opening. */
  readonly frame: SymbolLine[];
  /** Leaf and arc. Empty when the model states no operation. */
  readonly swing: SymbolLine[];
}

/** The whole symbol as one stroke list: swing over frame. */
export function doorSymbolLines(parts: DoorSymbolParts): SymbolLine[] {
  return [...parts.swing, ...parts.frame];
}

export function doorSymbol({
  centre, widths, depth, axes, operation,
}: DoorSymbolParams): DoorSymbolParts {
  const empty: DoorSymbolParts = { frame: [], swing: [] };
  const { rough, lining, clear } = widths;
  if (!(rough > 0) || !(clear > 0)) return empty;
  const { along } = axes;
  // The side the leaf actually goes to. `across` alone is the schema's answer;
  // multiplying by `openTowards` lets a drawn leaf overrule it.
  const across = {
    x: axes.across.x * operation.openTowards,
    y: axes.across.y * operation.openTowards,
  };

  const at = (u: number, v = 0): Point2D => ({
    x: centre.x + along.x * u + across.x * v,
    y: centre.y + along.y * u + across.y * v,
  });

  // The frame: a rectangle at each jamb, from the wall face inward by the
  // lining. This is what makes the doorway read as a door rather than as a
  // gap, and it is where the clear passage visibly begins.
  const halfRough = rough / 2;
  const halfClear = clear / 2;
  const halfDepth = Math.max(depth, 0.04) / 2;
  const frame: SymbolLine[] = [];
  for (const side of [-1, 1] as const) {
    const outer = side * halfRough;
    const inner = side * halfClear;
    const corners = [
      at(outer, -halfDepth), at(inner, -halfDepth),
      at(inner, halfDepth), at(outer, halfDepth),
    ];
    for (let i = 0; i < corners.length; i++) {
      frame.push({ start: corners[i], end: corners[(i + 1) % corners.length] });
    }
  }

  // An opening whose operation the model never stated still gets its frame:
  // that much is measured, and it is more than the bare gap the cut leaves.
  if (operation.motion === 'none') return { frame, swing: [] };

  const startJamb = at(-halfClear);
  const endJamb = at(halfClear);

  if (operation.motion === 'sliding') {
    // A leaf parked beside its opening, offset just off the wall line so it
    // reads as a panel rather than as part of the wall.
    const offset = Math.min(0.06, clear / 8);
    const shift = (p: Point2D): Point2D => ({ x: p.x + across.x * offset, y: p.y + across.y * offset });
    const from = operation.hinge === 'start' ? startJamb : endJamb;
    const to = operation.hinge === 'start' ? at(halfClear * 0.9) : at(-halfClear * 0.9);
    return { frame, swing: [{ start: shift(from), end: shift(to) }] };
  }

  if (operation.motion === 'double-swing') {
    // Each leaf is half the clear passage and hinged at its own jamb, so the
    // two arcs meet in the middle.
    const leaf = halfClear;
    return {
      frame,
      swing: [
        { start: startJamb, end: { x: startJamb.x + across.x * leaf, y: startJamb.y + across.y * leaf } },
        ...swingArc(startJamb, across, along, leaf),
        { start: endJamb, end: { x: endJamb.x + across.x * leaf, y: endJamb.y + across.y * leaf } },
        ...swingArc(endJamb, across, { x: -along.x, y: -along.y }, leaf),
      ],
    };
  }

  // Single swing. The leaf stands on the hinge and points across the wall; the
  // arc runs from its tip back to the jamb it closes against. Both are the
  // CLEAR width — a leaf is as long as the hole it fills, not as the hole plus
  // its frame, and drawing it to the rough opening overhangs the doorway by
  // one lining on each side. `lining` is otherwise unused here, and that is
  // the point: it has already done its work by narrowing `clear`.
  void lining;
  const hinge = operation.hinge === 'start' ? startJamb : endJamb;
  const closed = operation.hinge === 'start' ? along : { x: -along.x, y: -along.y };
  return {
    frame,
    swing: [
      { start: hinge, end: { x: hinge.x + across.x * clear, y: hinge.y + across.y * clear } },
      ...swingArc(hinge, across, closed, clear),
    ],
  };
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
