/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { findEnclosedAreas } from './enclosed-areas.js';
import { OUTSIDE_ID, buildSpaceGraph, neighboursOf } from './space-graph.js';
import type { SegmentLike } from './spatial-hash.js';
import type { Candidate } from '../types.js';

const seg = (x1: number, y1: number, x2: number, y2: number, kind?: 'wall' | 'divider'): SegmentLike => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, ...(kind ? { kind } : {}) });

/**
 * Three rooms in a row, 4 × 3 m each: A | B | C. A door between A and B, a
 * door from C to the outside, a divider (no wall) between B and C.
 */
const walls: SegmentLike[] = [
  seg(0, 0, 12, 0),
  seg(0, 3, 12, 3),
  seg(0, 0, 0, 3),
  seg(12, 0, 12, 3),
  seg(4, 0, 4, 3),
  seg(8, 0, 8, 3, 'divider'),
];

const cand = (id: string, type: Candidate['type'], geometry: Candidate['geometry'], extra: Partial<Candidate> = {}): Candidate => ({
  id,
  type,
  geometry,
  confidence: 1,
  confidenceReasons: {},
  source: { handles: [id] },
  route: 'vector',
  ...extra,
});

const candidates: Candidate[] = [
  cand('roomA', 'space', [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], { text: 'A' }),
  cand('roomC', 'space', [{ x: 8, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 3 }, { x: 8, y: 3 }], { text: 'C' }),
  // Door hinge on the wall x = 4, swing radius 0.9.
  cand('doorAB', 'door', [{ x: 4, y: 1 }, { x: 4.9, y: 1 }, { x: 4, y: 1.9 }], { thickness: 0.9 }),
  // Exit in C's outer wall y = 0.
  cand('exitC', 'door', [{ x: 10, y: 0 }, { x: 10.9, y: 0 }, { x: 10, y: 0.9 }], { thickness: 0.9 }),
  cand('det1', 'symbol', [{ x: 2, y: 1.5 }], { symbol: { blockName: 'RM', rotationDeg: 0, classified: 'detector' } }),
];

describe('planar graph', () => {
  it('records both faces of every edge and the divider kind', () => {
    const t = findEnclosedAreas(walls);
    expect(t.graph.faces.filter((f) => f.kind === 'room')).toHaveLength(3);
    const divider = t.graph.edges.find((e) => e.kind === 'divider');
    expect(divider).toBeDefined();
    expect(t.graph.faces[divider!.faceLeft].kind).toBe('room');
    expect(t.graph.faces[divider!.faceRight].kind).toBe('room');
    const outerWall = t.graph.edges.find((e) => t.graph.vertices[e.a].y === 0 && t.graph.vertices[e.b].y === 0);
    expect([t.graph.faces[outerWall!.faceLeft].kind, t.graph.faces[outerWall!.faceRight].kind]).toContain('outer');
  });
});

describe('buildSpaceGraph', () => {
  const t = findEnclosedAreas(walls);
  const g = buildSpaceGraph(t.graph, candidates);
  // The middle room has no candidate, so its node is named after its face.
  const middle = g.nodes.find((n) => n.kind === 'space' && n.id.startsWith('face:'))!.id;

  it('names space nodes by the candidates that cover them and keeps the outside as one node', () => {
    const spaces = g.nodes.filter((n) => n.kind === 'space');
    expect(spaces).toHaveLength(3);
    expect(spaces.map((s) => s.id).sort()).toEqual([middle, 'roomA', 'roomC'].sort());
    expect(g.nodes.find((n) => n.id === 'roomA')?.label).toBe('A');
    expect(g.nodes.find((n) => n.id === OUTSIDE_ID)).toBeDefined();
  });

  it('reads adjacency off shared walls', () => {
    const adj = g.edges.filter((e) => e.kind === 'adjacent');
    expect(adj).toHaveLength(2);
    expect(adj.every((e) => Math.abs((e.lengthM ?? 0) - 3) < 1e-9)).toBe(true);
  });

  it('connects through doors and dividers, including to the outside', () => {
    const conn = g.edges.filter((e) => e.kind === 'connected');
    const ab = conn.find((e) => e.via === 'doorAB');
    expect(ab && [ab.a, ab.b].sort()).toEqual([middle, 'roomA'].sort());
    const exit = conn.find((e) => e.via === 'exitC');
    expect(exit && [exit.a, exit.b].sort()).toEqual([OUTSIDE_ID, 'roomC']);
    const open = conn.find((e) => !e.via);
    expect(open && [open.a, open.b].sort()).toEqual([middle, 'roomC'].sort());
    expect(g.stats.doorsPlaced).toBe(2);
  });

  it('hangs assets off the room that contains them', () => {
    expect(g.edges.find((e) => e.kind === 'contains')).toMatchObject({ a: 'roomA', b: 'det1' });
    expect(neighboursOf(g, 'roomA')).toEqual({ adjacent: [middle], connected: [{ to: middle, via: 'doorAB' }], assets: ['det1'] });
  });

  it('finds every room reachable from the outside here, and flags the one that is not without the exit', () => {
    expect(g.unreachable).toEqual([]);
    const noExit = buildSpaceGraph(t.graph, candidates.filter((c) => c.id !== 'exitC'));
    expect(noExit.unreachable.sort()).toEqual([middle, 'roomA', 'roomC'].sort());
  });

  it('leaves a door that sits in no wall unplaced', () => {
    const stray = buildSpaceGraph(t.graph, [cand('d', 'door', [{ x: 2, y: 1.5 }, { x: 2.9, y: 1.5 }], { thickness: 0.9 })]);
    expect(stray.stats.doors).toBe(1);
    expect(stray.stats.doorsPlaced).toBe(0);
  });
});
