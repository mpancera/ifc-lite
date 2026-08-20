/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '@ifc-lite/geometry';
import { fillMissingIfcTypes } from './meshIfcTypes.js';

function mesh(expressId: number, ifcType?: string): MeshData {
  return {
    expressId,
    ifcType,
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 0, 1]),
    indices: new Uint32Array([0, 0, 0]),
  } as unknown as MeshData;
}

function store(types: Record<number, string>) {
  let calls = 0;
  return {
    calls: () => calls,
    source: { entities: { getTypeName: (id: number) => { calls += 1; return types[id]; } } },
  };
}

describe('fillMissingIfcTypes', () => {
  it('gives a streamed-in-the-dark mesh its class', () => {
    // The detector bug: instanced occurrences reached the list before the data
    // model was parsed, so the plan's device marks skipped all eighty.
    const meshes = [mesh(42)];
    const repaired = fillMissingIfcTypes(meshes, store({ 42: 'IfcSensor' }).source);
    assert.equal(repaired, 1);
    assert.equal(meshes[0].ifcType, 'IfcSensor');
  });

  it('leaves a class that is already there', () => {
    // A repair, not a rewrite — the wasm pass names most meshes itself.
    const meshes = [mesh(42, 'IfcWall')];
    assert.equal(fillMissingIfcTypes(meshes, store({ 42: 'IfcSensor' }).source), 0);
    assert.equal(meshes[0].ifcType, 'IfcWall');
  });

  it('asks about each entity once, however many meshes it has', () => {
    // Large models carry hundreds of thousands of meshes for far fewer
    // elements; a lookup per mesh would be the expensive way to learn nothing.
    const s = store({ 7: 'IfcSensor' });
    fillMissingIfcTypes([mesh(7), mesh(7), mesh(7)], s.source);
    assert.equal(s.calls(), 1);
  });

  it('passes over an entity the store does not know', () => {
    const meshes = [mesh(999)];
    assert.equal(fillMissingIfcTypes(meshes, store({ 42: 'IfcSensor' }).source), 0);
    assert.equal(meshes[0].ifcType, undefined);
  });

  it('leaves a federated model’s meshes to their own store', () => {
    // Their ids are offset away from this store's; an answer here would be the
    // wrong element's class.
    const meshes = [{ ...mesh(42), modelIndex: 1 } as MeshData];
    assert.equal(fillMissingIfcTypes(meshes, store({ 42: 'IfcSensor' }).source), 0);
    assert.equal(meshes[0].ifcType, undefined);
  });

  it('does nothing, quietly, without a store', () => {
    assert.equal(fillMissingIfcTypes([mesh(1)], null), 0);
    assert.equal(fillMissingIfcTypes(undefined, store({}).source), 0);
  });
});
