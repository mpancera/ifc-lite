/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  roomFootprint, roomAreaFromQuantities, formatRoomArea, roomLabelLines, labelFits,
  type RoomMesh, type RoomLabel,
} from './roomLabels.js';

/**
 * A closed box from (x0, z0) to (x1, z1), `height` tall — the shape an
 * extruded `IfcSpace` actually arrives as. Written out as 12 triangles rather
 * than generated, so the fixture cannot share a bug with the code under test.
 */
function box(x0: number, z0: number, x1: number, z1: number, height = 3): RoomMesh {
  const y0 = 0;
  const y1 = height;
  // 8 corners: 0-3 bottom (y0) counter-clockwise, 4-7 top (y1).
  const positions = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1,
    x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, // floor
    4, 6, 5, 4, 7, 6, // ceiling
    0, 4, 5, 0, 5, 1, // four walls
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ]);
  return { positions, indices };
}

describe('roomFootprint', () => {
  it('reads a box as its floor area, not its whole surface', () => {
    // 4 × 5 m room, 3 m tall: the surface is 94 m², the footprint is 20.
    const fp = roomFootprint([box(0, 0, 4, 5)]);
    assert.ok(fp);
    assert.equal(Math.round(fp.area * 1000) / 1000, 20);
  });

  it('puts the anchor in the middle of a rectangular room', () => {
    const fp = roomFootprint([box(10, -6, 14, -1)]);
    assert.ok(fp);
    assert.equal(Math.round(fp.anchor.x * 1000) / 1000, 12);
    assert.equal(Math.round(fp.anchor.y * 1000) / 1000, -3.5);
  });

  it('reports the footprint extent, not the height', () => {
    const fp = roomFootprint([box(0, 0, 4, 5, 3)]);
    assert.ok(fp);
    assert.equal(fp.width, 4);
    assert.equal(fp.height, 5);
  });

  it('adds up a space that arrives as several submeshes', () => {
    // Two 2 × 5 halves of the same 4 × 5 room.
    const fp = roomFootprint([box(0, 0, 2, 5), box(2, 0, 4, 5)]);
    assert.ok(fp);
    assert.equal(Math.round(fp.area * 1000) / 1000, 20);
  });

  it('honours a local-frame origin', () => {
    const local = box(0, 0, 4, 5);
    const shifted: RoomMesh = { ...local, origin: [100, 0, -50] };
    const fp = roomFootprint([shifted]);
    assert.ok(fp);
    assert.equal(Math.round(fp.anchor.x * 1000) / 1000, 102);
    assert.equal(Math.round(fp.anchor.y * 1000) / 1000, -47.5);
  });

  it('keeps the anchor inside an L-shaped room, where the centroid is not', () => {
    // An L around the origin corner: the two arms are 6 × 2 and 2 × 6, so the
    // area-weighted centroid lands in the notch at roughly (2.2, 2.2) —
    // outside the room. The label must not go there.
    const fp = roomFootprint([box(0, 0, 6, 2), box(0, 2, 2, 6)]);
    assert.ok(fp);
    const { x, y } = fp.anchor;
    const inLowerArm = x >= 0 && x <= 6 && y >= 0 && y <= 2;
    const inUpperArm = x >= 0 && x <= 2 && y >= 2 && y <= 6;
    assert.ok(inLowerArm || inUpperArm, `anchor (${x}, ${y}) fell in the notch`);
  });

  it('has nothing to say about a space with no geometry', () => {
    assert.equal(roomFootprint([]), null);
    assert.equal(
      roomFootprint([{ positions: new Float32Array(), indices: new Uint32Array() }]),
      null,
    );
  });

  it('ignores degenerate triangles instead of dividing by their area', () => {
    // A room plus a zero-area sliver, which a mesher can legitimately emit.
    const sliver: RoomMesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const fp = roomFootprint([box(0, 0, 4, 5), sliver]);
    assert.ok(fp);
    assert.equal(Math.round(fp.area * 1000) / 1000, 20);
    assert.ok(Number.isFinite(fp.anchor.x) && Number.isFinite(fp.anchor.y));
  });
});

