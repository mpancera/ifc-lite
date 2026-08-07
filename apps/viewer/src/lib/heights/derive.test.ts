/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REFERENCE_LEVELS, deriveHeightSystem, levelElevation, levelsFor, withStoreyHeights,
  type DeriveInput, type DeriveResult, type RawStorey,
} from './derive.js';
import type { HeightSystem, Storey } from './types.js';

const FIXED_NOW = () => new Date('2026-08-07T10:00:00.000Z');

/** Storey elevations as they sit in the FILE, before scaling. */
function raw(elevations: readonly (readonly [string, number])[]): RawStorey[] {
  return elevations.map(([name, elevation], i) => ({
    id: `s${i}`, name, elevation, source: 'ifc-elevation-attribute' as const,
  }));
}

function input(over: Partial<DeriveInput> = {}): DeriveInput {
  return {
    fileName: 'arch.ifc',
    storeys: raw([['E00', 0], ['O01', 3000]]),
    lengthUnitScale: 0.001,
    lengthUnitName: 'MILLI.METRE',
    now: FIXED_NOW,
    ...over,
  };
}

/** Assert success and hand back the system, so each test reads as one thing. */
function unwrap(result: DeriveResult): HeightSystem {
  if (!result.ok) assert.fail(`expected a height system, got: ${result.reason}`);
  return result.system;
}

describe('deriveHeightSystem · units', () => {
  it('converts a millimetre model to metres', () => {
    const system = unwrap(deriveHeightSystem(input()));

    assert.deepEqual(system.storeys.map((s) => s.elevation), [0, 3]);
    assert.equal(system.derivedFrom.sourceLengthUnit, 'MILLI.METRE');
  });

  it('converts a CENTIMETRE model to metres', () => {
    // The second real model measured. Read as millimetres it would be out by
    // a factor of 10; read as metres, by 100 — and neither shows.
    const system = unwrap(deriveHeightSystem(input({
      storeys: raw([['UG', -243], ['EG', 0], ['OG', 350]]),
      lengthUnitScale: 0.01,
      lengthUnitName: 'CENTI.METRE',
    })));

    assert.deepEqual(system.storeys.map((s) => s.elevation), [-2.43, 0, 3.5]);
  });

  it('passes a metre model through unchanged', () => {
    const system = unwrap(deriveHeightSystem(input({
      storeys: raw([['EG', 0], ['OG', 3.5]]),
      lengthUnitScale: 1,
      lengthUnitName: 'METRE',
    })));

    assert.deepEqual(system.storeys.map((s) => s.elevation), [0, 3.5]);
  });

  it('handles an imperial model', () => {
    const system = unwrap(deriveHeightSystem(input({
      storeys: raw([['L1', 0], ['L2', 10]]),
      lengthUnitScale: 0.3048,
      lengthUnitName: 'FOOT',
    })));

    assert.equal(system.storeys[1].elevation, 3.048);
  });

  it('REFUSES when the unit is unknown', () => {
    // The whole reason the derivation is allowed to fail: assuming metres
    // yields a plausible-looking list that is wrong by a constant factor.
    const result = deriveHeightSystem(input({ lengthUnitName: null }));

    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.reason, /Längeneinheit/);
  });

  it('refuses an unusable scale', () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(deriveHeightSystem(input({ lengthUnitScale: scale })).ok, false, `scale ${scale}`);
    }
  });

  it('refuses a model with no storeys', () => {
    const result = deriveHeightSystem(input({ storeys: [] }));

    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.reason, /Geschosse/);
  });
});

