/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundaryEdges, cutDoors, zoneOutline, type OutlineDoor, type OutlineRoom,
} from './zoneOutline.js';

/** A rectangular room, triangulated the way a mesh would be. */
function room(id: number, x0: number, y0: number, x1: number, y1: number): OutlineRoom {
  const triangles = new Float32Array([
    x0, y0, x1, y0, x1, y1,
    x0, y0, x1, y1, x0, y1,
  ]);
  return { id, triangles, edges: boundaryEdges(triangles) };
}

/** Total drawn length, which is what a boundary is measured by. */
function totalLength(segments: ReturnType<typeof zoneOutline>): number {
  return segments.reduce((sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0);
}

describe('boundaryEdges', () => {
  it('drops the diagonal the triangulation invented', () => {
    // A rectangle drawn as two triangles has a shared edge down the middle,
    // and it is not part of the room's boundary.
    const edges = boundaryEdges(new Float32Array([
      0, 0, 4, 0, 4, 6,
      0, 0, 4, 6, 0, 6,
    ]));
    assert.equal(edges.length, 4);
    const total = edges.reduce((s, e) => s + Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), 0);
    assert.equal(total, 20);
  });

  it('finds nothing in an empty mesh', () => {
    assert.deepEqual(boundaryEdges(new Float32Array()), []);
  });

  it('sees one room in the projection of a solid, not two faces and its sides', () => {
    // What actually arrives: a room is a SOLID, and its whole mesh projected
    // onto the plan is the top face, the bottom face directly under it, and
    // the four sides edge-on. Counted naively every edge appears an even
    // number of times and the boundary comes out empty — four zones found and
    // nothing drawn, which is what the plan showed.
    const top = [0, 0, 4, 0, 4, 6, 0, 0, 4, 6, 0, 6];
    const bottom = [...top];
    const sideEdgeOn = [
      0, 0, 4, 0, 4, 0,   // south wall, seen from the side: no area
      4, 0, 4, 6, 4, 6,   // east
      4, 6, 0, 6, 0, 6,   // north
      0, 6, 0, 0, 0, 0,   // west
    ];
    const edges = boundaryEdges(new Float32Array([...top, ...bottom, ...sideEdgeOn]));
    const total = edges.reduce((s, e) => s + Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), 0);
    assert.equal(edges.length, 4, 'the four walls of one room');
    assert.equal(total, 20);
  });
});

describe('zoneOutline', () => {
  it('draws a lone room all the way round', () => {
    const segments = zoneOutline([room(1, 0, 0, 4, 6)], []);
    assert.equal(segments.length, 4);
    assert.equal(totalLength(segments), 20);
  });

  it('leaves out the wall between two rooms of the same zone', () => {
    // The point of the whole thing: the group gets ONE boundary, not two
    // outlines with the party wall drawn down the middle. The two rooms are
    // 20 cm apart — a wall, so their footprints do not touch and no amount of
    // edge-matching would pair them up.
    const segments = zoneOutline([room(1, 0, 0, 4, 6), room(2, 4.2, 0, 8, 6)], []);
    const onPartyWall = segments.filter(
      (s) => Math.abs(s.a.x - 4) < 0.01 && Math.abs(s.b.x - 4) < 0.01,
    );
    assert.equal(onPartyWall.length, 0, 'the near face of the party wall is internal');
    const otherSide = segments.filter(
      (s) => Math.abs(s.a.x - 4.2) < 0.01 && Math.abs(s.b.x - 4.2) < 0.01,
    );
    assert.equal(otherSide.length, 0, 'and so is the far one');
  });

  it('keeps an edge facing a room that is NOT in the zone', () => {
    // Only the rooms handed in count as "same zone" — a neighbour in another
    // zone is on the other side of the boundary, which is where the line goes.
    const segments = zoneOutline([room(1, 0, 0, 4, 6)], []);
    assert.equal(totalLength(segments), 20, 'nothing dropped');
  });

  it('does not drop an edge because a room is far away', () => {
    const segments = zoneOutline([room(1, 0, 0, 4, 6), room(2, 40, 0, 44, 6)], []);
    assert.equal(totalLength(segments), 40, 'both drawn in full');
  });

  it('cuts the doorway out of the line', () => {
    // A boundary a person can walk through has to say so — that is the whole
    // reason the guideline asks for the interruption.
    const door: OutlineDoor = {
      centre: { x: 2, y: 0 }, along: { x: 1, y: 0 }, width: 1,
    };
    const segments = zoneOutline([room(1, 0, 0, 4, 6)], [door]);
    assert.ok(totalLength(segments) < 20, 'shorter than the closed ring');
    assert.ok(totalLength(segments) > 18, 'and only by the door');
    const acrossTheDoor = segments.filter(
      (s) => Math.abs(s.a.y) < 0.01 && Math.abs(s.b.y) < 0.01
        && s.a.x < 2 && s.b.x > 2,
    );
    assert.equal(acrossTheDoor.length, 0, 'nothing runs through the opening');
  });
});

