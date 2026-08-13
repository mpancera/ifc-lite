/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  doorOperationFromIfc, planAxes, openingWidth, doorSymbol, windowSymbol,
  classifyOpeningParts, swingFromGeometry,
  type PlanAxes, type SymbolLine, type LocalBox, type DoorWidths,
} from './openingSymbols.js';

/** Identity rotation: local X along drawing +x, local +Y along drawing −y. */
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** The axes an identity placement produces, spelled out for readability. */
const AXES: PlanAxes = { along: { x: 1, y: 0 }, across: { x: 0, y: -1 } };

/** Rounded, and with negative zero folded onto zero — `deepStrictEqual` tells
 *  the two apart, and a coordinate of −0 is a coordinate of 0. */
const round = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};
const pt = (p: { x: number; y: number }) => [round(p.x), round(p.y)];

/** How far every point of a symbol sits from a centre — for arc checks. */
function radii(lines: readonly SymbolLine[], centre: { x: number; y: number }): number[] {
  const out: number[] = [];
  for (const l of lines) {
    out.push(Math.hypot(l.end.x - centre.x, l.end.y - centre.y));
  }
  return out;
}

describe('doorOperationFromIfc', () => {
  // Pins the mapping from IfcDoor §6.1.3.16 figures D and F. IFC "Left" is
  // DIN-R, so the names look swapped against a German door schedule — that is
  // the schema's naming, not a bug here.
  it('hangs SingleSwingLeft at the local X minimum', () => {
    assert.deepEqual(doorOperationFromIfc('SINGLE_SWING_LEFT'), { motion: 'swing', hinge: 'start', openTowards: 1 });
  });

  it('hangs SingleSwingRight at the local X maximum', () => {
    assert.deepEqual(doorOperationFromIfc('SINGLE_SWING_RIGHT'), { motion: 'swing', hinge: 'end', openTowards: 1 });
  });

  it('reads the enum case-insensitively and ignores stray space', () => {
    assert.equal(doorOperationFromIfc('  single_swing_right ').hinge, 'end');
  });

  it('treats a two-leaf door as two leaves, not one wide one', () => {
    assert.equal(doorOperationFromIfc('DOUBLE_DOOR_SINGLE_SWING').motion, 'double-swing');
    assert.equal(doorOperationFromIfc('DOUBLE_DOOR_DOUBLE_SWING').motion, 'double-swing');
  });

  it('gives a sliding or folding leaf no arc to sweep', () => {
    assert.deepEqual(doorOperationFromIfc('SLIDING_TO_LEFT'), { motion: 'sliding', hinge: 'start', openTowards: 1 });
    assert.deepEqual(doorOperationFromIfc('FOLDING_TO_RIGHT'), { motion: 'sliding', hinge: 'end', openTowards: 1 });
    assert.equal(doorOperationFromIfc('DOUBLE_DOOR_SLIDING').motion, 'sliding');
  });

  it('says nothing rather than guessing, when the model says nothing', () => {
    for (const value of ['NOTDEFINED', 'USERDEFINED', 'REVOLVING', 'ROLLINGUP', '', undefined, null]) {
      assert.equal(doorOperationFromIfc(value).motion, 'none', `for ${String(value)}`);
    }
  });
});

