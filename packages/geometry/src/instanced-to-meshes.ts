/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Instanced occurrences, expanded into ordinary meshes.
 *
 * GPU instancing sends one template plus a transform per occurrence, which is
 * the right thing for the renderer and the wrong thing for everybody else: the
 * mesh list is what the 2D section cut, the room labels, the device marks, the
 * class tree and the element statistics all read, and an occurrence that exists
 * only as a transform inside a shard is invisible to every one of them.
 *
 * That was not a hypothesis. A model with eighty identical fire detectors
 * showed them in 3D and nowhere else — no plan symbols, no `IfcSensor` in the
 * class tree, and an "elements with geometry" count that never moved.
 *
 * So the shard is expanded here as well as uploaded there. The expansion is
 * flagged {@link MeshData.instancedOccurrence} so the uploader knows the GPU
 * already has this geometry and skips it; every reader that treats the list as
 * DATA sees a perfectly ordinary placed occurrence, which is what it is.
 *
 * # Precision
 * The instance's translation becomes the mesh's `origin` and the positions stay
 * relative to it — the same split the wasm pipeline uses for building-scale
 * models, and the reason a detector three kilometres from the project origin
 * does not dissolve into f32 noise.
 */

import type { DecodedInstance, DecodedInstancedShard } from './packed-instanced-decoder.js';
import type { MeshData } from './types.js';

export interface ExpandInstancedOptions {
  /**
   * Convert IFC Z-up to renderer Y-up: `(x, y, z) → (x, z, −y)`.
   *
   * The shard's geometry is in IFC's frame — the renderer's instanced path
   * applies the flip itself, so the bytes never carry it. The FLAT meshes in
   * the same list are already Y-up, and a mesh list holding both frames is a
   * mesh list nobody can read: the plan cut would put these elements on a
   * different floor and rotated a quarter turn. Default `true`, because the
   * list is the renderer's frame.
   */
  readonly yUp?: boolean;
  /**
   * The IFC class of an occurrence, by express id.
   *
   * The shard carries no type name — it is geometry, keyed by entity. Without
   * it every reader that dispatches on class (the device marks, the class
   * tree) would see the occurrence and not know what it is.
   */
  readonly ifcTypeOf?: (expressId: number) => string | undefined;
  /** Federated id offset, added to each entity id. Zero for a single model. */
  readonly idOffset?: number;
  /** Model index carried onto each mesh, for federation-aware readers. */
  readonly modelIndex?: number;
}

/** `transform · (origin + v)`, split into a translation and the rotated rest. */
function transformVertices(
  positions: Float32Array,
  origin: readonly [number, number, number],
  m: Float32Array,
  yUp: boolean,
): Float32Array {
  const out = new Float32Array(positions.length);
  const [ox, oy, oz] = origin;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i] + ox;
    const y = positions[i + 1] + oy;
    const z = positions[i + 2] + oz;
    // Row-major, translation in the fourth column — held back and handed to
    // the mesh's own origin instead.
    const tx = m[0] * x + m[1] * y + m[2] * z;
    const ty = m[4] * x + m[5] * y + m[6] * z;
    const tz = m[8] * x + m[9] * y + m[10] * z;
    out[i] = tx;
    out[i + 1] = yUp ? tz : ty;
    out[i + 2] = yUp ? -ty : tz;
  }
  return out;
}

/** Normals take the rotation and neither the translation nor the scale's sign. */
function transformNormals(normals: Float32Array, m: Float32Array, yUp: boolean): Float32Array {
  const out = new Float32Array(normals.length);
  for (let i = 0; i + 2 < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];
    const rx = m[0] * x + m[1] * y + m[2] * z;
    const ry = m[4] * x + m[5] * y + m[6] * z;
    const rz = m[8] * x + m[9] * y + m[10] * z;
    const nx = rx;
    const ny = yUp ? rz : ry;
    const nz = yUp ? -ry : rz;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      out[i] = nx / len;
      out[i + 1] = ny / len;
      out[i + 2] = nz / len;
    } else {
      out[i + 1] = 1;
    }
  }
  return out;
}

/** One occurrence as a mesh, or `null` when its template is missing. */
function expandInstance(
  shard: DecodedInstancedShard,
  instance: DecodedInstance,
  index: number,
  options: ExpandInstancedOptions,
): MeshData | null {
  const template = shard.templates[instance.templateIndex];
  if (!template || template.indices.length < 3) return null;

  const m = instance.transform;
  const yUp = options.yUp ?? true;
  const expressId = instance.entityId + (options.idOffset ?? 0);
  return {
    expressId,
    ifcType: options.ifcTypeOf?.(instance.entityId),
    positions: transformVertices(template.positions, template.origin, m, yUp),
    normals: transformNormals(template.normals, m, yUp),
    // Local to the template's vertex range already — nothing to renumber.
    indices: template.indices.slice(),
    color: instance.color,
    origin: yUp ? [m[3], m[11], -m[7]] : [m[3], m[7], m[11]],
    modelIndex: options.modelIndex,
    // An occurrence, like any other — the flag below is about the UPLOAD, not
    // about what this is.
    geometryClass: 0,
    // Several occurrences share one express id; readers that must tell them
    // apart (the device marks do) key on this.
    occurrenceKey: `${expressId}:i${index}`,
    instancedOccurrence: true,
  } as MeshData;
}

/**
 * Every occurrence in a decoded shard, as meshes for the mesh list.
 *
 * Templates themselves are NOT returned: the wasm pass already emits them as
 * `geometryClass 2` records, and a second copy would be drawn twice in the
 * Types view.
 */
export function expandInstancedShard(
  shard: DecodedInstancedShard,
  options: ExpandInstancedOptions = {},
): MeshData[] {
  const out: MeshData[] = [];
  shard.instances.forEach((instance, index) => {
    const mesh = expandInstance(shard, instance, index, options);
    if (mesh) out.push(mesh);
  });
  return out;
}
