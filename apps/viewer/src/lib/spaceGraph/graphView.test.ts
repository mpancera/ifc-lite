/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spaceGraphView } from './graphView.js';
import type { SpaceGraph, SpaceNode, SpaceEdge } from './spaceGraph.js';

const space = (id: number, name: string, x: number, y: number): SpaceNode => ({
  id, name, usage: null, area: 20,
  labelPoint: { x, y },
  triangles: new Float32Array(),
  storeyId: 1,
});

function graphOf(spaces: SpaceNode[], edges: SpaceEdge[]): SpaceGraph {
  const adjacency = new Map<number, SpaceEdge[]>();
  for (const edge of edges) {
    for (const id of [edge.from, edge.to]) {
      if (id === null) continue;
      const list = adjacency.get(id);
      if (list) list.push(edge); else adjacency.set(id, [edge]);
    }
  }
  return {
    spaces: new Map(spaces.map((s) => [s.id, s])),
    doors: new Map(),
    edges,
    adjacency,
  };
}

const edge = (doorId: number, from: number | null, to: number | null, tx = 0, ty = 0): SpaceEdge => ({
  doorId, from, to,
  threshold: [{ x: tx - 1, y: ty }, { x: tx + 1, y: ty }],
});

describe('spaceGraphView', () => {
  it('draws a node per room and a line per door', () => {
    const view = spaceGraphView(graphOf(
      [space(1, 'Korridor', 0, 0), space(2, 'Büro', 10, 0)],
      [edge(10, 1, 2, 5, 0)],
    ));
    assert.equal(view.nodes.length, 2);
    assert.equal(view.edges.length, 1);
    assert.deepEqual(view.edges[0].from, { x: 0, y: 0 }, 'from room centre');
    assert.deepEqual(view.edges[0].to, { x: 10, y: 0 }, 'to room centre');
    assert.equal(view.edges[0].exterior, false);
  });

  it('draws an exterior door as a stub into the open', () => {
    // Leaving it out would make the way out look like a wall, which is the one
    // thing somebody checking an escape route must be able to see.
    const view = spaceGraphView(graphOf([space(1, 'Korridor', 0, 0)], [edge(10, 1, null, 5, 0)]));
    assert.equal(view.edges.length, 1);
    assert.equal(view.edges[0].exterior, true);
    assert.deepEqual(view.edges[0].from, { x: 0, y: 0 });
    assert.deepEqual(view.edges[0].to, { x: 6, y: 0 }, 'ends at the threshold outside');
    assert.deepEqual(view.edges[0].spaceIds, [1]);
  });

  it('carries the step count, and marks a room the search never reached', () => {
    const view = spaceGraphView(
      graphOf([space(1, 'Korridor', 0, 0), space(9, 'Keller', 50, 50)], [edge(10, 1, null)]),
      { steps: new Map([[1, 1]]) },
    );
    const byId = new Map(view.nodes.map((n) => [n.spaceId, n]));
    assert.equal(byId.get(1)?.steps, 1);
    assert.equal(byId.get(1)?.kind, 'room');
    // No count is the interesting answer, not a missing one: nothing in the
    // plan leads out of that room.
    assert.equal(byId.get(9)?.steps, null);
    assert.equal(byId.get(9)?.kind, 'stranded');
  });

  it('marks the rooms that ARE safety', () => {
    const view = spaceGraphView(
      graphOf([space(1, 'Treppenhaus', 0, 0)], []),
      { steps: new Map([[1, 0]]), safe: new Set([1]) },
    );
    assert.equal(view.nodes[0].kind, 'safe');
  });

  it('counts the doors on each room, so a dead end is visible as one', () => {
    const view = spaceGraphView(graphOf(
      [space(1, 'Korridor', 0, 0), space(2, 'Büro', 10, 0), space(3, 'Lager', 20, 0)],
      [edge(10, 1, null), edge(11, 1, 2), edge(12, 2, 3)],
    ));
    const byId = new Map(view.nodes.map((n) => [n.spaceId, n]));
    assert.equal(byId.get(1)?.degree, 2);
    assert.equal(byId.get(3)?.degree, 1, 'the dead end');
  });

  it('prefers the label it was given — the room NUMBER, where there is one', () => {
    const view = spaceGraphView(
      graphOf([space(1, 'Korridor', 0, 0)], []),
      { labels: new Map([[1, '1.01']]) },
    );
    assert.equal(view.nodes[0].label, '1.01');
  });

  it('leaves out a door whose rooms are not on this storey', () => {
    const view = spaceGraphView(graphOf([space(1, 'Korridor', 0, 0)], [edge(10, null, null)]));
    assert.deepEqual(view.edges, []);
  });
});
