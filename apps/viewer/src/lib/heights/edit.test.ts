/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withStoreyHeights } from './derive.js';
import {
  setDatumAboveSeaLevel, setElevation, setReferenceLevels, setStoreyHeight,
  setStoreyLevels, setStoreyName,
} from './edit.js';
import type { HeightSystem } from './types.js';

function system(): HeightSystem {
  return {
    formatVersion: 1,
    derivedFrom: { fileName: 'arch.ifc', sourceLengthUnit: 'MILLI.METRE' },
    updatedAt: '2026-08-07T10:00:00.000Z',
    referenceLevels: [
      { key: 'ffl', label: 'OK-Fertigboden', offset: 0 },
      { key: 'ssl', label: 'UK-Rohboden', offset: -0.3 },
    ],
    storeys: [
      { id: 'a', name: 'U01', elevation: -2.43, source: 'ifc-elevation-attribute' },
      { id: 'b', name: 'E00', elevation: 0, source: 'ifc-elevation-attribute' },
      { id: 'c', name: 'O01', elevation: 3.5, source: 'ifc-elevation-attribute' },
    ],
  };
}

/**
 * Heights are DERIVED by subtraction, so they carry float noise
 * (0.1 − −2.43 = 2.5300000000000002). Rounding to the millimetre is the
 * honest resolution for a building level and keeps the assertions about the
 * arithmetic rather than about IEEE-754. The library itself stays exact and
 * formats at the edge.
 */
const mm = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
const heightsOf = (s: HeightSystem) => withStoreyHeights(s.storeys).map((x) => mm(x.height));
const elevationsOf = (s: HeightSystem) => s.storeys.map((x) => mm(x.elevation));

describe('setElevation', () => {
  it('sets the value and marks it manual', () => {
    // The source field is not decoration: a re-derivation must be able to tell
    // what a person decided from what the model said.
    const next = setElevation(system(), 'b', 0.15);
    const storey = next.storeys.find((s) => s.id === 'b')!;

    assert.equal(storey.elevation, 0.15);
    assert.equal(storey.source, 'manual');
  });

  it('re-sorts when a storey moves past its neighbour', () => {
    const next = setElevation(system(), 'a', 5);

    assert.deepEqual(next.storeys.map((s) => s.name), ['E00', 'O01', 'U01']);
  });

  it('leaves the reference levels alone, so they move with the storey', () => {
    // They are offsets. Touching them here would break the one property the
    // whole Vectorworks-style model exists for.
    const next = setElevation(setStoreyLevels(system(), 'b', [
      { key: 'ffl', label: 'OK-FB', offset: 0.02 },
    ]), 'b', 1);
    const storey = next.storeys.find((s) => s.id === 'b')!;

    assert.deepEqual(storey.levels, [{ key: 'ffl', label: 'OK-FB', offset: 0.02 }]);
  });

  it('ignores an unknown storey, a non-finite value and a no-op', () => {
    const before = system();
    assert.equal(setElevation(before, 'nope', 1), before);
    assert.equal(setElevation(before, 'b', Number.NaN), before);
    assert.equal(setElevation(before, 'b', 0), before, 'identical value is not an edit');
  });

  it('does not mutate the input', () => {
    const before = system();
    setElevation(before, 'b', 9);

    assert.equal(before.storeys.find((s) => s.id === 'b')!.elevation, 0);
  });
});

describe('setStoreyName', () => {
  it('renames without claiming the elevation was touched', () => {
    // A name is display only and never a key, so it says nothing about
    // whether the elevation is still the model's.
    const next = setStoreyName(system(), 'b', 'EG');
    const storey = next.storeys.find((s) => s.id === 'b')!;

    assert.equal(storey.name, 'EG');
    assert.equal(storey.source, 'ifc-elevation-attribute');
  });
});

