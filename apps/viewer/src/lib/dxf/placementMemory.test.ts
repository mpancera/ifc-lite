/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What survives a reload, and — more important — what a corrupt or foreign
 * store is allowed to do. A remembered placement is applied without anybody
 * looking at it, so the reading side has to be the strict one.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectKey } from '@ifc-lite/project';
import {
  isPlaced, loadDxfPlacements, recallPlacement, saveDxfPlacements,
} from './placementMemory.js';

const PROJECT = 'p1' as ProjectKey;
const OTHER = 'p2' as ProjectKey;
const FITTED = { offsetX: 2398431.59, offsetY: 1134401.52, rotationDeg: -9.25, scale: 0.9 };

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

describe('remembering where a plan was put', () => {
  it('gives the placement back to the same file in the same project', () => {
    saveDxfPlacements(PROJECT, { 'ug1.dxf': { placement: FITTED, unitScale: 1 } });

    assert.deepEqual(recallPlacement(loadDxfPlacements(PROJECT), 'ug1.dxf', 1),
      { placement: FITTED });
  });

  it('does not hand one project\'s placement to another', () => {
    // The whole reason this is scoped: a plan fitted on one building placed
    // over a different one looks like a drawing, not like a leak.
    saveDxfPlacements(PROJECT, { 'ug1.dxf': { placement: FITTED, unitScale: 1 } });

    assert.equal(recallPlacement(loadDxfPlacements(OTHER), 'ug1.dxf', 1), null);
  });

  it('knows nothing about a file it has not seen', () => {
    saveDxfPlacements(PROJECT, { 'ug1.dxf': { placement: FITTED, unitScale: 1 } });

    assert.equal(recallPlacement(loadDxfPlacements(PROJECT), 'eg.dxf', 1), null);
  });

  it('compensates a revision exported with a different unit header', () => {
    // The stored `scale` only means something against the guess it was found
    // with; a re-export that reads as millimetres must not come back a
    // thousand times too big.
    saveDxfPlacements(PROJECT, { 'ug1.dxf': { placement: FITTED, unitScale: 1 } });
    const back = recallPlacement(loadDxfPlacements(PROJECT), 'ug1.dxf', 0.001);

    assert.ok(back);
    assert.ok(Math.abs(back.placement.scale * 0.001 - FITTED.scale * 1) < 1e-12);
  });

  it('remembers the storey the plan was assigned to', () => {
    saveDxfPlacements(PROJECT, { 'ug1.dxf': { placement: FITTED, unitScale: 1, storeyId: 'U1' } });

    assert.equal(recallPlacement(loadDxfPlacements(PROJECT), 'ug1.dxf', 1)?.storeyId, 'U1');
  });

  it('drops a malformed store whole rather than reading half of it', () => {
    // Forgetting costs a re-fit. Half-reading places a drawing by numbers
    // nobody wrote, which nothing on screen would explain.
    globalThis.localStorage.setItem('ifc-lite:dxf-placement:p1', '{ not json');

    assert.deepEqual(loadDxfPlacements(PROJECT), {});
  });

  it('skips an entry whose placement is not four finite numbers', () => {
    globalThis.localStorage.setItem('ifc-lite:dxf-placement:p1', JSON.stringify({
      'bad.dxf': { placement: { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: null }, unitScale: 1 },
      'good.dxf': { placement: FITTED, unitScale: 1 },
    }));
    const memory = loadDxfPlacements(PROJECT);

    assert.equal(recallPlacement(memory, 'bad.dxf', 1), null);
    assert.ok(recallPlacement(memory, 'good.dxf', 1));
  });

  it('survives a session with no storage at all', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;

    assert.deepEqual(loadDxfPlacements(PROJECT), {});
    saveDxfPlacements(PROJECT, { 'ug1.dxf': { placement: FITTED, unitScale: 1 } });
  });
});

describe('isPlaced', () => {
  it('says no to a plan nobody has touched', () => {
    // Otherwise every file ever opened leaves a row, and restoring it puts
    // back a default the import would have produced anyway.
    assert.equal(isPlaced({ offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 }), false);
  });

  it('says yes to a nudge as readily as to a full fit', () => {
    assert.equal(isPlaced({ offsetX: 0.01, offsetY: 0, rotationDeg: 0, scale: 1 }), true);
    assert.equal(isPlaced(FITTED), true);
  });
});