describe('deriveHeightSystem · shape', () => {
  it('sorts storeys ascending by elevation', () => {
    const system = unwrap(deriveHeightSystem(input({
      storeys: raw([['O02', 6260], ['U01', -2430], ['E00', 0], ['O01', 3500]]),
    })));

    assert.deepEqual(system.storeys.map((s) => s.name), ['U01', 'E00', 'O01', 'O02']);
  });

  it('keeps the source of every elevation', () => {
    const system = unwrap(deriveHeightSystem(input({
      storeys: [
        { id: 'a', name: 'EG', elevation: 0, source: 'ifc-elevation-attribute' },
        { id: 'b', name: 'OG', elevation: 3000, source: 'object-placement' },
      ],
    })));

    assert.deepEqual(system.storeys.map((s) => s.source),
      ['ifc-elevation-attribute', 'object-placement']);
  });

  it('omits the sea-level datum rather than writing zero', () => {
    // undefined means "unknown"; 0 would be a claim about the site.
    const system = unwrap(deriveHeightSystem(input()));

    assert.equal('datumAboveSeaLevel' in system, false);
  });

  it('carries the datum when it is known', () => {
    const system = unwrap(deriveHeightSystem(input({ datumAboveSeaLevel: 412.35 })));

    assert.equal(system.datumAboveSeaLevel, 412.35);
  });

  it('starts from the OK-Fertigboden default levels', () => {
    const system = unwrap(deriveHeightSystem(input()));

    assert.deepEqual(system.referenceLevels, [...DEFAULT_REFERENCE_LEVELS]);
    assert.equal(system.referenceLevels[0].offset, 0, 'FFL is the zero');
  });

  it('takes supplied reference levels instead', () => {
    const levels = [{ key: 'ffl', label: 'OK-FB', offset: 0 }];
    const system = unwrap(deriveHeightSystem(input({ referenceLevels: levels })));

    assert.deepEqual(system.referenceLevels, levels);
  });

  it('records the file it came from and stamps the time', () => {
    const system = unwrap(deriveHeightSystem(input({ documentId: 'doc-7' })));

    assert.equal(system.derivedFrom.fileName, 'arch.ifc');
    assert.equal(system.derivedFrom.documentId, 'doc-7');
    assert.equal(system.updatedAt, '2026-08-07T10:00:00.000Z');
    assert.equal(system.formatVersion, 1);
  });

  it('omits documentId when there is none', () => {
    const system = unwrap(deriveHeightSystem(input()));

    assert.equal('documentId' in system.derivedFrom, false);
  });

  it('does not alias the caller\'s reference levels', () => {
    const levels = [{ key: 'ffl', label: 'OK-FB', offset: 0 }];
    const system = unwrap(deriveHeightSystem(input({ referenceLevels: levels })));
    system.referenceLevels.push({ key: 'x', label: 'x', offset: 1 });

    assert.equal(levels.length, 1);
  });
});

describe('withStoreyHeights', () => {
  const storeys: Storey[] = [
    { id: 'a', name: 'U01', elevation: -2.43, source: 'ifc-elevation-attribute' },
    { id: 'b', name: 'E00', elevation: 0, source: 'ifc-elevation-attribute' },
    { id: 'c', name: 'O01', elevation: 3.5, source: 'ifc-elevation-attribute' },
  ];

  it('measures each height against the storey above', () => {
    const withHeights = withStoreyHeights(storeys);

    assert.equal(withHeights[0].height, 2.43);
    assert.equal(withHeights[1].height, 3.5);
  });

  it('reports the topmost height as null, NOT zero', () => {
    // Nothing in the file says where the building ends; 0 would be a claim.
    assert.equal(withStoreyHeights(storeys)[2].height, null);
  });

  it('sorts before measuring, so input order cannot corrupt a height', () => {
    const shuffled = [storeys[2], storeys[0], storeys[1]];
    const withHeights = withStoreyHeights(shuffled);

    assert.deepEqual(withHeights.map((s) => s.name), ['U01', 'E00', 'O01']);
    assert.equal(withHeights[0].height, 2.43);
  });

  it('gives a single storey no height at all', () => {
    assert.equal(withStoreyHeights([storeys[1]])[0].height, null);
  });

  it('reports zero for two storeys genuinely at the same level', () => {
    // A split level. Zero is the truth here, unlike at the top.
    const flat: Storey[] = [
      { id: 'a', name: 'A', elevation: 3, source: 'manual' },
      { id: 'b', name: 'B', elevation: 3, source: 'manual' },
    ];

    assert.equal(withStoreyHeights(flat)[0].height, 0);
  });

  it('leaves the input untouched', () => {
    const order = storeys.map((s) => s.name);
    withStoreyHeights([storeys[2], storeys[0], storeys[1]]);

    assert.deepEqual(storeys.map((s) => s.name), order);
  });
});

describe('levelsFor / levelElevation', () => {
  const system = { referenceLevels: [...DEFAULT_REFERENCE_LEVELS] };
  const storey: Storey = { id: 'a', name: 'E00', elevation: 3.5, source: 'manual' };

  it('falls back to the system levels', () => {
    assert.deepEqual(levelsFor(storey, system), system.referenceLevels);
  });

  it('lets a storey override them', () => {
    const own = [{ key: 'ffl', label: 'OK-FB', offset: 0.05 }];

    assert.deepEqual(levelsFor({ ...storey, levels: own }, system), own);
  });

  it('treats an EMPTY override as "this storey has none"', () => {
    // Otherwise the exception could not be expressed at all.
    assert.deepEqual(levelsFor({ ...storey, levels: [] }, system), []);
  });

  it('resolves a named level to an absolute elevation', () => {
    assert.equal(levelElevation(storey, system, 'ffl'), 3.5);
    assert.equal(levelElevation(storey, system, 'ssl'), 3.2);
  });

  it('returns null for a level the storey does not have', () => {
    // Silently handing back the storey elevation would answer a different
    // question than the one asked.
    assert.equal(levelElevation(storey, system, 'gibtsnicht'), null);
    assert.equal(levelElevation({ ...storey, levels: [] }, system, 'ffl'), null);
  });
});