describe('roomAreaFromQuantities', () => {
  const qto = (name: string, value: number) => ({ quantities: [{ name, value }] });

  it('takes NetFloorArea in preference to GrossFloorArea', () => {
    const area = roomAreaFromQuantities(
      [qto('GrossFloorArea', 26), qto('NetFloorArea', 24.5)],
      1,
    );
    assert.deepEqual(area, { value: 24.5, source: 'quantity', quantityName: 'NetFloorArea' });
  });

  it('falls back to GrossFloorArea when that is all there is', () => {
    const area = roomAreaFromQuantities([qto('GrossFloorArea', 26)], 1);
    assert.equal(area?.quantityName, 'GrossFloorArea');
    assert.equal(area?.value, 26);
  });

  it('scales an area by the SQUARE of the length unit', () => {
    // A millimetre model states 24 500 000 mm² for 24.5 m².
    const area = roomAreaFromQuantities([qto('NetFloorArea', 24_500_000)], 0.001);
    assert.ok(area);
    assert.equal(Math.round(area.value * 100) / 100, 24.5);
  });

  it('declines an unfilled quantity rather than printing 0.0 m²', () => {
    assert.equal(roomAreaFromQuantities([qto('NetFloorArea', 0)], 1), null);
    assert.equal(roomAreaFromQuantities([qto('NetFloorArea', -3)], 1), null);
    assert.equal(roomAreaFromQuantities([qto('NetFloorArea', Number.NaN)], 1), null);
  });

  it('has no answer when the model carries no floor area at all', () => {
    assert.equal(roomAreaFromQuantities([qto('NetVolume', 73)], 1), null);
    assert.equal(roomAreaFromQuantities([], 1), null);
  });

  it('refuses a nonsense unit scale instead of returning zero areas', () => {
    assert.equal(roomAreaFromQuantities([qto('NetFloorArea', 24.5)], 0), null);
  });
});

describe('roomLabelLines', () => {
  const label = (over: Partial<RoomLabel>): RoomLabel => ({
    key: '1', expressId: 1, anchor: { x: 0, y: 0 }, name: '', longName: '',
    area: null, width: 4, height: 5, ...over,
  });

  it('reads number, description, area — in that order', () => {
    assert.deepEqual(
      roomLabelLines(label({
        name: '1.02', longName: 'Besprechung',
        area: { value: 24.5, source: 'quantity' },
      })),
      ['1.02', 'Besprechung', '24.5 m²'],
    );
  });

  it('leaves out what the model does not say', () => {
    assert.deepEqual(roomLabelLines(label({ name: '1.02' })), ['1.02']);
    assert.deepEqual(roomLabelLines(label({})), []);
  });
});

describe('formatRoomArea', () => {
  it('writes one decimal, the way a plan does', () => {
    assert.equal(formatRoomArea(24.5), '24.5 m²');
    assert.equal(formatRoomArea(24.449), '24.4 m²');
    assert.equal(formatRoomArea(7), '7.0 m²');
  });
});

describe('labelFits', () => {
  const lines = ['1.02', 'Besprechung', '24.5 m²'];
  // 11 characters at 11 px and 0.6 → ~73 px wide; 3 lines at 13 px → 39 px tall.
  const fits = (room: { width: number; height: number }, scale: number) =>
    labelFits(lines, room, scale, 11, 13);

  it('shows the label when the room is big enough on screen', () => {
    assert.equal(fits({ width: 4, height: 5 }, 50), true);
  });

  it('hides it once zooming out has made the room smaller than the text', () => {
    assert.equal(fits({ width: 4, height: 5 }, 5), false);
  });

  it('gives the same answer for a room and the same room turned 90°', () => {
    // Same rectangle, axes swapped: a rotated plan must not make labels blink.
    assert.equal(fits({ width: 8, height: 2 }, 20), fits({ width: 2, height: 8 }, 20));
  });

  it('has nothing to place when the model named nothing', () => {
    assert.equal(labelFits([], { width: 40, height: 50 }, 100, 11, 13), false);
  });
});