describe('inset', () => {
  it('moves the line into the room, not into the wall', () => {
    // On a fire plan the heavy line reads as lying inside the compartment it
    // encloses; centred on the room's edge, half of it is in the wall.
    const segments = zoneOutline([room(1, 0, 0, 4, 6)], [], { inset: 0.1 });
    const south = segments.find((s) => Math.abs(s.a.y - s.b.y) < 1e-9 && s.a.y < 3);
    assert.ok(south, 'the south wall');
    assert.ok(Math.abs(south.a.y - 0.1) < 1e-9, `moved inward, got y=${south.a.y}`);
  });

  it('leaves the line where it is when no inset is asked for', () => {
    const segments = zoneOutline([room(1, 0, 0, 4, 6)], []);
    assert.ok(segments.some((s) => Math.abs(s.a.y) < 1e-9));
  });
});

describe('cutDoors', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it('leaves a wall with no door alone', () => {
    assert.deepEqual(cutDoors(a, b, []), [{ a, b }]);
  });

  it('takes the door out of the middle and leaves both ends', () => {
    const parts = cutDoors(a, b, [{ centre: { x: 5, y: 0 }, along: { x: 1, y: 0 }, width: 1 }]);
    assert.equal(parts.length, 2);
    assert.ok(parts[0].b.x < 5 && parts[1].a.x > 5);
  });

  it('ignores a door in a different wall', () => {
    // Two metres away is another room's door; punching a hole here would draw
    // an opening where the wall is solid.
    const parts = cutDoors(a, b, [{ centre: { x: 5, y: 2 }, along: { x: 1, y: 0 }, width: 1 }]);
    assert.deepEqual(parts, [{ a, b }]);
  });

  it('merges two doors that overlap instead of leaving a sliver between them', () => {
    const parts = cutDoors(a, b, [
      { centre: { x: 5, y: 0 }, along: { x: 1, y: 0 }, width: 1 },
      { centre: { x: 5.4, y: 0 }, along: { x: 1, y: 0 }, width: 1 },
    ]);
    assert.equal(parts.length, 2, 'one hole, not two with a crumb between');
  });

  it('covers more of the line for a door meeting it at an angle', () => {
    const straight = cutDoors(a, b, [{ centre: { x: 5, y: 0 }, along: { x: 1, y: 0 }, width: 1 }]);
    const angled = cutDoors(a, b, [{
      centre: { x: 5, y: 0 },
      along: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      width: 1,
    }]);
    const gap = (parts: typeof straight) => parts[1].a.x - parts[0].b.x;
    assert.ok(gap(angled) > gap(straight), 'the opening reads wider along this wall');
  });

  it('ignores a door standing in the wall around the corner', () => {
    // Its axis crosses this line instead of running along it. Dividing by that
    // near-zero cosine used to blow a metres-wide hole in the wrong wall —
    // openings appearing where the plan showed solid wall.
    const parts = cutDoors(a, b, [{
      centre: { x: 0.3, y: 0.2 }, along: { x: 0, y: 1 }, width: 1,
    }]);
    assert.deepEqual(parts, [{ a, b }]);
  });

  it('drops the line entirely when the door covers all of it', () => {
    const parts = cutDoors(a, { x: 0.8, y: 0 }, [
      { centre: { x: 0.4, y: 0 }, along: { x: 1, y: 0 }, width: 2 },
    ]);
    assert.deepEqual(parts, []);
  });
});
