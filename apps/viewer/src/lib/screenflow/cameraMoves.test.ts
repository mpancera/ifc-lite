/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dollyViewpoint, liftViewpoint, orbitViewpoint, viewpointDistance } from './cameraMoves';
import type { CameraViewpoint } from '@/store';

const base: CameraViewpoint = {
  position: { x: 10, y: 5, z: 0 },
  target: { x: 0, y: 5, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fov: 45,
  projectionMode: 'perspective',
};

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('orbitViewpoint', () => {
  it('swings a quarter turn about the up axis', () => {
    const out = orbitViewpoint(base, 90);
    near(out.position.x, 0);
    near(out.position.y, 5);
    near(out.position.z, -10);
  });

  it('keeps distance, target and up untouched', () => {
    const out = orbitViewpoint(base, 37);
    near(viewpointDistance(out), viewpointDistance(base), 1e-9);
    assert.deepEqual(out.target, base.target);
    assert.deepEqual(out.up, base.up);
  });

  it('is reversible, so a clip can swing out and back', () => {
    const there = orbitViewpoint(base, 120);
    const back = orbitViewpoint(there, -120);
    near(back.position.x, base.position.x, 1e-9);
    near(back.position.z, base.position.z, 1e-9);
  });

  it('rotates about the declared up axis, not about Y by assumption', () => {
    const zUp: CameraViewpoint = { ...base, position: { x: 10, y: 0, z: 5 }, target: { x: 0, y: 0, z: 5 }, up: { x: 0, y: 0, z: 1 } };
    const out = orbitViewpoint(zUp, 90);
    near(out.position.x, 0);
    near(out.position.y, 10);
    near(out.position.z, 5, 1e-9);
  });
});

describe('dollyViewpoint', () => {
  it('halves the distance without moving the target', () => {
    const out = dollyViewpoint(base, 0.5);
    near(viewpointDistance(out), 5);
    assert.deepEqual(out.target, base.target);
  });

  it('refuses to pass through the target', () => {
    const out = dollyViewpoint(base, -2);
    assert.ok(viewpointDistance(out) > 0, 'camera must stay in front of its target');
    near(out.position.x, 0.1);
  });
});

describe('liftViewpoint', () => {
  it('moves along up and leaves the target alone', () => {
    const out = liftViewpoint(base, 3);
    near(out.position.y, 8);
    assert.deepEqual(out.target, base.target);
  });
});
