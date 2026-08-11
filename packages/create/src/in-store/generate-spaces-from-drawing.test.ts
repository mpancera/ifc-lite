/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { DetectedSpace, Segment } from './auto-space-detect.js';
import {
  DRAWING_SPACE_OBJECTTYPE,
  drawingSpaceParams,
  generateSpacesFromDrawing,
  regionWidth,
} from './generate-spaces-from-drawing.js';

/**
 * Detection and filtering happen before anything is written, so a dry run
 * exercises them without a parsed model. The emit decisions are checked
 * through `drawingSpaceParams` below, which is where they actually live.
 */
const NO_STORE = null as unknown as IfcDataStore;
const NO_EDITOR = null as unknown as StoreEditor;

function seg(ax: number, ay: number, bx: number, by: number): Segment {
  return { a: [ax, ay], b: [bx, by] };
}

/** A closed rectangle of `w` × `h` at the origin, as four separate segments. */
function room(w: number, h: number, ox = 0, oy = 0): Segment[] {
  return [
    seg(ox, oy, ox + w, oy),
    seg(ox + w, oy, ox + w, oy + h),
    seg(ox + w, oy + h, ox, oy + h),
    seg(ox, oy + h, ox, oy),
  ];
}

const dry = { dryRun: true } as const;

describe('generateSpacesFromDrawing', () => {
  it('finds the region a closed outline encloses', () => {
    const result = generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, room(4, 3), dry);

    expect(result.detected).toHaveLength(1);
    expect(result.detected[0].area).toBeCloseTo(12, 6);
  });

  it('reports how many segments it was given', () => {
    // The count is the first thing to look at when no rooms are found: zero
    // segments means the layer choice is wrong, not the detection.
    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, room(4, 3), dry)
      .segmentsConsidered).toBe(4);
  });

  it('finds nothing in segments that enclose nothing', () => {
    const open = room(4, 3).slice(0, 3);

    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, open, dry).detected).toHaveLength(0);
  });

  it('finds nothing at all in an empty drawing', () => {
    const result = generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, [], dry);

    expect(result.detected).toHaveLength(0);
    expect(result.emitted).toHaveLength(0);
  });

  it('separates two rooms that share a wall', () => {
    // The ordinary case in a plan: rooms are drawn adjoining, not apart.
    const shared = [...room(4, 3), ...room(4, 3, 4, 0)];

    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, shared, dry)
      .detected).toHaveLength(2);
  });

  it('drops a wall cavity, which the minimum area does not catch', () => {
    // The finding this filter exists for: a 6 m run of a 0.2 m wall is 1.2 m²,
    // comfortably above any sensible minimum area. Without the width filter
    // every wall drawn as two lines would become a room.
    const cavity = room(6, 0.2);

    const result = generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, cavity, dry);

    expect(result.skippedNarrow).toBe(1);
    expect(result.emitted).toHaveLength(0);
  });

  it('keeps a small but properly shaped room', () => {
    // A 1.2 × 1.5 m WC is smaller in area than the 6 m cavity above and must
    // still survive — which is why the filter measures width, not size.
    const wc = room(1.2, 1.5);

    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, wc, dry).skippedNarrow).toBe(0);
  });

  it('keeps a long narrow corridor', () => {
    // The case the filter must not overreach on: 15 × 0.9 m is thin, but it is
    // a room somebody walks down.
    const corridor = room(15, 0.9);

    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, corridor, dry)
      .skippedNarrow).toBe(0);
  });

  it('keeps the cavity when the width filter is switched off', () => {
    const cavity = room(6, 0.2);

    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, cavity, { ...dry, minWidth: 0 })
      .skippedNarrow).toBe(0);
  });

  it('still drops what is below the minimum area', () => {
    const tiny = room(0.6, 0.6);

    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, tiny, dry).detected)
      .toHaveLength(0);
  });

  it('closes a corner left slightly open, within the snap tolerance', () => {
    // Drafting leaves gaps of a few millimetres constantly, and a room that
    // fails to close over one is the most common way this feature disappoints.
    const gapped = [
      seg(0, 0, 4, 0),
      seg(4, 0, 4, 3),
      seg(4, 3, 0, 3),
      seg(0, 3, 0, 0.05),
    ];

    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, gapped, dry)
      .detected).toHaveLength(1);
  });

  it('leaves a gap wider than the tolerance open', () => {
    // Snapping across a doorway would merge two rooms into one.
    const gapped = [
      seg(0, 0, 4, 0),
      seg(4, 0, 4, 3),
      seg(4, 3, 0, 3),
      seg(0, 3, 0, 1),
    ];

    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, gapped, dry)
      .detected).toHaveLength(0);
  });

  it('skips a region that an existing space already covers', () => {
    // Re-running over a storey that was already done must not double its rooms.
    const result = generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, room(4, 3), {
      ...dry,
      skipFootprints: [[[0, 0], [4, 0], [4, 3], [0, 3]]],
    });

    expect(result.skippedExisting).toBe(1);
  });

  it('keeps a region that lies beside an existing space', () => {
    const result = generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, room(4, 3), {
      ...dry,
      skipFootprints: [[[100, 100], [104, 100], [104, 103], [100, 103]]],
    });

    expect(result.skippedExisting).toBe(0);
    expect(result.detected).toHaveLength(1);
  });

  it('writes nothing on a dry run, even with rooms to write', () => {
    // The null store proves it: reaching the emit branch would throw.
    expect(generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, room(4, 3), dry).emitted)
      .toHaveLength(0);
  });

  it('refuses a height that would make a flat space', () => {
    // Caught here rather than deep in the builder, because the number comes
    // from a storey whose height may simply not be known yet.
    for (const height of [0, -3]) {
      expect(() => generateSpacesFromDrawing(NO_EDITOR, NO_STORE, 43, room(4, 3), {
        ...dry, height,
      })).toThrow(/height must be positive/);
    }
  });
});

