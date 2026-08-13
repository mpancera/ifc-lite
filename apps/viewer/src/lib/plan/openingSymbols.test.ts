/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  doorOperationFromIfc, planAxes, openingWidth, doorSymbol, windowSymbol,
  type PlanAxes, type SymbolLine,
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
    assert.deepEqual(doorOperationFromIfc('SINGLE_SWING_LEFT'), { motion: 'swing', hinge: 'start' });
  });

  it('hangs SingleSwingRight at the local X maximum', () => {
    assert.deepEqual(doorOperationFromIfc('SINGLE_SWING_RIGHT'), { motion: 'swing', hinge: 'end' });
  });

  it('reads the enum case-insensitively and ignores stray space', () => {
    assert.equal(doorOperationFromIfc('  single_swing_right ').hinge, 'end');
  });

  it('treats a two-leaf door as two leaves, not one wide one', () => {
    assert.equal(doorOperationFromIfc('DOUBLE_DOOR_SINGLE_SWING').motion, 'double-swing');
    assert.equal(doorOperationFromIfc('DOUBLE_DOOR_DOUBLE_SWING').motion, 'double-swing');
  });

  it('gives a sliding or folding leaf no arc to sweep', () => {
    assert.deepEqual(doorOperationFromIfc('SLIDING_TO_LEFT'), { motion: 'sliding', hinge: 'start' });
    assert.deepEqual(doorOperationFromIfc('FOLDING_TO_RIGHT'), { motion: 'sliding', hinge: 'end' });
    assert.equal(doorOperationFromIfc('DOUBLE_DOOR_SLIDING').motion, 'sliding');
  });

  it('says nothing rather than guessing, when the model says nothing', () => {
    for (const value of ['NOTDEFINED', 'USERDEFINED', 'REVOLVING', 'ROLLINGUP', '', undefined, null]) {
      assert.equal(doorOperationFromIfc(value).motion, 'none', `for ${String(value)}`);
    }
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

  it('stands the leaf on the hinge and opens it towards local +Y', () => {
    const lines = doorSymbol({
      centre, width, axes: AXES, operation: { motion: 'swing', hinge: 'start' },
    });
    // Hinge at the local X minimum, i.e. x = −0.5.
    assert.deepEqual(pt(lines[0].start), [-0.5, 0]);
    // Leaf a full width along `across`, which is drawing −y here.
    assert.deepEqual(pt(lines[0].end), [-0.5, -1]);
  });

  it('hangs a right-hung door at the other jamb, opening the same way', () => {
    const lines = doorSymbol({
      centre, width, axes: AXES, operation: { motion: 'swing', hinge: 'end' },
    });
    assert.deepEqual(pt(lines[0].start), [0.5, 0]);
    assert.deepEqual(pt(lines[0].end), [0.5, -1]);
  });

  it('sweeps an arc of the leaf width, hinge to closed position', () => {
    const lines = doorSymbol({
      centre, width, axes: AXES, operation: { motion: 'swing', hinge: 'start' },
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
    const lines = doorSymbol({
      centre, width, axes: AXES, operation: { motion: 'swing', hinge: 'start' },
    });
    const arc = lines.slice(1);
    // A quarter turn of radius 1 is π/2 long; the long way would be 3π/2.
    const length = arc.reduce((sum, l) => sum + Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y), 0);
    assert.ok(Math.abs(length - Math.PI / 2) < 0.01, `arc length ${length}`);
  });

  it('gives a two-leaf door one arc per jamb, each half the opening', () => {
    const lines = doorSymbol({
      centre, width: 2, axes: AXES, operation: { motion: 'double-swing', hinge: 'start' },
    });
    const leaves = lines.filter((l) => Math.abs(l.start.y) < 1e-9 && Math.abs(l.end.y + 1) < 1e-9);
    assert.equal(leaves.length, 2, 'one leaf line per jamb');
    // The two leaves stand on opposite jambs and meet in the middle.
    assert.deepEqual(leaves.map((l) => round(l.start.x)).sort((a, b) => a - b), [-1, 1]);
  });

  it('draws a sliding leaf beside the opening, with no arc', () => {
    const lines = doorSymbol({
      centre, width, axes: AXES, operation: { motion: 'sliding', hinge: 'start' },
    });
    assert.equal(lines.length, 1, 'a sliding door sweeps nothing');
  });

  it('draws no leaf at all when the model never said how it opens', () => {
    assert.deepEqual(
      doorSymbol({ centre, width, axes: AXES, operation: { motion: 'none', hinge: 'start' } }),
      [],
    );
  });

  it('has nothing to draw for an opening of no width', () => {
    assert.deepEqual(
      doorSymbol({ centre, width: 0, axes: AXES, operation: { motion: 'swing', hinge: 'start' } }),
      [],
    );
  });

  it('turns the whole symbol with the placement', () => {
    const turned: PlanAxes = { along: { x: 0, y: -1 }, across: { x: -1, y: 0 } };
    const lines = doorSymbol({
      centre, width, axes: turned, operation: { motion: 'swing', hinge: 'start' },
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
