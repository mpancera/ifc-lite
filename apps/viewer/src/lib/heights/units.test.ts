/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findUnitIssues, unitOf, unitTypeColumns, type ModelUnits } from './units.js';

function model(fileName: string, units: ModelUnits['units']): ModelUnits {
  return { modelId: fileName, fileName, units };
}

const si = (unitType: string, name: string) => ({ unitType, name, kind: 'IfcSIUnit' as const });
const imperial = (unitType: string, name: string) =>
  ({ unitType, name, kind: 'IfcConversionBasedUnit' as const });

/** The everyday millimetre model: prefixed length, unprefixed derived units. */
const MILLIMETRE = model('arch.ifc', [
  si('LENGTHUNIT', 'MILLI.METRE'),
  si('AREAUNIT', 'SQUARE_METRE'),
  si('VOLUMEUNIT', 'CUBIC_METRE'),
  si('PLANEANGLEUNIT', 'RADIAN'),
]);

describe('unitOf', () => {
  it('finds a declared unit', () => {
    assert.equal(unitOf(MILLIMETRE, 'LENGTHUNIT')?.name, 'MILLI.METRE');
  });

  it('reports undefined for an undeclared one', () => {
    assert.equal(unitOf(MILLIMETRE, 'MASSUNIT'), undefined);
    assert.equal(unitOf(model('x.ifc', null), 'LENGTHUNIT'), undefined);
  });
});

describe('findUnitIssues · a healthy model', () => {
  it('finds nothing wrong with a normal millimetre file', () => {
    // The prefix does NOT repeat on the derived unit — MILLI.METRE with
    // SQUARE_METRE is how essentially every millimetre file is written.
    assert.deepEqual(findUnitIssues([MILLIMETRE]), []);
  });

  it('finds nothing wrong with a consistent imperial file', () => {
    const feet = model('us.ifc', [
      imperial('LENGTHUNIT', 'FOOT'),
      imperial('AREAUNIT', 'SQUARE FOOT'),
      imperial('VOLUMEUNIT', 'CUBIC FOOT'),
    ]);

    assert.deepEqual(findUnitIssues([feet]), []);
  });

  it('finds nothing wrong with a plain metre file', () => {
    const metres = model('m.ifc', [si('LENGTHUNIT', 'METRE'), si('AREAUNIT', 'SQUARE_METRE')]);

    assert.deepEqual(findUnitIssues([metres]), []);
  });
});

describe('findUnitIssues · the half-converted template', () => {
  it('flags centimetres with square FEET', () => {
    // The real case: an imperial template converted half-way. Valid IFC,
    // invisible until length and area sit in one row.
    const mixed = model('museum.ifc', [
      si('LENGTHUNIT', 'CENTI.METRE'),
      imperial('AREAUNIT', 'SQUARE FOOT'),
      imperial('VOLUMEUNIT', 'CUBIC FOOT'),
    ]);

    const issues = findUnitIssues([mixed]);

    assert.equal(issues.length, 2, 'area and volume both');
    assert.ok(issues.every((i) => i.kind === 'inconsistent-derived'));
    assert.match(issues[0].message, /CENTI\.METRE/);
    assert.match(issues[0].message, /SQUARE FOOT/);
  });
});

describe('findUnitIssues · missing declarations', () => {
  it('flags a file with no unit assignment at all', () => {
    // Legal IFC — UnitsInContext is OPTIONAL — and it means nothing in the
    // file can be read at any scale.
    const issues = findUnitIssues([model('naked.ifc', null)]);

    assert.equal(issues[0].kind, 'no-assignment');
  });

  it('flags a file that declares units but no length', () => {
    const issues = findUnitIssues([model('odd.ifc', [si('MASSUNIT', 'GRAM')])]);

    assert.equal(issues[0].kind, 'no-length-unit');
  });

  it('does not also complain about derived units it cannot compare', () => {
    // Without a length unit there is nothing to check consistency against;
    // repeating the same problem three ways helps nobody.
    const issues = findUnitIssues([model('odd.ifc', [si('AREAUNIT', 'SQUARE FOOT')])]);

    assert.equal(issues.length, 1);
  });
});

describe('findUnitIssues · across the federation', () => {
  it('flags models whose length units disagree', () => {
    const cm = model('museum.ifc', [si('LENGTHUNIT', 'CENTI.METRE')]);
    const issues = findUnitIssues([MILLIMETRE, cm])
      .filter((i) => i.kind === 'differs-from-federation');

    assert.equal(issues.length, 2, 'both models named, since neither is authoritative');
    assert.match(issues[0].message, /MILLI\.METRE, CENTI\.METRE|CENTI\.METRE, MILLI\.METRE/);
  });

  it('says nothing when they agree', () => {
    const other = model('mep.ifc', [si('LENGTHUNIT', 'MILLI.METRE')]);

    assert.deepEqual(findUnitIssues([MILLIMETRE, other]), []);
  });

  it('says nothing about a single model', () => {
    // "Differs from the federation" is meaningless with one file.
    assert.deepEqual(
      findUnitIssues([MILLIMETRE]).filter((i) => i.kind === 'differs-from-federation'), [],
    );
  });

  it('puts the unreadable file before the merely inconsistent one', () => {
    const issues = findUnitIssues([MILLIMETRE, model('naked.ifc', null)]);

    assert.equal(issues[0].kind, 'no-assignment');
  });
});

describe('unitTypeColumns', () => {
  it('puts the everyday types first, in a fixed order', () => {
    assert.deepEqual(unitTypeColumns([MILLIMETRE]),
      ['LENGTHUNIT', 'AREAUNIT', 'VOLUMEUNIT', 'PLANEANGLEUNIT']);
  });

  it('appends unusual types alphabetically, so they are visible', () => {
    const odd = model('x.ifc', [
      si('LENGTHUNIT', 'METRE'),
      si('THERMODYNAMICTEMPERATUREUNIT', 'KELVIN'),
      si('ELECTRICCURRENTUNIT', 'AMPERE'),
    ]);

    assert.deepEqual(unitTypeColumns([odd]),
      ['LENGTHUNIT', 'ELECTRICCURRENTUNIT', 'THERMODYNAMICTEMPERATUREUNIT']);
  });

  it('unions across models', () => {
    const a = model('a.ifc', [si('LENGTHUNIT', 'METRE')]);
    const b = model('b.ifc', [si('AREAUNIT', 'SQUARE_METRE')]);

    assert.deepEqual(unitTypeColumns([a, b]), ['LENGTHUNIT', 'AREAUNIT']);
  });

  it('is empty when nothing is declared', () => {
    assert.deepEqual(unitTypeColumns([model('x.ifc', null)]), []);
  });
});
