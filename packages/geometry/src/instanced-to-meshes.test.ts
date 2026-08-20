/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { expandInstancedShard } from './instanced-to-meshes.js';
import type { DecodedInstancedShard } from './packed-instanced-decoder.js';

/** Row-major mat4: rotation `r` (3×3, row-major) with translation `t`. */
function mat4(r: number[], t: [number, number, number]): Float32Array {
  return new Float32Array([
    r[0], r[1], r[2], t[0],
    r[3], r[4], r[5], t[1],
    r[6], r[7], r[8], t[2],
    0, 0, 0, 1,
  ]);
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** A quarter turn about Z: x → y, y → −x. */
const TURN_Z = [0, -1, 0, 1, 0, 0, 0, 0, 1];

function shard(overrides: Partial<DecodedInstancedShard> = {}): DecodedInstancedShard {
  return {
    templates: [{
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      origin: [0, 0, 0],
    }],
    instances: [{
      templateIndex: 0,
      entityId: 42,
      color: [1, 0, 0, 1],
      transform: mat4(IDENTITY, [10, 20, 30]),
    }],
    ...overrides,
  };
}

describe('expandInstancedShard', () => {
  it('gives every occurrence a mesh of its own', () => {
    // The bug this exists for: eighty detectors rendered in 3D and appeared in
    // no plan, no class tree and no element count, because they lived only as
    // transforms inside a shard.
    const decoded = shard({
      instances: [
        { templateIndex: 0, entityId: 1, color: [1, 1, 1, 1], transform: mat4(IDENTITY, [0, 0, 0]) },
        { templateIndex: 0, entityId: 2, color: [1, 1, 1, 1], transform: mat4(IDENTITY, [5, 0, 0]) },
      ],
    });
    const meshes = expandInstancedShard(decoded);
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m) => m.expressId)).toEqual([1, 2]);
  });

  it('flags them so the uploader leaves them alone', () => {
    // The GPU already has this geometry as an instance; uploading the expansion
    // too would draw everything twice.
    expect(expandInstancedShard(shard())[0].instancedOccurrence).toBe(true);
  });

  it('presents them as ordinary occurrences to every other reader', () => {
    // geometryClass 0 — not a type template, not an orphan. The 2D cut and the
    // class tree must not need to know instancing exists.
    expect(expandInstancedShard(shard())[0].geometryClass).toBe(0);
  });

  it('keeps the translation in the origin and the shape relative to it', () => {
    // Building-scale f32: a detector three kilometres from the project origin
    // must not dissolve into noise, which is why the wasm pipeline splits the
    // two in the first place.
    const mesh = expandInstancedShard(shard(), { yUp: false })[0];
    expect(Array.from(mesh.origin ?? [])).toEqual([10, 20, 30]);
    expect(Array.from(mesh.positions.slice(0, 3))).toEqual([0, 0, 0]);
  });

  it('rotates the shape by the instance transform', () => {
    const decoded = shard({
      instances: [{
        templateIndex: 0, entityId: 7, color: [1, 1, 1, 1],
        transform: mat4(TURN_Z, [0, 0, 0]),
      }],
    });
    const mesh = expandInstancedShard(decoded, { yUp: false })[0];
    // The template's (1, 0, 0) corner turns onto (0, 1, 0).
    expect(Array.from(mesh.positions.slice(3, 6)).map((v) => Math.round(v))).toEqual([0, 1, 0]);
  });

  it('rotates the normals too, and keeps them unit length', () => {
    const decoded = shard({
      instances: [{
        templateIndex: 0, entityId: 7, color: [1, 1, 1, 1],
        transform: mat4(TURN_Z, [0, 0, 0]),
      }],
      templates: [{
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
        indices: new Uint32Array([0, 1, 2]),
        origin: [0, 0, 0],
      }],
    });
    const n = expandInstancedShard(decoded, { yUp: false })[0].normals;
    expect(Array.from(n.slice(0, 3)).map((v) => Math.round(v))).toEqual([0, 1, 0]);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
  });

  it('folds the template origin in before the transform', () => {
    const decoded = shard({
      templates: [{
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        origin: [100, 0, 0],
      }],
    });
    const mesh = expandInstancedShard(decoded, { yUp: false })[0];
    expect(Array.from(mesh.positions.slice(0, 3))).toEqual([100, 0, 0]);
  });

  it('tells occurrences of one entity apart', () => {
    // Instanced occurrences share an express id; the device marks key on this
    // or a hundred detectors collapse into one mark somewhere between them.
    const decoded = shard({
      instances: [
        { templateIndex: 0, entityId: 9, color: [1, 1, 1, 1], transform: mat4(IDENTITY, [0, 0, 0]) },
        { templateIndex: 0, entityId: 9, color: [1, 1, 1, 1], transform: mat4(IDENTITY, [5, 0, 0]) },
      ],
    });
    const keys = expandInstancedShard(decoded).map((m) => m.occurrenceKey);
    expect(new Set(keys).size).toBe(2);
  });

  it('carries the IFC class in, because the shard has none', () => {
    const meshes = expandInstancedShard(shard(), { ifcTypeOf: () => 'IfcSensor' });
    expect(meshes[0].ifcType).toBe('IfcSensor');
  });

  it('applies the federated id offset', () => {
    const meshes = expandInstancedShard(shard(), { idOffset: 1000 });
    expect(meshes[0].expressId).toBe(1042);
  });

  it('converts IFC Z-up to the renderer frame the rest of the list is in', () => {
    // Found the hard way: expanded without this the detectors landed on a
    // different floor and a quarter turn out, because the shard's bytes are in
    // IFC's frame while every flat mesh beside them is already Y-up.
    const decoded = shard({
      instances: [{
        templateIndex: 0, entityId: 1, color: [1, 1, 1, 1],
        transform: mat4(IDENTITY, [1, 2, 3]),
      }],
      templates: [{
        positions: new Float32Array([0, 0, 0]),
        normals: new Float32Array([0, 0, 1]),
        indices: new Uint32Array([0, 0, 0]),
        origin: [0, 0, 0],
      }],
    });
    // IFC (1, 2, 3) → renderer (1, 3, −2): height moves to Y.
    expect(Array.from(expandInstancedShard(decoded)[0].origin ?? [])).toEqual([1, 3, -2]);
  });

  it('leaves the frame alone when the caller asks for IFC', () => {
    const mesh = expandInstancedShard(shard(), { yUp: false })[0];
    expect(Array.from(mesh.origin ?? [])).toEqual([10, 20, 30]);
  });

  it('skips an instance whose template is missing or degenerate', () => {
    const decoded = shard({
      instances: [{
        templateIndex: 5, entityId: 1, color: [1, 1, 1, 1], transform: mat4(IDENTITY, [0, 0, 0]),
      }],
    });
    expect(expandInstancedShard(decoded)).toEqual([]);
  });

  it('returns the templates themselves to nobody', () => {
    // The wasm pass already emits them as geometryClass 2 records; a second
    // copy would be drawn twice in the Types view.
    const meshes = expandInstancedShard(shard());
    expect(meshes.every((m) => m.geometryClass !== 2)).toBe(true);
    expect(meshes).toHaveLength(1);
  });
});
