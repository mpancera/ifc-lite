/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A restored height system is applied without anybody looking at it, and every
 * number in it is metres. So the reading side is where the assertions are.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectKey } from '@ifc-lite/project';
import { loadHeightSystem, saveHeightSystem } from './systemMemory.js';
import type { HeightSystem } from './types.js';

const PROJECT = 'p1' as ProjectKey;
const OTHER = 'p2' as ProjectKey;

const SYSTEM: HeightSystem = {
  formatVersion: 1,
  derivedFrom: { fileName: 'arc.ifc', sourceLengthUnit: 'METRE' },
  updatedAt: '2026-09-15T10:00:00.000Z',
  datumAboveSeaLevel: 388.4,
  referenceLevels: [{ key: 'ffl', label: 'OK-Fertigboden', offset: 0 }],
  storeys: [
    { id: 'm1:10', name: 'U1', elevation: -3.2, source: 'ifc-elevation-attribute' },
    { id: 'm1:20', name: '00', elevation: 0, source: 'manual' },
  ],
};

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
}

function stored(value: unknown): void {
  globalThis.localStorage.setItem('ifc-lite:height-system:p1', JSON.stringify(value));
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

describe('the remembered height system', () => {
  it('comes back exactly as it went in, corrections included', () => {
    // The manual source on the second storey is the whole point: that is
    // somebody's correction of what the model claimed.
    saveHeightSystem(PROJECT, SYSTEM);

    assert.deepEqual(loadHeightSystem(PROJECT), SYSTEM);
  });

  it('stays with its own project', () => {
    saveHeightSystem(PROJECT, SYSTEM);

    assert.equal(loadHeightSystem(OTHER), null);
  });

  it('is forgotten on purpose when the system is cleared', () => {
    saveHeightSystem(PROJECT, SYSTEM);
    saveHeightSystem(PROJECT, null);

    assert.equal(loadHeightSystem(PROJECT), null);
  });

  it('refuses a version this build does not know', () => {
    // Written by a later build. Guessing at it would be guessing about metres.
    stored({ ...SYSTEM, formatVersion: 2 });

    assert.equal(loadHeightSystem(PROJECT), null);
  });

  it('refuses an elevation that is not a finite number', () => {
    stored({ ...SYSTEM, storeys: [{ ...SYSTEM.storeys[0], elevation: null }] });

    assert.equal(loadHeightSystem(PROJECT), null);
  });

  it('refuses a datum that is not a number, rather than reading it as zero', () => {
    // Zero is a claim about the site. An unreadable one must not become it.
    stored({ ...SYSTEM, datumAboveSeaLevel: 'egal' });

    assert.equal(loadHeightSystem(PROJECT), null);
  });

  it('accepts an absent datum, which means unknown', () => {
    const { datumAboveSeaLevel: _omitted, ...withoutDatum } = SYSTEM;
    saveHeightSystem(PROJECT, withoutDatum as HeightSystem);

    assert.equal(loadHeightSystem(PROJECT)?.datumAboveSeaLevel, undefined);
  });

  it('refuses a system with no storey list at all', () => {
    stored({ ...SYSTEM, storeys: undefined });

    assert.equal(loadHeightSystem(PROJECT), null);
  });

  it('survives rubbish in the slot', () => {
    globalThis.localStorage.setItem('ifc-lite:height-system:p1', 'not json');

    assert.equal(loadHeightSystem(PROJECT), null);
  });

  it('survives a session with no storage at all', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;

    assert.equal(loadHeightSystem(PROJECT), null);
    saveHeightSystem(PROJECT, SYSTEM);
  });
});
