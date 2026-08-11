/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DXF_PLACEMENT } from '@ifc-lite/drawing-2d';
import type {
  DxfPlacement, DxfUnderlayLayer, DxfUnderlayPath, DxfUnderlayText, Point2D,
} from '@ifc-lite/drawing-2d';
import type { DxfUnderlayState } from '@/store/slices/drawing2DSlice';
import { dxfSegments, summariseLayers, suggestWallLayers } from './dxfSegments.js';

function path(points: [number, number][], closed = false): DxfUnderlayPath {
  return { points: points.map(([x, y]): Point2D => ({ x, y })), closed };
}

function layer(
  name: string,
  paths: DxfUnderlayPath[],
  extra: { visible?: boolean; texts?: DxfUnderlayText[] } = {},
): DxfUnderlayLayer {
  return {
    name,
    color: '#000',
    visible: extra.visible ?? true,
    paths,
    fills: [],
    texts: extra.texts ?? [],
  };
}

function state(
  layers: DxfUnderlayLayer[],
  placement: DxfPlacement = DEFAULT_DXF_PLACEMENT,
): DxfUnderlayState {
  return {
    id: 'u1',
    name: 'plan.dxf',
    underlay: {
      name: 'plan.dxf',
      layers,
      bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
      unitScale: 1,
      skipped: {},
      warnings: [],
    },
    visible: true,
    opacity: 1,
    layerVisibility: {},
    placement,
  } as DxfUnderlayState;
}

/** A 4×3 rectangle drawn as one polyline, the way a wall layer usually is. */
const RECT: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];

describe('dxfSegments', () => {
  it('reads only the layers that were chosen', () => {
    // The whole feature turns on this: a plan carries furniture and dimensions,
    // and a region bounded by a dimension line is not a room.
    const s = state([
      layer('WALL', [path(RECT, true)]),
      layer('FURNITURE', [path([[1, 1], [2, 1], [2, 2]], true)]),
    ]);

    assert.equal(dxfSegments(s, { layers: ['WALL'] }).length, 4);
  });

  it('closes a closed polyline', () => {
    // The last vertex does not repeat the first, so the closing edge has to be
    // added. Without it every room drawn as one polyline stays open and the
    // detector finds nothing at all.
    const segments = dxfSegments(state([layer('WALL', [path(RECT, true)])]), { layers: ['WALL'] });

    assert.equal(segments.length, 4);
    assert.deepEqual(segments[3], { a: [0, 3], b: [0, 0] });
  });

  it('leaves an open polyline open', () => {
    // Inventing the closing edge would fabricate a wall nobody drew, and the
    // room it encloses would be a room nobody has.
    const segments = dxfSegments(state([layer('WALL', [path(RECT, false)])]), { layers: ['WALL'] });

    assert.equal(segments.length, 3);
  });

  it('selects nothing when nothing is selected', () => {
    // Not "everything by default": that is the setting that yields nonsense on
    // the first try and teaches people the feature does not work.
    assert.deepEqual(dxfSegments(state([layer('WALL', [path(RECT, true)])]), { layers: [] }), []);
  });

  it('ignores a layer name that is not in the drawing', () => {
    assert.deepEqual(dxfSegments(state([layer('WALL', [path(RECT, true)])]), {
      layers: ['A-WALL'],
    }), []);
  });

  it('places the segments where the plan is seen', () => {
    // Segments in unplaced drawing space would describe rooms sitting somewhere
    // the person never put the plan.
    const s = state([layer('WALL', [path(RECT, true)])],
      { ...DEFAULT_DXF_PLACEMENT, offsetX: 100, offsetY: 50 });

    assert.deepEqual(dxfSegments(s, { layers: ['WALL'] })[0], { a: [100, 50], b: [104, 50] });
  });

  it('carries the placement scale into the segments', () => {
    const s = state([layer('WALL', [path(RECT, true)])], { ...DEFAULT_DXF_PLACEMENT, scale: 2 });

    assert.deepEqual(dxfSegments(s, { layers: ['WALL'] })[0], { a: [0, 0], b: [8, 0] });
  });

  it('keeps segment lengths under rotation', () => {
    // Rotation is the placement's own business; this only pins that nothing
    // here distorts what it produced.
    const s = state([layer('WALL', [path(RECT, true)])],
      { ...DEFAULT_DXF_PLACEMENT, rotationDeg: 37 });

    const [first] = dxfSegments(s, { layers: ['WALL'] });
    const length = Math.hypot(first.b[0] - first.a[0], first.b[1] - first.a[1]);

    assert.ok(Math.abs(length - 4) < 1e-9, `expected 4 m, got ${length}`);
  });

  it('drops segments below the minimum length', () => {
    // Hatching and text outlines arrive as thousands of tiny segments that cost
    // time and close nothing.
    const s = state([layer('WALL', [path([[0, 0], [0.001, 0], [4, 0]])])]);

    assert.equal(dxfSegments(s, { layers: ['WALL'] }).length, 1);
  });

  it('keeps everything at a minimum length of zero', () => {
    const s = state([layer('WALL', [path([[0, 0], [0.001, 0], [4, 0]])])]);

    assert.equal(dxfSegments(s, { layers: ['WALL'], minLength: 0 }).length, 2);
  });

  it('skips a path that cannot make a segment', () => {
    const s = state([layer('WALL', [path([[1, 1]]), path([], true), path(RECT, true)])]);

    assert.equal(dxfSegments(s, { layers: ['WALL'] }).length, 4);
  });

  it('reads a hidden layer that was explicitly chosen', () => {
    // Unlike snapping, which follows what is on screen: choosing a layer by
    // name here IS the instruction, and silently returning nothing for a layer
    // the person just ticked would look like a broken feature.
    const s = state([layer('WALL', [path(RECT, true)], { visible: false })]);
    s.layerVisibility = { WALL: false };

    assert.equal(dxfSegments(s, { layers: ['WALL'] }).length, 4);
  });
});

