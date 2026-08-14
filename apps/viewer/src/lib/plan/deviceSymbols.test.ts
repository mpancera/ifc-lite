/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceSymbolKind, isDeviceType, deviceMarkPaths,
  DEVICE_MARK_SCREEN_PX, DEVICE_MARK_PAPER_MM,
} from './deviceSymbols.js';

describe('deviceSymbolKind', () => {
  it('marks the things a plan cannot draw at their real size', () => {
    assert.equal(deviceSymbolKind('IfcSensor'), 'sensor');
    assert.equal(deviceSymbolKind('IfcAlarm'), 'alarm');
    assert.equal(deviceSymbolKind('IfcFireSuppressionTerminal'), 'sprinkler');
    assert.equal(deviceSymbolKind('IfcLightFixture'), 'light');
    assert.equal(deviceSymbolKind('IfcOutlet'), 'electrical');
    assert.equal(deviceSymbolKind('IfcAirTerminal'), 'terminal');
  });

  it('groups by what a plan distinguishes, not by what the schema does', () => {
    // A controller and a sensor are both "something that measures or decides".
    for (const t of ['IfcSensor', 'IfcController', 'IfcActuator', 'IfcFlowInstrument']) {
      assert.equal(deviceSymbolKind(t), 'sensor', t);
    }
  });

  it('gives a sprinkler its own mark, because they get counted', () => {
    assert.notEqual(deviceSymbolKind('IfcFireSuppressionTerminal'), deviceSymbolKind('IfcSensor'));
  });

  it('leaves building fabric alone', () => {
    // The important answer: a plan covered in marks for everything would be no
    // more readable than one with none.
    for (const t of ['IfcWall', 'IfcSlab', 'IfcDoor', 'IfcWindow', 'IfcColumn', 'IfcSpace']) {
      assert.equal(deviceSymbolKind(t), null, t);
    }
  });

  it('reads the class case-insensitively', () => {
    assert.equal(deviceSymbolKind('IFCSENSOR'), 'sensor');
    assert.equal(deviceSymbolKind('ifcsensor'), 'sensor');
  });

  it('has no mark for a class it was never told about', () => {
    assert.equal(deviceSymbolKind('IfcSomethingNew'), null);
    assert.equal(deviceSymbolKind(''), null);
    assert.equal(deviceSymbolKind(undefined), null);
    assert.equal(isDeviceType(null), false);
  });
});

describe('deviceMarkPaths', () => {
  const kinds = ['sensor', 'alarm', 'sprinkler', 'light', 'electrical', 'terminal'] as const;

  it('draws every mark inside the unit square it is given', () => {
    // The caller scales this by one number; anything outside ±0.5 would make
    // one mark bigger than the rest for no stated reason.
    for (const kind of kinds) {
      for (const path of deviceMarkPaths(kind)) {
        for (const p of path) {
          assert.ok(Math.abs(p.x) <= 0.5001 && Math.abs(p.y) <= 0.5001,
            `${kind} leaves the box at ${p.x},${p.y}`);
        }
      }
    }
  });

  it('gives every mark something to draw', () => {
    for (const kind of kinds) {
      const paths = deviceMarkPaths(kind);
      assert.ok(paths.length > 0, kind);
      for (const path of paths) assert.ok(path.length >= 2, kind);
    }
  });

  it('tells the marks apart', () => {
    // Two device families sharing a shape would be worse than one family.
    const shapes = new Set(kinds.map((k) => JSON.stringify(deviceMarkPaths(k))));
    assert.equal(shapes.size, kinds.length);
  });

  it('closes the shapes that are meant to be closed', () => {
    for (const kind of ['sensor', 'alarm', 'electrical'] as const) {
      const ring = deviceMarkPaths(kind)[0];
      const a = ring[0];
      const b = ring[ring.length - 1];
      // Within a rounding error, not to the bit: a circle's last point comes
      // back through cos/sin and lands 1e-16 from its first.
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, `${kind} is not closed`);
    }
  });
});

describe('mark sizes', () => {
  it('are a readable size, not the device\'s size', () => {
    // The whole point: a detector is 100 mm across, which at 1:100 is one
    // millimetre of paper. Both constants are far larger than that.
    assert.ok(DEVICE_MARK_SCREEN_PX >= 8);
    assert.ok(DEVICE_MARK_PAPER_MM >= 2);
  });
});
