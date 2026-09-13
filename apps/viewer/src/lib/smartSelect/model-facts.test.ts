/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IfcDataStore } from '@ifc-lite/parser';
import { smartSelectSources } from './model-facts.js';
import { collectSmartSelection } from './criteria.js';

/**
 * The smallest store these two functions actually touch: a columnar entity
 * table whose ACCESSORS take an express id while its arrays are indexed by
 * row. That mismatch is the point of the first test.
 */
function store(rows: { expressId: number; type: string; geometry: boolean }[]): IfcDataStore {
  const byId = new Map(rows.map((r) => [r.expressId, r]));
  return {
    entities: {
      count: rows.length,
      expressId: rows.map((r) => r.expressId),
      hasGeometry: (expressId: number) => byId.get(expressId)?.geometry ?? false,
      getTypeName: (expressId: number) => byId.get(expressId)?.type ?? '',
    },
    spatialHierarchy: null,
    relationships: null,
  } as unknown as IfcDataStore;
}

const MODEL = store([
  { expressId: 262, type: 'IfcWall', geometry: true },
  { expressId: 291, type: 'IfcWall', geometry: true },
  { expressId: 315, type: 'IfcWall', geometry: true },
  { expressId: 400, type: 'IfcOpeningElement', geometry: false },
]);

describe('smartSelectSources', () => {
  it('asks hasGeometry by EXPRESS ID, not by row index', () => {
    // The arrays are indexed, the accessors are not, and both are numbers —
    // passing `i` typechecks and answers false for nearly everything, which
    // the wand reports as "nothing else is the same".
    assert.deepEqual([...smartSelectSources(MODEL).candidates], [262, 291, 315]);
  });

  it('keeps geometry-less entities out of an answer the user cannot see', () => {
    const { ids } = collectSmartSelection(262, ['class'], smartSelectSources(MODEL));
    assert.ok(!ids.includes(400));
  });

  it('offers a fresh iterator each time, so a second click still scans', () => {
    const sources = smartSelectSources(MODEL);
    assert.equal([...sources.candidates].length, 3);
    assert.equal([...sources.candidates].length, 3, 'an exhausted generator would answer 0');
  });

  it('narrows to the scope it is given — this is what "nur Sichtbares" is', () => {
    const visible = new Set([262, 291]);
    const { ids } = collectSmartSelection(262, ['class'], smartSelectSources(MODEL, visible));
    assert.deepEqual(ids.sort((a, b) => a - b), [262, 291], '315 is off screen');
  });

  it('still answers the seed when the scope holds nothing else', () => {
    const { ids } = collectSmartSelection(262, ['class'], smartSelectSources(MODEL, new Set([262])));
    assert.deepEqual(ids, [262]);
  });

  it('reads a missing hierarchy as "has none" rather than throwing', () => {
    const { fact } = smartSelectSources(MODEL);
    assert.equal(fact(262, 'storey'), null);
    assert.equal(fact(262, 'room'), null);
    assert.equal(fact(262, 'type'), null);
    assert.equal(fact(262, 'class'), 'IfcWall');
  });
});
