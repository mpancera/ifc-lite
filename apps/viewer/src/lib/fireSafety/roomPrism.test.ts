/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chainRings, roomPrism, type PrismMesh } from './roomPrism.js';

/** A box from (x0,z0) to (x1,z1), floor at y0, ceiling at y1. */
function box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): PrismMesh {
  const p = [
    x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1,
    x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1,
  ];
  const i = [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ];
  return { positions: new Float32Array(p), indices: new Uint32Array(i) };
}

function area(ring: ReadonlyArray<readonly [number, number]>): number {
  let s = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

describe('chainRings', () => {
  it('closes a square whatever order its edges arrive in', () => {
    // `boundaryEdges` answers in map order with no consistent winding, so a
    // walk that only followed a → b would stop at the first edge stored
    // backwards and hand back a ring of one segment.
    const rings = chainRings([
      { a: { x: 4, y: 0 }, b: { x: 4, y: 3 } },
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 0, y: 3 }, b: { x: 0, y: 0 } },
      { a: { x: 4, y: 3 }, b: { x: 0, y: 3 } },
    ]);

    assert.equal(rings.length, 1);
    assert.equal(rings[0].length, 4, 'four corners, the closing repeat dropped');
    assert.equal(area(rings[0]), 12);
  });

  it('keeps two separate rings apart', () => {
    const rings = chainRings([
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { a: { x: 1, y: 0 }, b: { x: 1, y: 1 } },
      { a: { x: 1, y: 1 }, b: { x: 0, y: 0 } },
      { a: { x: 9, y: 9 }, b: { x: 10, y: 9 } },
      { a: { x: 10, y: 9 }, b: { x: 10, y: 10 } },
      { a: { x: 10, y: 10 }, b: { x: 9, y: 9 } },
    ]);

    assert.equal(rings.length, 2);
  });

  it('drops a chain too short to be a profile', () => {
    assert.deepEqual(chainRings([{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }]), []);
  });

  it('terminates on edges that do not close', () => {
    // A figure of eight, or a mesh with a stray edge: the walk must stop
    // rather than circle. The assertion is that this returns at all.
    const rings = chainRings([
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { a: { x: 1, y: 0 }, b: { x: 2, y: 0 } },
      { a: { x: 2, y: 0 }, b: { x: 3, y: 0 } },
    ]);

    assert.ok(Array.isArray(rings));
  });
});

describe('roomPrism', () => {
  it('reads the outline off the plan axes and the height off the vertical', () => {
    // X and Z are the plan; Y is what a room is extruded along. Taking the
    // wrong pair would give a compartment body standing on its side.
    const prism = roomPrism([box(0, 0, 4, 3, 10, 12.8)]);

    assert.ok(prism);
    assert.equal(area(prism.ring), 12);
    assert.equal(prism.baseY, 10);
    assert.ok(Math.abs(prism.height - 2.8) < 1e-5);
  });

  it('follows an L rather than filling in its corner', () => {
    // The corner an L-shaped room does not occupy belongs to another
    // compartment. A hull would put two bodies on the same floor, and nothing
    // would say so until somebody measured it.
    const l: PrismMesh = {
      positions: new Float32Array([
        0, 0, 0, 4, 0, 0, 4, 0, 2, 2, 0, 2, 2, 0, 4, 0, 0, 4,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]),
    };
    const prism = roomPrism([l]);

    assert.ok(prism);
    // 4x2 plus 2x2 = 12; the hull over the same points would be 16.
    assert.equal(area(prism.ring), 12);
  });

  it('takes the largest ring when a mesh falls into islands', () => {
    const prism = roomPrism([box(0, 0, 1, 1, 0, 3), box(20, 20, 26, 25, 0, 3)]);

    assert.ok(prism);
    assert.equal(prism.rings, 2);
    assert.equal(area(prism.ring), 30);
  });

  it('answers null for a mesh with nothing in it', () => {
    assert.equal(roomPrism([]), null);
    assert.equal(
      roomPrism([{ positions: new Float32Array(), indices: new Uint32Array() }]),
      null,
    );
  });

  it('answers a zero height for a room modelled flat', () => {
    // Not null: the outline is real and the caller may still want to say which
    // rooms it had to skip, and why.
    const prism = roomPrism([box(0, 0, 4, 3, 5, 5)]);

    assert.ok(prism);
    assert.equal(prism.height, 0);
  });
});