describe('regionWidth', () => {
  const rect = (w: number, h: number): [number, number][] =>
    [[0, 0], [w, 0], [w, h], [0, h]];

  it('measures a thin shape as its thickness', () => {
    // 2A/P for 6 × 0.2: 2·1.2 / 12.4 = 0.194 — the wall thickness, near enough.
    expect(regionWidth(rect(6, 0.2))).toBeCloseTo(0.194, 3);
  });

  it('separates a wall cavity from the smallest real room by a wide margin', () => {
    // The margin is what makes a single default threshold safe.
    expect(regionWidth(rect(6, 0.2))).toBeLessThan(0.25);
    expect(regionWidth(rect(1.2, 1.5))).toBeGreaterThan(0.6);
  });

  it('does not care which way round the outline is wound', () => {
    // The detector emits CCW, but nothing here should depend on it.
    expect(regionWidth([...rect(4, 3)].reverse())).toBeCloseTo(regionWidth(rect(4, 3)), 9);
  });

  it('is zero for something that is not a polygon', () => {
    expect(regionWidth([])).toBe(0);
    expect(regionWidth([[0, 0], [1, 1]])).toBe(0);
  });

  it('is zero for a degenerate outline rather than dividing by zero', () => {
    expect(regionWidth([[0, 0], [0, 0], [0, 0]])).toBe(0);
  });
});

describe('drawingSpaceParams', () => {
  const region: DetectedSpace = { outline: [[0, 0], [4, 0], [4, 3], [0, 3]], area: 12 };

  it('uses the detected outline unchanged', () => {
    // No inset. A plan draws both wall faces, so the region between them is
    // already the room; insetting would shrink it by a thickness nobody
    // measured.
    expect(drawingSpaceParams(region, 0, 3, 'Room {n}').OuterCurve).toEqual(region.outline);
  });

  it('writes no GrossFloorArea', () => {
    // The area is a NET measure. Recording it under a gross name would put a
    // wrong number into a take-off, which is worse than a missing one.
    expect(drawingSpaceParams(region, 0, 3, 'Room {n}')).not.toHaveProperty('grossFloorArea');
  });

  it('writes no space boundaries', () => {
    // IfcRelSpaceBoundary points at the building element bounding the space,
    // and a line on a drawing is not one.
    expect(drawingSpaceParams(region, 0, 3, 'Room {n}')).not.toHaveProperty('boundaries');
  });

  it('marks where the space came from', () => {
    // A room traced from a sales-stage plan is a placeholder; one derived from
    // modelled walls is a measurement. A reader that cannot tell them apart
    // will trust the wrong one.
    expect(drawingSpaceParams(region, 0, 3, 'Room {n}').ObjectType)
      .toBe(DRAWING_SPACE_OBJECTTYPE);
  });

  it('numbers the rooms from one', () => {
    expect(drawingSpaceParams(region, 0, 3, 'Room {n}').Name).toBe('Room 1');
    expect(drawingSpaceParams(region, 4, 3, 'Room {n}').Name).toBe('Room 5');
  });

  it('takes a pattern without a placeholder as a literal name', () => {
    expect(drawingSpaceParams(region, 2, 3, 'Untitled').Name).toBe('Untitled');
  });

  it('extrudes to the height it is given', () => {
    expect(drawingSpaceParams(region, 0, 2.8, 'Room {n}').Height).toBe(2.8);
  });

  it('passes the optional descriptors through', () => {
    const params = drawingSpaceParams(region, 0, 3, 'Room {n}', {
      longName: 'Büro', predefinedType: '.OFFICE.',
    });

    expect(params.LongName).toBe('Büro');
    expect(params.PredefinedType).toBe('.OFFICE.');
  });
});
