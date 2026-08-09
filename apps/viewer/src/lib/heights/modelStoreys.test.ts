/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The per-model storey export, against genuinely parsed files.
 *
 * Both unit cases run here, because the unit is the one mistake that produces
 * a completely plausible wrong answer: a centimetre file read as metres turns
 * a 6 metre building into a 609 metre one.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { collectModelStoreys, serializeModelStoreys } from './modelStoreys.js';

const FIXTURES = new URL('../../../../../packages/parser/src/__fixtures__/', import.meta.url);
const NOW = new Date('2026-08-09T09:30:00.000Z');

const stores = new Map<string, IfcDataStore>();

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

const collect = (name: string, over: { fileName?: string; documentId?: string } = {}) =>
  collectModelStoreys({
    store: stores.get(name)!,
    modelId: `model-${name}`,
    fileName: over.fileName ?? `${name}.ifc`,
    ...(over.documentId !== undefined ? { documentId: over.documentId } : {}),
  }, NOW);

before(async () => {
  await Promise.all(
    ['millimetre', 'centimetre', 'foot', 'no-units', 'null-elevation', 'no-storeys'].map(load),
  );
});

describe('collectModelStoreys · units', () => {
  it('converts millimetres to metres', () => {
    const result = collect('millimetre');

    assert.equal(result.status, 'ok');
    assert.ok(result.status === 'ok');
    assert.deepEqual(result.storeys.storeys.map((s) => s.elevation), [-2.43, 0, 3.5]);
    assert.equal(result.storeys.model.sourceLengthUnit, 'MILLI.METRE');
  });

  it('converts centimetres — the 609 metre building', () => {
    // Read as metres this file describes a building whose roof is at 609.6 m.
    // The numbers are the ones measured on a real centimetre model.
    const result = collect('centimetre');

    assert.ok(result.status === 'ok');
    assert.deepEqual(result.storeys.storeys.map((s) => s.elevation), [0, 2.4, 6.096]);
    assert.equal(result.storeys.model.sourceLengthUnit, 'CENTI.METRE');
  });

  it('converts feet', () => {
    const result = collect('foot');

    assert.ok(result.status === 'ok');
    assert.deepEqual(result.storeys.storeys.map((s) => s.elevation), [0, 3.048]);
  });

  it('refuses a model whose unit cannot be determined', () => {
    // Rather than assuming a factor of 1. That file's numbers are 0 and 3000;
    // as metres the upper floor sits three kilometres up.
    const result = collect('no-units');

    assert.equal(result.status, 'refused');
    assert.ok(result.status === 'refused' && result.reason.length > 0);
  });
});

describe('collectModelStoreys · what goes in the file', () => {
  it('sorts ascending by elevation', () => {
    const result = collect('millimetre');

    assert.ok(result.status === 'ok');
    assert.deepEqual(result.storeys.storeys.map((s) => s.name), ['U01', 'E00', 'O01']);
  });

  it('keeps the id scheme the receiving side already relies on', () => {
    const result = collect('millimetre');

    assert.ok(result.status === 'ok');
    assert.ok(result.storeys.storeys.every((s) => /^model-millimetre:\d+$/.test(s.id)),
      result.storeys.storeys[0].id);
  });

  it('records the provenance of each elevation', () => {
    // An elevation the architect wrote down and one inferred from a placement
    // are not interchangeable to somebody acting on a finding.
    const result = collect('null-elevation');

    assert.ok(result.status === 'ok');
    assert.deepEqual(result.storeys.storeys.map((s) => s.source),
      ['ifc-elevation-attribute', 'object-placement']);
  });

  it('carries the file name, which is the tie to the document', () => {
    const result = collect('centimetre', { fileName: 'ARC-basement.ifc' });

    assert.ok(result.status === 'ok');
    assert.equal(result.storeys.model.fileName, 'ARC-basement.ifc');
  });

  it('refuses without a file name rather than writing a list about nothing', () => {
    assert.equal(collect('millimetre', { fileName: '   ' }).status, 'refused');
  });

  it('omits documentId when there is none', () => {
    const result = collect('millimetre');

    assert.ok(result.status === 'ok');
    assert.equal('documentId' in result.storeys.model, false);
  });

  it('stamps the export time', () => {
    const result = collect('millimetre');

    assert.ok(result.status === 'ok');
    assert.equal(result.storeys.updatedAt, '2026-08-09T09:30:00.000Z');
  });
});

describe('collectModelStoreys · nothing is rounded', () => {
  it('does not round to the centimetre', () => {
    // The comparison reports from 5 cm up. Rounding to the centimetre spends a
    // fifth of that budget before anyone compares anything.
    const result = collect('centimetre');

    assert.ok(result.status === 'ok');
    const roof = result.storeys.storeys.at(-1)!;
    assert.equal(roof.elevation, 6.096);
    assert.notEqual(roof.elevation, 6.1);
  });

  it('survives JSON without gaining or losing precision', () => {
    const result = collect('centimetre');

    assert.ok(result.status === 'ok');
    const parsed = JSON.parse(serializeModelStoreys(result.storeys));
    assert.deepEqual(parsed.storeys.map((s: { elevation: number }) => s.elevation),
      [0, 2.4, 6.096]);
  });
});

describe('collectModelStoreys · a model without storeys', () => {
  it('reports no-storeys, so no file gets written', () => {
    // Terrain models and georeferencing tests have none. An empty list would
    // read on the other side as "this model lost all its storeys" and produce
    // a missing-storey finding for every reference storey — a pile of
    // complaints about a model that never had one.
    assert.equal(collect('no-storeys').status, 'no-storeys');
  });

  it('says no-storeys, not refused, even though nothing can be converted', () => {
    // The two mean different things to whoever reads the message. A terrain
    // model is not a unit problem, and reporting it as one sends somebody
    // hunting for a missing IfcUnitAssignment that is right there.
    const result = collect('no-storeys');

    assert.notEqual(result.status, 'refused');
  });
});

describe('serializeModelStoreys', () => {
  it('is stable, so re-exporting an unchanged model diffs to nothing', () => {
    const a = collect('millimetre');
    const b = collect('millimetre');

    assert.ok(a.status === 'ok' && b.status === 'ok');
    assert.equal(serializeModelStoreys(a.storeys), serializeModelStoreys(b.storeys));
  });

  it('ends with a newline and is indented for reading', () => {
    const result = collect('millimetre');

    assert.ok(result.status === 'ok');
    const text = serializeModelStoreys(result.storeys);
    assert.ok(text.endsWith('}\n'));
    assert.ok(text.includes('\n  "formatVersion": 1'));
  });
});
