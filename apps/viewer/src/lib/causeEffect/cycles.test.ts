/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findCycles, wouldCloseCycle, type ChainGraph } from './cycles.js';

function graph(edges: Record<number, number[]>): ChainGraph {
  return new Map(Object.entries(edges).map(([from, to]) => [Number(from), to]));
}

describe('wouldCloseCycle', () => {
  it('allows an edge that extends a chain', () => {
    // 1 → 2 → 3, now adding 3 → 4: still a line, nothing closes.
    const g = graph({ 1: [2], 2: [3] });
    assert.equal(wouldCloseCycle(g, 3, 4), null);
  });

  it('refuses an edge that closes a ring', () => {
    const g = graph({ 1: [2], 2: [3] });
    const cycle = wouldCloseCycle(g, 3, 1);

    assert.ok(cycle);
    assert.deepEqual(cycle!.path, [3, 1, 2, 3]);
  });

  it('refuses a self-link as a ring of one', () => {
    // A step that triggers itself is the smallest possible ring and the
    // easiest to draw by accident.
    const cycle = wouldCloseCycle(graph({}), 7, 7);

    assert.ok(cycle);
    assert.deepEqual(cycle!.path, [7, 7]);
  });

  it('allows two paths that rejoin — a diamond is not a ring', () => {
    // 1 → 2 → 4 and 1 → 3 → 4. Adding 3 → 4 must stay allowed: branching and
    // rejoining is exactly what a cause-effect graph is for.
    const g = graph({ 1: [2, 3], 2: [4] });
    assert.equal(wouldCloseCycle(g, 3, 4), null);
  });

  it('finds a ring closed over a long chain', () => {
    const g = graph({ 1: [2], 2: [3], 3: [4], 4: [5] });
    const cycle = wouldCloseCycle(g, 5, 1);

    assert.ok(cycle);
    assert.deepEqual(cycle!.path, [5, 1, 2, 3, 4, 5]);
  });

  it('allows an edge back into a branch that does not reach the source', () => {
    const g = graph({ 1: [2], 3: [4] });
    assert.equal(wouldCloseCycle(g, 2, 3), null);
  });

  it('handles an empty graph', () => {
    assert.equal(wouldCloseCycle(graph({}), 1, 2), null);
  });
});

describe('findCycles', () => {
  it('finds nothing in a graph without rings', () => {
    assert.deepEqual(findCycles(graph({ 1: [2], 2: [3], 3: [] })), []);
  });

  it('finds a ring in imported data', () => {
    const cycles = findCycles(graph({ 1: [2], 2: [3], 3: [1] }));

    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0].path, [1, 2, 3, 1]);
  });

  it('reports one ring once, not once per entry point', () => {
    // The same ring is reachable from 1, 2 and 3; normalising by the lowest
    // member keeps it a single finding.
    const cycles = findCycles(graph({ 1: [2], 2: [3], 3: [1] }));
    assert.equal(cycles.length, 1);
  });

  it('finds two independent rings', () => {
    const cycles = findCycles(graph({ 1: [2], 2: [1], 5: [6], 6: [5] }));
    assert.equal(cycles.length, 2);
  });

  it('finds a self-link', () => {
    const cycles = findCycles(graph({ 4: [4] }));

    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0].path, [4, 4]);
  });

  it('is not confused by a diamond', () => {
    assert.deepEqual(findCycles(graph({ 1: [2, 3], 2: [4], 3: [4], 4: [] })), []);
  });
});