describe('summariseLayers', () => {
  const TEXT: DxfUnderlayText = {
    position: { x: 0, y: 0 }, text: 'Büro', height: 0.2,
    dirX: 1, dirY: 0, align: 'left', valign: 'baseline',
  };

  it('counts what each layer would contribute', () => {
    // Counts rather than names are what makes the choice decidable at a glance.
    const s = state([
      layer('WALL', [path(RECT, true)]),
      layer('ROOMNAMES', [], { texts: [TEXT, TEXT] }),
    ]);

    const [wall, names] = summariseLayers(s);

    assert.equal(wall.segments, 4);
    assert.equal(wall.texts, 0);
    assert.equal(names.segments, 0);
    assert.equal(names.texts, 2);
  });

  it('counts in unplaced space, so the number does not move with the plan', () => {
    const s = state([layer('WALL', [path(RECT, true)])],
      { ...DEFAULT_DXF_PLACEMENT, scale: 1000 });

    assert.equal(summariseLayers(s)[0].segments, 4);
  });

  it('reports the visibility actually in force', () => {
    const s = state([layer('WALL', [path(RECT, true)], { visible: true })]);
    s.layerVisibility = { WALL: false };

    assert.equal(summariseLayers(s)[0].visible, false);
  });

  it('falls back to the DXF table when nothing has been toggled', () => {
    const s = state([layer('WALL', [path(RECT, true)], { visible: false })]);

    assert.equal(summariseLayers(s)[0].visible, false);
  });

  it('lists every layer, including empty ones', () => {
    // A layer with nothing on it is still worth showing: its emptiness is the
    // answer to "why did picking it find no rooms".
    assert.equal(summariseLayers(state([layer('WALL', []), layer('GRID', [])])).length, 2);
  });
});

describe('suggestWallLayers', () => {
  it('recognises the usual naming, in several languages', () => {
    const s = state([
      layer('A-WALL-FULL', [path(RECT)]),
      layer('01_Waende_tragend', [path(RECT)]),
      layer('MUR_EXT', [path(RECT)]),
      layer('FURNITURE', [path(RECT)]),
    ]);

    assert.deepEqual(suggestWallLayers(s), ['A-WALL-FULL', '01_Waende_tragend', 'MUR_EXT']);
  });

  it('does not suggest a layer with nothing on it', () => {
    // Ticking it would find no rooms and read as a failure of the detection.
    assert.deepEqual(suggestWallLayers(state([layer('WALL', [])])), []);
  });

  it('suggests nothing when the naming gives nothing away', () => {
    // The empty suggestion is honest. Guessing here produces a confident wrong
    // answer, which is worse than one somebody has to make themselves.
    assert.deepEqual(suggestWallLayers(state([layer('L01', [path(RECT)])])), []);
  });
});
