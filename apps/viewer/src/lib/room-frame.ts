/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Getting a sketched room out of the frame it was drawn in and into the one the
 * file is written in.
 *
 * # Two frames, and they are not the same one
 *
 * Space Sketch works in the ROOM frame — what `wall-rects-from-meshes.ts`
 * produces: the rendered geometry, with the RTC offset the mesh path subtracted
 * left out, X east and Y north. Everything the tool does is right in that
 * frame, because the walls it reads are in it too.
 *
 * `addSpace` writes an outline into a slot that is STOREY-LOCAL: the polygon is
 * carried by an `IfcExtrudedAreaSolid` under a placement that hangs off the
 * storey, so the file applies the storey's whole placement chain to it on the
 * way out. Where that chain is the identity the two frames coincide, which is
 * every model without georeferencing — and why this went unnoticed.
 *
 * Give the site a placement and they come apart:
 *
 *     p_room = R · p_storeyLocal + T − rtc
 *
 * with `R` and `T` from the storey's chain (storey axis ∘ building ∘ site).
 * Writing `p_room` into the storey-local slot therefore has the file apply `R`
 * and `T` a SECOND time. Measured on a georeferenced model whose site carries a
 * 9.08° rotation and a national-grid origin: every baked room landed about 31 m
 * from the building and turned against it, while looking perfectly placed in
 * the session it was drawn in — the drawing reads the room frame, the file
 * reads the storey.
 *
 * So the outline is folded back through the chain on the way out, which is what
 * {@link toStoreyLocal} does.
 *
 * # Refusing rather than guessing
 *
 * A storey whose chain tilts out of plan (an `Axis` that is not vertical) has no
 * honest 2D inverse, and neither has one whose links cannot be read. Both return
 * `null` so the caller can say so, instead of writing a room that is subtly
 * wrong in a way nobody will notice until it is quoted in a schedule.
 */

export type Pt = [number, number];

/** A rigid transform in plan: `p ↦ R·p + T`. */
export interface PlanFrame {
  cos: number;
  sin: number;
  tx: number;
  ty: number;
}

export const IDENTITY_FRAME: PlanFrame = { cos: 1, sin: 0, tx: 0, ty: 0 };

/** Reads an entity's attributes, or `null` when it is not there. */
export type ReadAttrs = (expressId: number) => readonly unknown[] | null | undefined;

/** `IfcProduct.ObjectPlacement`. */
const OBJECT_PLACEMENT = 5;
/** `IfcLocalPlacement.PlacementRelTo` / `.RelativePlacement`. */
const PLACEMENT_REL_TO = 0;
const RELATIVE_PLACEMENT = 1;
/** `IfcAxis2Placement3D.Location` / `.Axis` / `.RefDirection`. */
const AXIS_LOCATION = 0;
const AXIS_Z = 1;
const AXIS_REF_DIRECTION = 2;

/** How far an axis may lean off vertical and still count as upright. */
const UPRIGHT_TOLERANCE = 1e-6;
/** A chain longer than this is a cycle, not a building. */
const MAX_CHAIN = 32;

function ref(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    const m = /^#(\d+)$/.exec(value.trim());
    return m ? Number(m[1]) : null;
  }
  return null;
}