describe('classifyOpeningParts / swingFromGeometry', () => {
  /** `[minX, minY, minZ]` → `[maxX, maxY, maxZ]`, the shape localBounds has. */
  const box = (
    x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
  ): LocalBox => ({ min: [x0, y0, z0], max: [x1, y1, z1] });

  /**
   * A real door out of a project model, its leaf STANDING OPEN: 0.92 wide,
   * lining 19 cm deep sitting in the wall at z −0.96…−0.77, and a 4 cm leaf
   * edge reaching from the wall out to z 0. Plus two handle parts, which are
   * the only pieces much shorter than the door.
   */
  const openDoor = [
    box(0, 0.92, 0, 2.16, -0.96, -0.77),   // lining
    box(0.82, 0.86, 0, 2.10, -0.80, 0),    // leaf, open
    box(0.86, 0.865, 0.85, 1.05, -0.07, -0.03), // handle
    box(0.77, 0.815, 1.018, 1.043, -0.168, -0.038), // handle plate
  ];

  it('finds the lining as the piece that spans the opening', () => {
    const parts = classifyOpeningParts(openDoor);
    assert.ok(parts);
    assert.deepEqual(parts.reveal.min, [0, 0, -0.96]);
  });

  it('finds the leaf, and does not mistake the handle for it', () => {
    const parts = classifyOpeningParts(openDoor);
    assert.ok(parts?.leaf);
    assert.deepEqual(parts.leaf.min, [0.82, 0, -0.80]);
  });

  it('hangs the door where the leaf actually stands', () => {
    const parts = classifyOpeningParts(openDoor)!;
    // The leaf sits at x ≈ 0.84 in a 0…0.92 opening, so at the far end.
    assert.equal(swingFromGeometry(parts.reveal, parts.leaf!).hinge, 'end');
  });

  it('swings the door the way the leaf actually reaches', () => {
    const parts = classifyOpeningParts(openDoor)!;
    // The leaf reaches past the lining towards +Z, which is −across.
    assert.equal(swingFromGeometry(parts.reveal, parts.leaf!).openTowards, -1);
  });

  it('reads a leaf reaching the other way as the other way', () => {
    // The same door mirrored through the wall: lining at z −0.19…0, leaf out
    // to −0.96. This is the second commonest case in the model measured.
    const mirrored = [
      box(0, 0.92, 0, 2.16, -0.19, 0),
      box(0.06, 0.10, 0, 2.10, -0.96, -0.16),
    ];
    const parts = classifyOpeningParts(mirrored)!;
    const swing = swingFromGeometry(parts.reveal, parts.leaf!);
    assert.equal(swing.hinge, 'start');
    assert.equal(swing.openTowards, 1);
  });

  it('reports no leaf when the model drew the door shut', () => {
    // Lining plus a leaf filling it: nothing sticks out of the wall.
    const shut = [
      box(0, 0.9, 0, 2.0, -0.1, 0.1),
      box(0.05, 0.85, 0.05, 1.95, -0.02, 0.02),
    ];
    assert.equal(classifyOpeningParts(shut)?.leaf, null);
  });

  it('has nothing to classify without geometry', () => {
    assert.equal(classifyOpeningParts([]), null);
  });
});

