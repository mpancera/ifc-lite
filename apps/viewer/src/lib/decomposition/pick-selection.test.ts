/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickSelectionFor, type DecompositionLookup } from './pick-selection.js';

/**
 * A curtain wall (#10) of two panes and a mullion, a stair (#50) whose flight
 * (#51) carries a tread (#52), a loose wall (#40), and the spatial skeleton:
 * storey #90 decomposes the building #91 — through the SAME relation.
 */
const PARENT: Record<number, number> = { 11: 10, 12: 10, 13: 10, 51: 50, 52: 51, 90: 91 };
const TYPE: Record<number, string> = {
  10: 'IfcCurtainWall', 11: 'IfcPlate', 12: 'IfcPlate', 13: 'IfcMember',
  40: 'IfcWall', 50: 'IfcStair', 51: 'IfcStairFlight', 52: 'IfcBuildingElementPart',
  90: 'IfcBuildingStorey', 91: 'IfcBuilding',
};
const CHILDREN: Record<number, number[]> = { 10: [11, 12, 13], 50: [51, 52] };

const OFFSET = 1_000_000;
const lookup: DecompositionLookup = {
  aggregateParentOf: (id) => PARENT[id] ?? null,
  typeOf: (id) => TYPE[id] ?? null,
  descendantsOf: (id) => CHILDREN[id] ?? [],
  toGlobal: (id) => id + OFFSET,
};
const ref = (expressId: number) => ({ modelId: 'm1', expressId });

describe('pickSelectionFor', () => {
  it('answers the curtain wall when a pane was clicked', () => {
    const picked = pickSelectionFor(ref(11), lookup);
    assert.deepEqual(picked.ref, ref(10));
  });

  it('highlights the parts, because a whole that only aggregates has no mesh', () => {
    const picked = pickSelectionFor(ref(11), lookup);
    assert.deepEqual(picked.globalIds, [11, 12, 13, 10].map((id) => id + OFFSET));
  });

  it('puts the whole last, which is what makes it the primary highlight', () => {
    const picked = pickSelectionFor(ref(12), lookup);
    assert.equal(picked.globalIds[picked.globalIds.length - 1], 10 + OFFSET);
  });

  it('climbs past an intermediate part — a tread means the whole stair', () => {
    const picked = pickSelectionFor(ref(52), lookup);
    assert.deepEqual(picked.ref, ref(50));
    assert.deepEqual(picked.globalIds, [51, 52, 50].map((id) => id + OFFSET));
  });

  it('leaves an ordinary element alone, and does not ask for its parts', () => {
    let asked = 0;
    const counting = { ...lookup, descendantsOf: (id: number) => { asked++; return lookup.descendantsOf(id); } };
    const picked = pickSelectionFor(ref(40), counting);
    assert.deepEqual(picked.ref, ref(40));
    assert.deepEqual(picked.globalIds, [40 + OFFSET]);
    assert.equal(asked, 0, 'the common click pays nothing for the walk');
  });

  it('stops at the spatial structure — clicking a storey is not clicking a building', () => {
    const picked = pickSelectionFor(ref(90), lookup);
    assert.deepEqual(picked.ref, ref(90));
  });

  it('gives back exactly what was clicked when Alt is held', () => {
    const picked = pickSelectionFor(ref(11), lookup, { exact: true });
    assert.deepEqual(picked.ref, ref(11));
    assert.deepEqual(picked.globalIds, [11 + OFFSET]);
  });

  it('is idempotent: clicking the whole itself answers the whole', () => {
    const picked = pickSelectionFor(ref(10), lookup);
    assert.deepEqual(picked.ref, ref(10));
    assert.deepEqual(picked.globalIds, [10 + OFFSET], 'no parts, because nothing was lifted');
  });
});
