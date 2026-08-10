/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  parseCoordinateField,
  rowsToPairs,
  type ControlPointRow,
} from './control-point-rows.js';
import { solveGeoreference } from './solve-georeference.js';

function row(overrides: Partial<ControlPointRow> & { id: string }): ControlPointRow {
  return { label: '', localX: '', localY: '', easting: '', northing: '', ...overrides };
}

describe('parseCoordinateField', () => {
  it('reads a plain number', () => {
    assert.strictEqual(parseCoordinateField('2621834.586'), 2621834.586);
    assert.strictEqual(parseCoordinateField('-57.186'), -57.186);
  });

  it('accepts a comma decimal separator', () => {
    // What a Swiss or German survey listing and most spreadsheets produce.
    assert.strictEqual(parseCoordinateField('1259822,023'), 1259822.023);
  });

  it('ignores surrounding whitespace', () => {
    assert.strictEqual(parseCoordinateField('  42.5  '), 42.5);
  });

  it('treats an empty field as absent, not as zero', () => {
    // The distinction that matters: a cleared field must not silently place a
    // control point on the origin.
    assert.strictEqual(parseCoordinateField(''), null);
    assert.strictEqual(parseCoordinateField('   '), null);
  });

  it('rejects text and half-typed input', () => {
    for (const value of ['abc', '-', '.', '1.2.3', 'NaN']) {
      assert.strictEqual(parseCoordinateField(value), null, `expected null for ${value}`);
    }
  });

  it('rejects infinities', () => {
    assert.strictEqual(parseCoordinateField('Infinity'), null);
  });
});

describe('rowsToPairs', () => {
  const complete = (id: string, x: number, y: number, e: number, n: number) => row({
    id,
    localX: String(x),
    localY: String(y),
    easting: String(e),
    northing: String(n),
  });

  it('keeps only rows carrying all four coordinates', () => {
    const { pairs, rowIds } = rowsToPairs([
      complete('a', 0, 0, 2621777.4, 1259821.9),
      row({ id: 'b', localX: '10' }),                    // half typed
      complete('c', 138.2, 148.7, 2621915.6, 1259970.6),
      row({ id: 'd' }),                                   // untouched
    ]);
    assert.strictEqual(pairs.length, 2);
    assert.deepStrictEqual(rowIds, ['a', 'c']);
  });

  it('maps each pair back to the row it came from', () => {
    // The bookkeeping this module exists for: an incomplete row ahead of a
    // complete one must not shift the residual onto the wrong point.
    const rows = [
      row({ id: 'skipped-first' }),
      complete('real-a', 0, 0, 2600000, 1200000),
      row({ id: 'skipped-middle', easting: '2600005' }),
      complete('real-b', 10, 0, 2600010, 1200000),
    ];
    const { pairs, rowIds } = rowsToPairs(rows);

    assert.deepStrictEqual(rowIds, ['real-a', 'real-b']);
    const result = solveGeoreference(pairs, { lockScale: 1 });
    assert.ok(result.ok);
    // Indices line up, so residual[i] can be shown against rowIds[i].
    assert.strictEqual(result.solution.residuals.length, rowIds.length);
  });

  it('carries a label through and drops a blank one', () => {
    const { pairs } = rowsToPairs([
      row({ id: 'a', localX: '0', localY: '0', easting: '1', northing: '2', label: '  Ecke NO  ' }),
      row({ id: 'b', localX: '1', localY: '1', easting: '3', northing: '4', label: '   ' }),
    ]);
    assert.strictEqual(pairs[0].label, 'Ecke NO');
    assert.strictEqual(pairs[1].label, undefined);
  });

  it('returns nothing for an empty table', () => {
    assert.deepStrictEqual(rowsToPairs([]), { pairs: [], rowIds: [] });
  });

  it('feeds the solver a table typed with comma decimals', () => {
    // End to end from what a person pastes in: the site plate corners of
    // 004_MOD_ARC against parcel CH775979211712, millimetres to metres.
    const { pairs } = rowsToPairs([
      row({ id: 'sw', localX: '-57186', localY: '-123', easting: '2621777,4', northing: '1259821,9' }),
      row({ id: 'ne', localX: '80993', localY: '148658', easting: '2621915,6', northing: '1259970,6' }),
    ]);
    const result = solveGeoreference(pairs, { lockScale: 0.001 });
    assert.ok(result.ok);
    assert.ok(Math.abs(result.solution.eastings - 2621834.586) < 0.05);
    assert.ok(Math.abs(result.solution.northings - 1259822.023) < 0.05);
  });
});