describe('planAxes', () => {
  it('reads local X as the width direction', () => {
    assert.deepEqual(pt(planAxes(IDENTITY)!.along), [1, 0]);
  });

  it('reads IFC local +Y — the side a door opens towards — as GL −Z', () => {
    // The Y-up conversion sends IFC (x, y, z) to (x, z, −y), so IFC +Y is the
    // NEGATED third column. Getting this sign wrong swings every door in the
    // building into the wrong room.
    assert.deepEqual(pt(planAxes(IDENTITY)!.across), [0, -1]);
  });

  it('follows a placement turned a quarter turn about the vertical', () => {
    // The real matrix of FZK-Haus door #17468: local X maps to world −Z.
    const turned = [
      0, 0, 1, 7.41,
      0, 1, 0, 0,
      -1, 0, 0, -4.5575,
      0, 0, 0, 1,
    ];
    const axes = planAxes(turned)!;
    assert.deepEqual(pt(axes.along), [0, -1]);
    assert.deepEqual(pt(axes.across), [-1, 0]);
  });

  it('keeps the two axes perpendicular and unit length', () => {
    const axes = planAxes(IDENTITY)!;
    assert.equal(round(Math.hypot(axes.along.x, axes.along.y)), 1);
    assert.equal(round(axes.along.x * axes.across.x + axes.along.y * axes.across.y), 0);
  });

  it('has no plan symbol for a placement that vanishes in plan', () => {
    // A door lying flat: local X straight up, so it projects to a point.
    const flat = [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    assert.equal(planAxes(flat), null);
    assert.equal(planAxes(undefined), null);
    assert.equal(planAxes([1, 2, 3]), null);
  });
});

describe('openingWidth', () => {
  it('believes the geometry over the stated OverallWidth', () => {
    // The schema calls OverallWidth informational; the shape is what ships.
    assert.equal(openingWidth({ width: 0.91, depth: 0.2 }, 0.885), 0.91);
  });

  it('falls back to OverallWidth when there is no geometry', () => {
    assert.equal(openingWidth(null, 0.885), 0.885);
    assert.equal(openingWidth({ width: 0, depth: 0.2 }, 0.885), 0.885);
  });

  it('has no width when neither source states one', () => {
    assert.equal(openingWidth(null, null), null);
    assert.equal(openingWidth(null, 0), null);
    assert.equal(openingWidth({ width: 0, depth: 0 }, Number.NaN), null);
  });
});

describe('doorSymbol', () => {
  const centre = { x: 0, y: 0 };
  const width = 1;
  /** Widths with no frame, so the swing geometry can be read off round numbers. */
  const W = (rough: number): DoorWidths =>
    ({ rough, lining: 0, clear: rough, liningSource: 'model' });

  it('stands the leaf on the hinge and opens it towards local +Y', () => {
    const { swing: lines } = doorSymbol({
      centre, widths: W(width), depth: 0.2, axes: AXES, operation: { motion: 'swing', hinge: 'start', openTowards: 1 },
    });
    // Hinge at the local X minimum, i.e. x = −0.5.
    assert.deepEqual(pt(lines[0].start), [-0.5, 0]);
    // Leaf a full width along `across`, which is drawing −y here.
    assert.deepEqual(pt(lines[0].end), [-0.5, -1]);
  });

  it('hangs a right-hung door at the other jamb, opening the same way', () => {
    const { swing: lines } = doorSymbol({
      centre, widths: W(width), depth: 0.2, axes: AXES, operation: { motion: 'swing', hinge: 'end', openTowards: 1 },
    });
    assert.deepEqual(pt(lines[0].start), [0.5, 0]);
    assert.deepEqual(pt(lines[0].end), [0.5, -1]);
  });

  it('sweeps an arc of the leaf width, hinge to closed position', () => {
    const { swing: lines } = doorSymbol({
      centre, widths: W(width), depth: 0.2, axes: AXES, operation: { motion: 'swing', hinge: 'start', openTowards: 1 },
    });
    const hinge = { x: -0.5, y: 0 };
    // Every arc point is one leaf-width from the hinge.
    for (const r of radii(lines.slice(1), hinge)) {
      assert.equal(round(r), width);
    }
    // And the arc ends where the closed leaf would lie: at the far jamb.
    const last = lines[lines.length - 1].end;
    assert.deepEqual(pt(last), [0.5, 0]);
  });

  it('takes the short way round, never three quarters of a circle', () => {
    const { swing: lines } = doorSymbol({
      centre, widths: W(width), depth: 0.2, axes: AXES, operation: { motion: 'swing', hinge: 'start', openTowards: 1 },
    });
    const arc = lines.slice(1);
    // A quarter turn of radius 1 is π/2 long; the long way would be 3π/2.
    const length = arc.reduce((sum, l) => sum + Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y), 0);
    assert.ok(Math.abs(length - Math.PI / 2) < 0.01, `arc length ${length}`);
  });

  it('gives a two-leaf door one arc per jamb, each half the opening', () => {
    const { swing: lines } = doorSymbol({
      centre, widths: W(2), depth: 0.2, axes: AXES, operation: { motion: 'double-swing', hinge: 'start', openTowards: 1 },
    });
    const leaves = lines.filter((l) => Math.abs(l.start.y) < 1e-9 && Math.abs(l.end.y + 1) < 1e-9);
    assert.equal(leaves.length, 2, 'one leaf line per jamb');
    // The two leaves stand on opposite jambs and meet in the middle.
    assert.deepEqual(leaves.map((l) => round(l.start.x)).sort((a, b) => a - b), [-1, 1]);
  });

  it('draws a sliding leaf beside the opening, with no arc', () => {
    const { swing: lines } = doorSymbol({
      centre, widths: W(width), depth: 0.2, axes: AXES, operation: { motion: 'sliding', hinge: 'start', openTowards: 1 },
    });
    assert.equal(lines.length, 1, 'a sliding door sweeps nothing');
  });

  it('draws no leaf, but still a frame, when the model never said how it opens', () => {
    // The frame is measured; the swing is not. Saying nothing about the swing
    // is honest, drawing no doorway at all would just be less information.
    const parts = doorSymbol({
      centre, widths: { rough: 1, lining: 0.05, clear: 0.9, liningSource: 'model' },
      depth: 0.2, axes: AXES, operation: { motion: 'none', hinge: 'start', openTowards: 1 },
    });
    assert.deepEqual(parts.swing, []);
    assert.equal(parts.frame.length, 8, 'a rectangle at each jamb');
  });

  it('has nothing to draw for an opening of no width', () => {
    assert.deepEqual(
      doorSymbol({ centre, widths: W(0), depth: 0.2, axes: AXES, operation: { motion: 'swing', hinge: 'start', openTowards: 1 } }),
      { frame: [], swing: [] },
    );
  });

  it('sweeps the CLEAR passage, not the rough opening', () => {
    // A 1.00 opening with a 5 cm frame each side leaves 0.90 of doorway. An
    // arc drawn to 1.00 overhangs its own jambs by the frame, twice.
    const { swing } = doorSymbol({
      centre, widths: { rough: 1, lining: 0.05, clear: 0.9, liningSource: 'model' as const }, depth: 0.2, axes: AXES,
      operation: { motion: 'swing', hinge: 'start', openTowards: 1 },
    });
    assert.deepEqual(pt(swing[0].start), [-0.45, 0]);
    assert.deepEqual(pt(swing[0].end), [-0.45, -0.9]);
    for (const r of radii(swing.slice(1), { x: -0.45, y: 0 })) {
      assert.equal(round(r), 0.9);
    }
  });

  it('sets the frame between the rough opening and the clear passage', () => {
    const { frame } = doorSymbol({
      centre, widths: { rough: 1, lining: 0.05, clear: 0.9, liningSource: 'model' as const }, depth: 0.2, axes: AXES,
      operation: { motion: 'swing', hinge: 'start', openTowards: 1 },
    });
    const alongs = new Set(frame.flatMap((l) => [round(l.start.x), round(l.end.x)]));
    assert.deepEqual([...alongs].sort((a, b) => a - b), [-0.5, -0.45, 0.45, 0.5]);
  });

  it('swings the leaf to the other side when the geometry says so', () => {
    const { swing: lines } = doorSymbol({
      centre, widths: W(width), depth: 0.2, axes: AXES, operation: { motion: 'swing', hinge: 'start', openTowards: -1 },
    });
    assert.deepEqual(pt(lines[0].start), [-0.5, 0]);
    // Mirrored through the wall: the leaf now reaches +y instead of −y.
    assert.deepEqual(pt(lines[0].end), [-0.5, 1]);
  });

  it('turns the whole symbol with the placement', () => {
    const turned: PlanAxes = { along: { x: 0, y: -1 }, across: { x: -1, y: 0 } };
    const { swing: lines } = doorSymbol({
      centre, widths: W(width), depth: 0.2, axes: turned, operation: { motion: 'swing', hinge: 'start', openTowards: 1 },
    });
    assert.deepEqual(pt(lines[0].start), [0, 0.5]);
    assert.deepEqual(pt(lines[0].end), [-1, 0.5]);
  });
});

describe('windowSymbol', () => {
  it('spans the opening three times: glazing plus a frame line each side', () => {
    const lines = windowSymbol({ centre: { x: 0, y: 0 }, width: 2, depth: 0.3, axes: AXES });
    assert.equal(lines.length, 3);
    for (const l of lines) {
      assert.equal(round(Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y)), 2);
    }
  });

  it('sets the frame lines either side of the glazing, across the wall', () => {
    const lines = windowSymbol({ centre: { x: 0, y: 0 }, width: 2, depth: 0.3, axes: AXES });
    assert.deepEqual(lines.map((l) => round(l.start.y)).sort((a, b) => a - b), [-0.15, 0, 0.15]);
  });

  it('still draws a readable sash for a window modelled with no depth', () => {
    const lines = windowSymbol({ centre: { x: 0, y: 0 }, width: 2, depth: 0, axes: AXES });
    const offsets = lines.map((l) => round(l.start.y)).sort((a, b) => a - b);
    assert.deepEqual(offsets, [-0.03, 0, 0.03]);
  });

  it('has nothing to draw for an opening of no width', () => {
    assert.deepEqual(
      windowSymbol({ centre: { x: 0, y: 0 }, width: 0, depth: 0.3, axes: AXES }),
      [],
    );
  });
});
