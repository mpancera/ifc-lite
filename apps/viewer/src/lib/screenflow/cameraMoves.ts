/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Camera moves for a screenflow, as arithmetic on a viewpoint.
 *
 * # Why derived moves and not recorded viewpoints
 * A viewpoint pinned to coordinates is a viewpoint pinned to one version of
 * one model. The demo model is still being corrected -- storeys move, rooms
 * come and go -- and a hand-recorded camera would quietly start framing the
 * wrong thing without failing. These moves are all relative to wherever the
 * camera already is (which `fitAll` puts somewhere sensible for the CURRENT
 * model), so the clip survives the model changing underneath it.
 *
 * # Rotating about the viewpoint's own up vector
 * The rotation uses Rodrigues about `up` rather than assuming Y is up. The
 * viewer is Y-up today, but a camera move is exactly the kind of code that
 * gets silently wrong when a convention changes, and the general form costs
 * three lines more.
 *
 * The tween itself belongs to the renderer: `applyViewpoint(vp, true, ms)`
 * already animates, and reusing it means the clip moves the camera the same
 * way the rest of the app does.
 */

import type { CameraViewpoint } from '@/store';

type Vec3 = { x: number; y: number; z: number };

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (a: Vec3): number => Math.sqrt(dot(a, a));

function normalise(a: Vec3): Vec3 {
  const len = length(a);
  return len === 0 ? { x: 0, y: 1, z: 0 } : scale(a, 1 / len);
}

/** Rodrigues: rotate `v` about the unit axis `axis` by `radians`. */
function rotateAbout(v: Vec3, axis: Vec3, radians: number): Vec3 {
  const k = normalise(axis);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return add(
    add(scale(v, cos), scale(cross(k, v), sin)),
    scale(k, dot(k, v) * (1 - cos)),
  );
}

/**
 * Swing the camera around its target by `degrees`, keeping distance, height
 * and the target itself. Positive is counter-clockwise seen from above.
 */
export function orbitViewpoint(vp: CameraViewpoint, degrees: number): CameraViewpoint {
  const offset = sub(vp.position, vp.target);
  const rotated = rotateAbout(offset, vp.up, (degrees * Math.PI) / 180);
  return { ...vp, position: add(vp.target, rotated) };
}

/**
 * Move the camera along its view axis. `factor` below 1 comes closer, above 1
 * pulls back; the target does not move, so the framing stays centred on the
 * same thing. A factor at or below zero would put the camera behind its own
 * target, so it is refused in favour of a very close approach.
 */
export function dollyViewpoint(vp: CameraViewpoint, factor: number): CameraViewpoint {
  const safe = factor > 0.01 ? factor : 0.01;
  const offset = sub(vp.position, vp.target);
  return { ...vp, position: add(vp.target, scale(offset, safe)) };
}

/** Raise or lower the camera along its up axis without moving the target. */
export function liftViewpoint(vp: CameraViewpoint, distance: number): CameraViewpoint {
  return { ...vp, position: add(vp.position, scale(normalise(vp.up), distance)) };
}

/** Distance from camera to target -- the scale every move is relative to. */
export function viewpointDistance(vp: CameraViewpoint): number {
  return length(sub(vp.position, vp.target));
}
