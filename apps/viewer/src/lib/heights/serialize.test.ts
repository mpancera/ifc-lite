/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setElevation, setStoreyLevels } from './edit.js';
import {
  HEIGHTS_FILE_NAME, HEIGHTS_FILE_SUFFIX, heightSystemPayload, heightsFileName,
  serializeHeightSystem,
} from './serialize.js';
import type { HeightSystem } from './types.js';

const NOW = new Date('2026-08-08T09:30:00.000Z');

function system(): HeightSystem {
  return {
    formatVersion: 1,
    derivedFrom: { fileName: 'arch.ifc', sourceLengthUnit: 'MILLI.METRE' },
    updatedAt: '2020-01-01T00:00:00.000Z',
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

describe('heightSystemPayload', () => {
  it('rounds float noise away', () => {
    // Elevations are computed by subtraction; 0.1 - -2.43 is
    // 2.5300000000000002. Harmless internally, noise in a file somebody else
    // parses and shows.
    const edited = setElevation(system(), 'b', 0.1 + 0.2);
    const payload = heightSystemPayload(edited, NOW);

    assert.equal(payload.storeys.find((s) => s.id === 'b')!.elevation, 0.3);
  });

  it('normalises negative zero', () => {
    // Survives JSON and reads as a different number to a human.
    const payload = heightSystemPayload(setElevation(system(), 'b', -0.0001), NOW);

    assert.equal(Object.is(payload.storeys.find((s) => s.id === 'b')!.elevation, -0), false);
    assert.equal(payload.storeys.find((s) => s.id === 'b')!.elevation, 0);
  });

  it('sorts storeys ascending, whatever order they arrived in', () => {
    const shuffled = { ...system(), storeys: [system().storeys[2], system().storeys[0], system().storeys[1]] };

    assert.deepEqual(heightSystemPayload(shuffled, NOW).storeys.map((s) => s.name),
      ['U01', 'E00', 'O01']);
  });

  it('stamps the export time, not the time the system was derived', () => {
    // The receiving side asks "when was this file produced" to decide whether
    // it holds a newer version.
    assert.equal(heightSystemPayload(system(), NOW).updatedAt, '2026-08-08T09:30:00.000Z');
  });

  it('omits the sea-level datum rather than writing zero', () => {
    assert.equal('datumAboveSeaLevel' in heightSystemPayload(system(), NOW), false);
  });

  it('carries the datum when it is known', () => {
    const withDatum = { ...system(), datumAboveSeaLevel: 412.3456 };

    assert.equal(heightSystemPayload(withDatum, NOW).datumAboveSeaLevel, 412.346);
  });

  it('omits documentId when there is none', () => {
    assert.equal('documentId' in heightSystemPayload(system(), NOW).derivedFrom, false);
  });

  it('keeps a storey override, including an empty one', () => {
    // Empty means "this storey deliberately has none" — dropping it would turn
    // the exception into a fallback on the receiving side.
    const withEmpty = setStoreyLevels(system(), 'b', []);
    const payload = heightSystemPayload(withEmpty, NOW);

    assert.deepEqual(payload.storeys.find((s) => s.id === 'b')!.levels, []);
  });

  it('leaves storeys without an override without the key', () => {
    const payload = heightSystemPayload(system(), NOW);

    assert.equal('levels' in payload.storeys[0], false);
  });

  it('does not alias the input', () => {
    const source = system();
    const payload = heightSystemPayload(source, NOW);
    payload.storeys[0].elevation = 999;
    payload.referenceLevels[0].offset = 999;

    assert.equal(source.storeys[0].elevation, -2.43);
    assert.equal(source.referenceLevels[0].offset, 0);
  });
});

describe('serializeHeightSystem', () => {
  it('round-trips through JSON', () => {
    const parsed = JSON.parse(serializeHeightSystem(system(), NOW));

    assert.deepEqual(parsed, heightSystemPayload(system(), NOW));
  });

  it('is stable, so a re-export diffs to nothing but the timestamp', () => {
    const a = serializeHeightSystem(system(), NOW);
    const b = serializeHeightSystem(system(), NOW);

    assert.equal(a, b);
  });

  it('ends with a newline and is indented for reading', () => {
    const text = serializeHeightSystem(system(), NOW);

    assert.ok(text.endsWith('}\n'));
    assert.ok(text.includes('\n  "formatVersion": 1'));
  });

  it('writes every length as a metre value', () => {
    const parsed = JSON.parse(serializeHeightSystem(system(), NOW));

    assert.deepEqual(parsed.storeys.map((s: { elevation: number }) => s.elevation),
      [-2.43, 0, 3.5]);
    assert.equal(parsed.referenceLevels[1].offset, -0.3);
  });

  it('declares its format version', () => {
    assert.equal(JSON.parse(serializeHeightSystem(system(), NOW)).formatVersion, 1);
  });
});

describe('heightsFileName', () => {
  const from = (fileName: string, sanitize?: (n: string) => string) =>
    heightsFileName({ derivedFrom: { fileName } }, sanitize);

  it('names the file after the source model', () => {
    // NOT after IfcProject.Name: measured on a real model that was
    // "Project Number", a Revit template placeholder.
    assert.equal(from('MuseumLangmatt_UG.ifc'), 'MuseumLangmatt_UG.heights.json');
  });

  it('replaces the IFC extension rather than stacking on it', () => {
    for (const name of ['a.ifc', 'a.IFC', 'a.ifcx', 'a.ifczip']) {
      assert.equal(from(name), `a${HEIGHTS_FILE_SUFFIX}`, name);
    }
  });

  it('leaves a name that is not an IFC file alone', () => {
    assert.equal(from('export 2026'), `export 2026${HEIGHTS_FILE_SUFFIX}`);
  });

  it("runs the caller's sanitiser over the base name", () => {
    // The viewer passes the shared one; the library must not assume a
    // particular filesystem's rules.
    assert.equal(from('a/b:c.ifc', (n) => n.replace(/[^a-z]/gi, '-')), 'a-b-c.heights.json');
  });

  it('falls back when there is nothing usable to name it after', () => {
    assert.equal(from(''), HEIGHTS_FILE_NAME);
    assert.equal(from('   .ifc'), HEIGHTS_FILE_NAME);
    assert.equal(from('x.ifc', () => ''), HEIGHTS_FILE_NAME);
  });

  it('keeps the suffix generic', () => {
    // The contract is the JSON SHAPE; a product-specific name in a public
    // repository would say more about who wrote it than what it is.
    assert.equal(HEIGHTS_FILE_SUFFIX, '.heights.json');
    assert.equal(HEIGHTS_FILE_NAME, 'heights.json');
  });
});