function numbers(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const v of value) {
    const n = typeof v === 'number' ? v : typeof v === 'object' && v && 'real' in v
      ? (v as { real: number }).real
      : NaN;
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

/** `A ∘ B` — B first, then A. */
function compose(a: PlanFrame, b: PlanFrame): PlanFrame {
  return {
    cos: a.cos * b.cos - a.sin * b.sin,
    sin: a.sin * b.cos + a.cos * b.sin,
    tx: a.cos * b.tx - a.sin * b.ty + a.tx,
    ty: a.sin * b.tx + a.cos * b.ty + a.ty,
  };
}

/** One `IfcAxis2Placement3D` as a plan transform, or `null` when it leans. */
function axisFrame(read: ReadAttrs, axisId: number): PlanFrame | null {
  const axis = read(axisId);
  if (!axis) return null;

  // `Axis` is optional and means (0,0,1) when absent. When it is there and
  // leans, the placement tips out of plan and has no honest 2D inverse.
  const upId = ref(axis[AXIS_Z]);
  if (upId !== null) {
    const up = read(upId);
    const ratios = up ? numbers(up[0]) : null;
    if (!ratios) return null;
    if (Math.abs(ratios[0] ?? 0) > UPRIGHT_TOLERANCE || Math.abs(ratios[1] ?? 0) > UPRIGHT_TOLERANCE) {
      return null;
    }
  }

  let tx = 0;
  let ty = 0;
  const locId = ref(axis[AXIS_LOCATION]);
  if (locId !== null) {
    const loc = read(locId);
    const xyz = loc ? numbers(loc[0]) : null;
    if (!xyz) return null;
    tx = xyz[0] ?? 0;
    ty = xyz[1] ?? 0;
  }

  let cos = 1;
  let sin = 0;
  const dirId = ref(axis[AXIS_REF_DIRECTION]);
  if (dirId !== null) {
    const dir = read(dirId);
    const ratios = dir ? numbers(dir[0]) : null;
    if (!ratios) return null;
    const len = Math.hypot(ratios[0] ?? 0, ratios[1] ?? 0);
    if (len < UPRIGHT_TOLERANCE) return null;
    cos = (ratios[0] ?? 0) / len;
    sin = (ratios[1] ?? 0) / len;
  }
  return { cos, sin, tx, ty };
}

/**
 * The transform a storey's placement chain applies to anything placed on it:
 * storey-local → the file's world frame.
 *
 * Walks `PlacementRelTo` to the root and folds site ∘ building ∘ storey.
 */
export function storeyPlanFrame(read: ReadAttrs, storeyId: number): PlanFrame | null {
  const storey = read(storeyId);
  if (!storey) return null;
  let placementId = ref(storey[OBJECT_PLACEMENT]);
  if (placementId === null) return null;

  let total: PlanFrame = IDENTITY_FRAME;
  for (let step = 0; step < MAX_CHAIN && placementId !== null; step++) {
    const placement = read(placementId);
    if (!placement) return null;
    const axisId = ref(placement[RELATIVE_PLACEMENT]);
    if (axisId === null) return null;
    const frame = axisFrame(read, axisId);
    if (!frame) return null;
    // Outward: each ancestor wraps everything resolved so far.
    total = compose(frame, total);
    placementId = ref(placement[PLACEMENT_REL_TO]);
  }
  return total;
}

/**
 * A point in the room frame, expressed storey-locally — the inverse of the
 * chain, with the RTC offset added back because the room frame had it removed.
 */
export function toStoreyLocal(frame: PlanFrame, rtc: { x: number; y: number }, p: Pt): Pt {
  const wx = p[0] + rtc.x - frame.tx;
  const wy = p[1] + rtc.y - frame.ty;
  // R⁻¹ is Rᵀ for a rotation.
  return [frame.cos * wx + frame.sin * wy, -frame.sin * wx + frame.cos * wy];
}

/**
 * The other direction: a storey-local point in the room frame.
 *
 * Needed because the tool READS its own rooms back — to notice a room that is
 * already there and not lay a second one on top of it. Those come out of the
 * file storey-locally, so without this the dedup compares two different frames,
 * matches nothing, and quietly duplicates every room on the next confirm.
 */
export function fromStoreyLocal(frame: PlanFrame, rtc: { x: number; y: number }, p: Pt): Pt {
  return [
    frame.cos * p[0] - frame.sin * p[1] + frame.tx - rtc.x,
    frame.sin * p[0] + frame.cos * p[1] + frame.ty - rtc.y,
  ];
}

/** Whether a frame is close enough to the identity to leave points alone. */
export function isIdentity(frame: PlanFrame, rtc: { x: number; y: number }): boolean {
  return Math.abs(frame.cos - 1) < 1e-12 && Math.abs(frame.sin) < 1e-12
    && Math.abs(frame.tx - rtc.x) < 1e-9 && Math.abs(frame.ty - rtc.y) < 1e-9;
}