describe('setStoreyHeight', () => {
  it('raises the storey above to make the height', () => {
    // Height is not stored — it is the gap. Typing one moves the neighbour,
    // which is also what physically happens when a floor gets taller.
    const next = setStoreyHeight(system(), 'b', 4);

    assert.deepEqual(heightsOf(next), [2.43, 4, null]);
  });

  it('keeps the heights of the storeys ABOVE unchanged', () => {
    // Moving only the neighbour would silently resize a second storey as a
    // side effect of editing this one.
    const four = { ...system() };
    four.storeys = [...four.storeys, { id: 'd', name: 'O02', elevation: 6.26, source: 'ifc-elevation-attribute' }];
    const before = heightsOf(four);

    const next = setStoreyHeight(four, 'b', 4);

    assert.deepEqual(heightsOf(next), [before[0], 4, before[2], null]);
  });

  it('marks every storey it moved as manual, and only those', () => {
    const next = setStoreyHeight(system(), 'b', 4);
    const bySource = Object.fromEntries(next.storeys.map((s) => [s.name, s.source]));

    assert.deepEqual(bySource, {
      U01: 'ifc-elevation-attribute',
      E00: 'ifc-elevation-attribute',
      O01: 'manual',
    });
  });

  it('refuses on the topmost storey, which has no neighbour to move', () => {
    const before = system();
    assert.equal(setStoreyHeight(before, 'c', 3), before);
  });

  it('refuses a non-positive or non-finite height', () => {
    const before = system();
    for (const h of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(setStoreyHeight(before, 'b', h), before, `height ${h}`);
    }
  });

  it('is a no-op when the height already matches', () => {
    const before = system();
    assert.equal(setStoreyHeight(before, 'b', 3.5), before);
  });
});

describe('setDatumAboveSeaLevel', () => {
  it('sets the datum', () => {
    assert.equal(setDatumAboveSeaLevel(system(), 412.35).datumAboveSeaLevel, 412.35);
  });

  it('clears it back to unknown rather than to zero', () => {
    // undefined means "we do not know"; 0 would be a claim about the site.
    const withDatum = setDatumAboveSeaLevel(system(), 412.35);
    const cleared = setDatumAboveSeaLevel(withDatum, null);

    assert.equal('datumAboveSeaLevel' in cleared, false);
  });

  it('ignores a non-finite datum', () => {
    const before = system();
    assert.equal(setDatumAboveSeaLevel(before, Number.NaN), before);
  });
});

describe('setStoreyLevels', () => {
  it('gives a storey its own levels', () => {
    const own = [{ key: 'ffl', label: 'OK-FB', offset: 0.05 }];
    const next = setStoreyLevels(system(), 'b', own);

    assert.deepEqual(next.storeys.find((s) => s.id === 'b')!.levels, own);
  });

  it('keeps an EMPTY override, which means "this storey has none"', () => {
    const next = setStoreyLevels(system(), 'b', []);

    assert.deepEqual(next.storeys.find((s) => s.id === 'b')!.levels, []);
  });

  it('drops the override on null, falling back to the system levels', () => {
    const withOwn = setStoreyLevels(system(), 'b', []);
    const next = setStoreyLevels(withOwn, 'b', null);

    assert.equal('levels' in next.storeys.find((s) => s.id === 'b')!, false);
  });

  it('does not alias the caller\'s array', () => {
    const own = [{ key: 'ffl', label: 'OK-FB', offset: 0 }];
    const next = setStoreyLevels(system(), 'b', own);
    next.storeys.find((s) => s.id === 'b')!.levels!.push({ key: 'x', label: 'x', offset: 1 });

    assert.equal(own.length, 1);
  });
});

describe('setReferenceLevels', () => {
  it('replaces the system levels', () => {
    const levels = [{ key: 'ffl', label: 'OK-FB', offset: 0 }];

    assert.deepEqual(setReferenceLevels(system(), levels).referenceLevels, levels);
  });

  it('does not alias the caller\'s array', () => {
    const levels = [{ key: 'ffl', label: 'OK-FB', offset: 0 }];
    setReferenceLevels(system(), levels).referenceLevels.push({ key: 'x', label: 'x', offset: 1 });

    assert.equal(levels.length, 1);
  });
});

describe('editing keeps elevations and heights consistent', () => {
  it('survives a sequence of edits', () => {
    let s = system();
    s = setElevation(s, 'b', 0.1);
    s = setStoreyHeight(s, 'b', 3.6);
    s = setStoreyName(s, 'c', 'OG');

    assert.deepEqual(elevationsOf(s), [-2.43, 0.1, 3.7]);
    assert.deepEqual(heightsOf(s), [2.53, 3.6, null]);
    assert.equal(s.storeys[2].name, 'OG');
  });
});
