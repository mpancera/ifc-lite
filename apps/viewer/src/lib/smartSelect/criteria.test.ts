/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectSmartSelection, DEEP_CRITERIA, SMART_CRITERIA, type Fact, type SmartCriterion,
} from './criteria.js';

/** Four columns and a wall across two storeys, as a fact table. */
const MODEL: Record<number, Partial<Record<SmartCriterion, Fact>>> = {
  1: { class: 'IfcColumn', storey: 10, type: 900, predefinedType: 'COLUMN', material: 'Beton' },
  2: { class: 'IfcColumn', storey: 10, type: 900, predefinedType: 'COLUMN', material: 'Beton' },
  3: { class: 'IfcColumn', storey: 20, type: 900, predefinedType: 'COLUMN', material: 'Beton' },
  4: { class: 'IfcColumn', storey: 10, type: 901, predefinedType: 'COLUMN', material: 'Stahl' },
  5: { class: 'IfcWall', storey: 10, type: 902, predefinedType: 'PARTITIONING', material: 'Beton' },
  // No storey at all, and no material association.
  6: { class: 'IfcColumn', storey: null, type: 900, predefinedType: 'COLUMN', material: null },
};

function sources(counter?: { deep: number }) {
  return {
    candidates: Object.keys(MODEL).map(Number),
    fact: (id: number, c: SmartCriterion): Fact => {
      if (counter && DEEP_CRITERIA.has(c)) counter.deep++;
      return MODEL[id]?.[c] ?? null;
    },
  };
}

describe('collectSmartSelection', () => {
  it('answers the case the context menu got wrong: same class AND same storey', () => {
    const { ids } = collectSmartSelection(1, ['class', 'storey'], sources());
    assert.deepEqual(ids.sort((a, b) => a - b), [1, 2, 4],
      'the column one floor up is not the same column');
  });

  it('takes class alone across the whole building when that is what was asked', () => {
    const { ids } = collectSmartSelection(1, ['class'], sources());
    assert.deepEqual(ids.sort((a, b) => a - b), [1, 2, 3, 4, 6]);
  });

  it('treats "has none" as a value, so unfiled elements can be found as a group', () => {
    const { ids } = collectSmartSelection(6, ['class', 'storey'], sources());
    assert.deepEqual(ids, [6], 'nothing else is missing a storey');
  });

  it('narrows further with every criterion, never wider', () => {
    const one = collectSmartSelection(1, ['class'], sources()).ids.length;
    const two = collectSmartSelection(1, ['class', 'storey'], sources()).ids.length;
    const three = collectSmartSelection(1, ['class', 'storey', 'type'], sources()).ids.length;
    assert.ok(one >= two && two >= three, `${one} ≥ ${two} ≥ ${three}`);
    assert.equal(three, 2, 'the steel column is another type');
  });

  it('reads the expensive criteria only for what the cheap ones let through', () => {
    const counter = { deep: 0 };
    const { ids, deepReads } = collectSmartSelection(1, ['class', 'storey', 'material'], sources(counter));
    assert.deepEqual(ids.sort((a, b) => a - b), [1, 2]);
    // Three survivors of the cheap pass (1, 2, 4) — not all six candidates.
    assert.equal(deepReads, 3);
    assert.equal(counter.deep, 3);
  });

  it('never reads an expensive criterion that is switched off', () => {
    const counter = { deep: 0 };
    collectSmartSelection(1, ['class', 'storey', 'type'], sources(counter));
    assert.equal(counter.deep, 0);
  });

  it('with no criterion returns the seed alone rather than the whole model', () => {
    const { ids, scanned } = collectSmartSelection(1, [], sources());
    assert.deepEqual(ids, [1]);
    assert.equal(scanned, 0, 'and does not walk the model to say so');
  });

  it('ignores a criterion listed twice instead of paying for it twice', () => {
    const counter = { deep: 0 };
    collectSmartSelection(1, ['material', 'material'], sources(counter));
    assert.equal(counter.deep, 6, '1 seed + the 5 other candidates, each read once');
  });

  it('keeps the seed first, so the caller can make it the primary selection', () => {
    assert.equal(collectSmartSelection(3, ['class'], sources()).ids[0], 3);
  });

  it('offers every catalogue entry as a usable criterion', () => {
    for (const def of SMART_CRITERIA) {
      const { ids } = collectSmartSelection(1, [def.id], sources());
      assert.ok(ids.includes(1), `${def.id} lost its own seed`);
    }
  });
});
