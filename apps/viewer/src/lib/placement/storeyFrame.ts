/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where a storey's own coordinate frame sits in the world.
 *
 * Everything the viewer AUTHORS is written storey-local: a room's profile
 * points, a wall's start and end, a column's position. Everything it DRAWS is
 * world. The conversion between the two was a bare axis swap — `[x, -z, 0]` —
 * which is the right answer only when the storey's placement chain is the
 * identity.
 *
 * On a real surveyed model it is not. The Langmatt architecture model puts the
 * whole building under a site placement with
 * `RefDirection = (0.98746437, -0.15784206, 0)`: a nine-degree turn, plus a
 * translation into Swiss coordinates. So a room drawn on the plan was written
 * into a frame turned nine degrees away from the one it was drawn in, and came
 * back out sitting at an angle to its own walls (Marc, 2026-09-16).
 *
 * What made it hard to see: the EDIT HANDLES read the same storey-local
 * numbers back through the same missing conversion, so the handles agreed with
 * where the room had been drawn while the mesh did not. Two readings sharing
 * one wrong assumption look like confirmation. Only the renderer, which
 * applies the real chain, was telling the truth.
 *
 * ## What this covers, and what it refuses
 *
 * Rotations about Z only — a building turned on its site, which is what a
 * placement chain holds in practice. A chain with an axis tilted off vertical
 * is reported as unsupported rather than flattened: a tilted frame silently
 * treated as upright produces output that is plausible and wrong, which is the
 * failure this whole module exists to end.
 */

/**
 * A storey's frame as a plane transform: turn by `rotationRad` about Z, then
 * translate by `origin`. All values in the file's own length unit.
 */
export interface StoreyFrame {
  origin: readonly [number, number, number];
  rotationRad: number;
}

/** The frame that changes nothing — a chain of identity placements. */
export const IDENTITY_STOREY_FRAME: StoreyFrame = { origin: [0, 0, 0], rotationRad: 0 };

/** Whether this frame is the one the old bare axis swap assumed. */
export function isIdentityFrame(frame: StoreyFrame): boolean {
  return frame.rotationRad === 0
    && frame.origin[0] === 0 && frame.origin[1] === 0 && frame.origin[2] === 0;
}

/** Attribute reader, so this module needs no parser build to be tested. */
export type RawAttrs = (expressId: number) => unknown[] | null;

function refId(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = /^#(\d+)$/.exec(value.trim());
    if (match) return Number(match[1]);
  }
  return null;
}

function triple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value)) return null;
  const nums = value.map((v) => (typeof v === 'number' ? v : Number(v)));
  if (nums.length < 2 || nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0], nums[1], nums[2] ?? 0];
}

/**
 * One `IfcAxis2Placement3D` as a frame.
 *
 * `null` when the axis is tilted off vertical — see the module note. An absent
 * Axis or RefDirection is the IFC default (Z up, X east), not a refusal.
 */
function axisFrame(attrs: unknown[], read: RawAttrs): StoreyFrame | null {
  const locationId = refId(attrs[0]);
  const location = locationId === null ? null : read(locationId);
  const origin = location ? triple(location[0]) : null;
  if (!origin) return null;

  const axisRef = refId(attrs[1]);
  if (axisRef !== null) {
    const axis = read(axisRef);
    const dir = axis ? triple(axis[0]) : null;
    if (dir && !(Math.abs(dir[0]) < 1e-9 && Math.abs(dir[1]) < 1e-9 && dir[2] > 0)) return null;
  }

  const refDirectionRef = refId(attrs[2]);
  if (refDirectionRef === null) return { origin, rotationRad: 0 };
  const refDirection = read(refDirectionRef);
  const dir = refDirection ? triple(refDirection[0]) : null;
  if (!dir) return { origin, rotationRad: 0 };
  if (Math.abs(dir[2]) > 1e-9) return null;
  return { origin, rotationRad: Math.atan2(dir[1], dir[0]) };
}

/** `inner` applied within `outer` — the composition a placement chain is. */
function compose(outer: StoreyFrame, inner: StoreyFrame): StoreyFrame {
  const c = Math.cos(outer.rotationRad);
  const s = Math.sin(outer.rotationRad);
  const [x, y, z] = inner.origin;
  return {
    origin: [
      outer.origin[0] + x * c - y * s,
      outer.origin[1] + x * s + y * c,
      outer.origin[2] + z,
    ],
    rotationRad: outer.rotationRad + inner.rotationRad,
  };
}

/** How many `PlacementRelTo` links to follow before calling it a cycle. */
const MAX_CHAIN = 32;

/**
 * The accumulated frame of an entity's `ObjectPlacement`, walking
 * `PlacementRelTo` to the top.
 *
 * `null` means "cannot be expressed as a turn about Z plus a shift" — a tilted
 * placement, a malformed chain, or one deeper than any real file. Callers fall
 * back to the identity, which is what they used unconditionally before, and
 * say so rather than pretending.
 */
export function resolveStoreyFrame(read: RawAttrs, productId: number): StoreyFrame | null {
  const product = read(productId);
  if (!product) return null;

  // IfcProduct.ObjectPlacement is attribute 5.
  let placementId = refId(product[5]);
  const chain: StoreyFrame[] = [];

  for (let depth = 0; placementId !== null; depth += 1) {
    if (depth >= MAX_CHAIN) return null;
    const placement = read(placementId);
    if (!placement) return null;

    // IfcLocalPlacement: [0] PlacementRelTo, [1] RelativePlacement.
    const axisId = refId(placement[1]);
    if (axisId === null) return null;
    const axis = read(axisId);
    if (!axis) return null;
    const frame = axisFrame(axis, read);
    if (!frame) return null;
    chain.push(frame);

    placementId = refId(placement[0]);
  }

  if (chain.length === 0) return null;
  // Outermost first: the last link followed is the one nearest the world.
  let result = chain[chain.length - 1];
  for (let i = chain.length - 2; i >= 0; i -= 1) result = compose(result, chain[i]);
  return result;
}

/** A point in the storey's own frame, as a world point. */
export function storeyLocalToWorld(
  frame: StoreyFrame,
  point: readonly [number, number, number],
): [number, number, number] {
  const c = Math.cos(frame.rotationRad);
  const s = Math.sin(frame.rotationRad);
  return [
    frame.origin[0] + point[0] * c - point[1] * s,
    frame.origin[1] + point[0] * s + point[1] * c,
    frame.origin[2] + point[2],
  ];
}

/** A world point, in the storey's own frame. The inverse of the above. */
export function worldToStoreyLocal(
  frame: StoreyFrame,
  point: readonly [number, number, number],
): [number, number, number] {
  const dx = point[0] - frame.origin[0];
  const dy = point[1] - frame.origin[1];
  const c = Math.cos(-frame.rotationRad);
  const s = Math.sin(-frame.rotationRad);
  return [dx * c - dy * s, dx * s + dy * c, point[2] - frame.origin[2]];
}

/** Memoised attribute reads — a chain walk revisits the same site placement. */
export function cachingReader(extract: (expressId: number) => unknown[] | null): RawAttrs {
  const cache = new Map<number, unknown[] | null>();
  return (expressId) => {
    const hit = cache.get(expressId);
    if (hit !== undefined) return hit;
    const attrs = extract(expressId);
    cache.set(expressId, attrs);
    return attrs;
  };
}
