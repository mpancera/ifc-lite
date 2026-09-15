/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlanDisplay, savePlanDisplay, PLAN_DISPLAY_DEFAULTS } from './planDisplayStore.js';

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

describe('the remembered plan layers', () => {
  it('starts at the defaults with nothing stored', () => {
    assert.deepEqual(loadPlanDisplay(), { ...PLAN_DISPLAY_DEFAULTS });
  });

  it('gives back exactly what was switched', () => {
    savePlanDisplay({ ...PLAN_DISPLAY_DEFAULTS, planShowDoorLabels: false, planShowCompartments: true });
    const back = loadPlanDisplay();

    assert.equal(back.planShowDoorLabels, false);
    assert.equal(back.planShowCompartments, true);
    assert.equal(back.planShowRoomLabels, true);
  });

  it('writes nothing when everything sits at its default', () => {
    // A row that says "everything is normal" is a row that has to be read,
    // migrated and reasoned about forever.
    savePlanDisplay({ ...PLAN_DISPLAY_DEFAULTS, planShowDoorLabels: false });
    savePlanDisplay({ ...PLAN_DISPLAY_DEFAULTS });

    assert.equal(globalThis.localStorage.getItem('ifc-lite:plan-display'), null);
  });

  it('lets a switch it has never heard of keep its own default', () => {
    // Stored as a diff for exactly this: a record written before a layer
    // existed must not force that layer off for everybody.
    globalThis.localStorage.setItem('ifc-lite:plan-display',
      JSON.stringify({ planShowDoorLabels: false }));
    const back = loadPlanDisplay();

    assert.equal(back.planShowDoorLabels, false);
    assert.equal(back.planShowCompartments, PLAN_DISPLAY_DEFAULTS.planShowCompartments);
  });

  it('ignores a value that is not a boolean', () => {
    globalThis.localStorage.setItem('ifc-lite:plan-display',
      JSON.stringify({ planShowRoomLabels: 'ja', planShowDoorLabels: false }));
    const back = loadPlanDisplay();

    assert.equal(back.planShowRoomLabels, true);
    assert.equal(back.planShowDoorLabels, false);
  });

  it('survives rubbish, and a session with no storage', () => {
    globalThis.localStorage.setItem('ifc-lite:plan-display', '{oops');
    assert.deepEqual(loadPlanDisplay(), { ...PLAN_DISPLAY_DEFAULTS });

    delete (globalThis as { localStorage?: Storage }).localStorage;
    assert.deepEqual(loadPlanDisplay(), { ...PLAN_DISPLAY_DEFAULTS });
    savePlanDisplay({ planShowDoorLabels: false });
  });
});
