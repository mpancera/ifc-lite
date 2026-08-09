/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The unit extractors against real STEP text.
 *
 * `unit-scale.parity.test.ts` pins the SCALE against vectors shared with the
 * Rust extractor. This pins the two describers — which report a unit's NAME to
 * a person rather than a factor to the geometry — against the fixture files in
 * `__fixtures__`, so the cases that used to need a browser and a real project
 * run in the suite.
 *
 * The distinction that matters here: `extractLengthUnitScale` is lenient and
 * falls back to metres, because geometry has to draw something. The describers
 * are strict and return `null`, because a height reported to a person must be
 * refusable.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EntityExtractor } from './entity-extractor.js';
import {
  describeAllUnits, describeLengthUnit, extractLengthUnitScale,
} from './unit-extractor.js';
import type { EntityIndex, EntityRef } from './types.js';

/** Index a fixture the same way the parity test does — one entity per line. */
function loadFixture(name: string): { source: Uint8Array; entityIndex: EntityIndex } {
  const path = fileURLToPath(new URL(`./__fixtures__/${name}.ifc`, import.meta.url));
  const content = readFileSync(path, 'utf8');
  const source = new TextEncoder().encode(content);

  const byId = new Map<number, EntityRef>();
  const byType = new Map<string, number[]>();
  const re = /^#(\d+)=([A-Z0-9_]+)\(/;
  let offset = 0;
  let lineNumber = 0;
  for (const line of content.split('\n')) {
    lineNumber += 1;
    const m = re.exec(line);
    if (m) {
      const expressId = Number(m[1]);
      byId.set(expressId, {
        expressId, type: m[2], byteOffset: offset, byteLength: line.length, lineNumber,
      });
      byType.set(m[2], [...(byType.get(m[2]) ?? []), expressId]);
    }
    offset += line.length + 1; // fixtures are pure ASCII with LF endings
  }
  return { source, entityIndex: { byId, byType } };
}

const unitOf = (units: ReturnType<typeof describeAllUnits>, type: string) =>
  units?.find((u) => u.unitType === type);

describe('describeLengthUnit', () => {
  it('names a prefixed SI unit with its prefix', () => {
    const { source, entityIndex } = loadFixture('millimetre');

    expect(describeLengthUnit(source, entityIndex)?.name).toBe('MILLI.METRE');
  });

  it('names centimetres, the unit that reads as a 609 metre building', () => {
    const { source, entityIndex } = loadFixture('centimetre');

    expect(describeLengthUnit(source, entityIndex)?.name).toBe('CENTI.METRE');
  });

  it('names a conversion-based unit by its name, not by a prefix', () => {
    const { source, entityIndex } = loadFixture('foot');

    expect(describeLengthUnit(source, entityIndex)?.name).toBe('FOOT');
  });

  it('returns null when the file declares no units at all', () => {
    // IfcProject.UnitsInContext is OPTIONAL, so this file is legal IFC.
    // Strictness is the point: the caller must be able to refuse.
    const { source, entityIndex } = loadFixture('no-units');

    expect(describeLengthUnit(source, entityIndex)).toBeNull();
  });
});

describe('extractLengthUnitScale', () => {
  it.each([
    ['millimetre', 0.001],
    ['centimetre', 0.01],
    ['centimetre-square-foot', 0.01],
    ['foot', 0.3048],
    ['null-elevation', 0.001],
  ])('reads %s as %s metres per unit', (fixture, scale) => {
    const { source, entityIndex } = loadFixture(fixture);

    expect(extractLengthUnitScale(source, entityIndex)).toBeCloseTo(scale, 12);
  });

  it('falls back to metres when nothing is declared', () => {
    // Deliberately lenient where the describers are strict: geometry still has
    // to draw. The fallback is a drawing decision, never a reporting one.
    const { source, entityIndex } = loadFixture('no-units');

    expect(extractLengthUnitScale(source, entityIndex)).toBe(1);
  });
});

describe('describeAllUnits', () => {
  it('lists every declared unit of a healthy millimetre file', () => {
    const { source, entityIndex } = loadFixture('millimetre');
    const units = describeAllUnits(source, entityIndex);

    // The prefix does NOT repeat on the derived units — this is how essentially
    // every millimetre file is written, and treating it as a mismatch would
    // flag the entire industry.
    expect(unitOf(units, 'LENGTHUNIT')).toEqual({
      unitType: 'LENGTHUNIT', name: 'MILLI.METRE', kind: 'IfcSIUnit',
    });
    expect(unitOf(units, 'AREAUNIT')?.name).toBe('SQUARE_METRE');
    expect(unitOf(units, 'VOLUMEUNIT')?.name).toBe('CUBIC_METRE');
    expect(unitOf(units, 'PLANEANGLEUNIT')?.name).toBe('RADIAN');
  });

  it('exposes the half-converted template as centimetres beside square feet', () => {
    // The whole reason the units table exists. Each row on its own is valid;
    // only length and area SIDE BY SIDE show that the areas are wrong.
    const { source, entityIndex } = loadFixture('centimetre-square-foot');
    const units = describeAllUnits(source, entityIndex);

    expect(unitOf(units, 'LENGTHUNIT')?.name).toBe('CENTI.METRE');
    expect(unitOf(units, 'AREAUNIT')?.name).toBe('SQUARE FOOT');
    expect(unitOf(units, 'VOLUMEUNIT')?.name).toBe('CUBIC FOOT');
  });

  it('records which entity declared each unit', () => {
    const { source, entityIndex } = loadFixture('centimetre-square-foot');
    const units = describeAllUnits(source, entityIndex);

    expect(unitOf(units, 'LENGTHUNIT')?.kind).toBe('IfcSIUnit');
    expect(unitOf(units, 'AREAUNIT')?.kind).toBe('IfcConversionBasedUnit');
  });

  it('returns null rather than an empty list when there is no assignment', () => {
    // Empty would mean "declares nothing"; null means "declares nowhere".
    // Only the second one justifies refusing to report a height.
    const { source, entityIndex } = loadFixture('no-units');

    expect(describeAllUnits(source, entityIndex)).toBeNull();
  });
});
