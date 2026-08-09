/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading storeys out of a genuinely parsed file.
 *
 * `derive`, `edit` and `serialize` are tested on hand-built objects, which is
 * right for rules but proves nothing about what a file actually contains. This
 * one runs the real parser over the fixtures in
 * `packages/parser/src/__fixtures__` and asserts on what comes out — the seam
 * where the unit scale, the elevation attribute and the placement fallback all
 * meet, and the one place none of that was covered.
 *
 * It exists because the centimetre case was verified by asking a person to load
 * a particular model in a browser, twice.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeAllUnits, IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { readRawStoreys } from './read.js';
import { deriveHeightSystem } from './derive.js';
import { findUnitIssues, type ModelUnits } from './units.js';

const FIXTURES = new URL('../../../../../packages/parser/src/__fixtures__/', import.meta.url);

const stores = new Map<string, IfcDataStore>();

/** Parse a fixture once. The parser is chatty; the timings are not the point. */
async function load(name: string): Promise<IfcDataStore> {
  const cached = stores.get(name);
  if (cached) return cached;

  const bytes = readFileSync(fileURLToPath(new URL(`${name}.ifc`, FIXTURES)));
  const buffer = bytes.buffer.slice(
    bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const log = console.log;
  console.log = () => {};
  try {
    const store = await new IfcParser().parseColumnar(buffer);
    stores.set(name, store);
    return store;
  } finally {
    console.log = log;
  }
}

/** Storeys in the order the height system shows them: lowest first. */
async function storeysOf(name: string) {
  const read = readRawStoreys(await load(name), name);
  return { ...read, storeys: [...read.storeys].sort((a, b) => a.elevation - b.elevation) };
}

before(async () => {
  await Promise.all(
    ['millimetre', 'centimetre', 'centimetre-square-foot', 'no-units', 'null-elevation', 'foot']
      .map(load),
  );
});

describe('readRawStoreys · what the file says', () => {
  it('reports elevations in FILE units, not metres', () => {
    // One scale then applies to the whole list, which is what
    // deriveHeightSystem expects. Converting here would need the scale twice.
    const { storeys, lengthUnitScale } = readRawStoreys(stores.get('millimetre')!, 'm');

    assert.deepEqual([...storeys].map((s) => s.elevation).sort((a, b) => a - b),
      [-2430, 0, 3500]);
    assert.equal(lengthUnitScale, 0.001);
  });

  it('names the length unit', () => {
    assert.equal(readRawStoreys(stores.get('centimetre')!, 'c').lengthUnitName, 'CENTI.METRE');
  });

  it('leaves the unit name null when the file declares none', () => {
    // NOT 'METRE'. The scale falls back to 1 so geometry can draw; the name
    // must stay unknown so the derivation can refuse.
    const read = readRawStoreys(stores.get('no-units')!, 'n');

    assert.equal(read.lengthUnitName, null);
    assert.equal(read.lengthUnitScale, 1);
  });

  it('prefixes ids with the model, so a federation cannot collide two storeys', () => {
    const { storeys } = readRawStoreys(stores.get('millimetre')!, 'model-a');

    assert.ok(storeys.every((s) => s.id.startsWith('model-a:')), storeys[0]?.id);
  });

  it('keeps the storey names', async () => {
    const { storeys } = await storeysOf('centimetre');

    assert.deepEqual(storeys.map((s) => s.name), ['UG', 'EG', 'Roof']);
  });
});

describe('readRawStoreys · provenance', () => {
  it('marks an elevation that was written down as such', async () => {
    const { storeys } = await storeysOf('millimetre');

    assert.ok(storeys.every((s) => s.source === 'ifc-elevation-attribute'),
      storeys.map((s) => s.source).join(', '));
  });

  it('falls back to the placement when Elevation is absent, and says so', async () => {
    // Elevation is OPTIONAL and several exporters leave it out. The height is
    // still recoverable — but it is an inference, not something the architect
    // wrote, and the export has to be able to tell a reader which it is.
    const { storeys, lengthUnitScale } = await storeysOf('null-elevation');

    assert.deepEqual(storeys.map((s) => s.source),
      ['ifc-elevation-attribute', 'object-placement']);
    // Expressed back in FILE units, so the one scale still applies to both.
    assert.deepEqual(storeys.map((s) => s.elevation), [0, 3000]);
    assert.equal(lengthUnitScale, 0.001);
  });
});

describe('deriveHeightSystem · over a parsed file', () => {
  const derive = async (name: string) => {
    const read = readRawStoreys(await load(name), name);
    return deriveHeightSystem({ fileName: `${name}.ifc`, ...read });
  };

  it('converts millimetres to metres', async () => {
    const result = await derive('millimetre');

    assert.ok(result.ok);
    assert.deepEqual(result.system.storeys.map((s) => s.elevation), [-2.43, 0, 3.5]);
    assert.equal(result.system.derivedFrom.sourceLengthUnit, 'MILLI.METRE');
  });

  it('converts centimetres, the case that reads as a 609 metre building', async () => {
    // 0 / 240 / 609.6 are the numbers measured on a real centimetre model.
    // Taken at face value the top of the building is at 609 metres.
    const result = await derive('centimetre');

    assert.ok(result.ok);
    assert.deepEqual(result.system.storeys.map((s) => s.elevation), [0, 2.4, 6.096]);
  });

  it('converts feet', async () => {
    const result = await derive('foot');

    assert.ok(result.ok);
    assert.deepEqual(result.system.storeys.map((s) => s.elevation), [0, 3.048]);
    assert.equal(result.system.derivedFrom.sourceLengthUnit, 'FOOT');
  });

  it('refuses a file with no unit assignment instead of assuming metres', async () => {
    // The numbers in that file are 0 and 3000. Assuming metres would put the
    // upper floor three kilometres up; assuming millimetres would be a guess
    // that happens to be right most of the time, which is worse.
    const result = await derive('no-units');

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason.length > 0);
  });

  it('takes the length unit even when the area unit contradicts it', async () => {
    // The half-converted template. The length unit is centimetres and that is
    // the one the heights depend on — the square feet are a separate problem,
    // reported by findUnitIssues, not a reason to refuse a height.
    const result = await derive('centimetre-square-foot');

    assert.ok(result.ok);
    assert.deepEqual(result.system.storeys.map((s) => s.elevation), [0, 3.2]);
    assert.equal(result.system.derivedFrom.sourceLengthUnit, 'CENTI.METRE');
  });
});

describe('findUnitIssues · over parsed files', () => {
  /** Built the way the panel builds it, from `describeAllUnits`. */
  const asModel = (name: string): ModelUnits => {
    const store = stores.get(name)!;
    return {
      modelId: name,
      fileName: `${name}.ifc`,
      units: describeAllUnits(store.source, store.entityIndex),
    };
  };

  it('finds nothing wrong with a healthy millimetre file', () => {
    // The guard against the opposite failure: a check that flags every normal
    // file is a check nobody reads.
    assert.deepEqual(findUnitIssues([asModel('millimetre')]), []);
  });

  it('finds nothing wrong with a consistently imperial file', () => {
    assert.deepEqual(findUnitIssues([asModel('foot')]), []);
  });

  it('flags the half-converted template — the case never seen on a real file', () => {
    const issues = findUnitIssues([asModel('centimetre-square-foot')]);

    assert.equal(issues.length, 2, 'area and volume both');
    assert.ok(issues.every((i) => i.kind === 'inconsistent-derived'),
      issues.map((i) => i.kind).join(', '));
    assert.match(issues[0].message, /CENTI\.METRE/);
    assert.match(issues[0].message, /SQUARE FOOT/);
  });

  it('flags a file that declares no units at all', () => {
    assert.equal(findUnitIssues([asModel('no-units')])[0].kind, 'no-assignment');
  });

  it('flags a federation whose length units disagree', () => {
    // Two real files, two different length units, one project. Neither is
    // authoritative, so both get named.
    const issues = findUnitIssues([asModel('millimetre'), asModel('centimetre')])
      .filter((i) => i.kind === 'differs-from-federation');

    assert.equal(issues.length, 2);
  });
});
