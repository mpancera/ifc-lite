/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PropertyValueType, type PropertySet } from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';
import { confidenceBand, listHarmonizerElements, parseStatus, summarizeReview } from './reviewStatus.js';

function pset(values: Record<string, string | number | boolean>): PropertySet {
  return {
    name: 'Pset_DataHarmonizer',
    globalId: 'pset',
    properties: Object.entries(values).map(([name, value]) => ({ name, type: typeof value === 'number' ? PropertyValueType.Real : PropertyValueType.Label, value })),
  };
}

const psets = new Map<number, PropertySet[]>([
  [10, [pset({ Confidence: 0.93, Status: 'auto', ConfidenceReasons: 'closed=1.00' })]],
  [11, [pset({ Confidence: 0.6, Status: 'Bestätigt' })]],
  [12, [pset({ Confidence: 0.2, Status: 'rejected', SourceLayer: 'A-DOOR' })]],
  [13, [{ name: 'Pset_WallCommon', globalId: 'w', properties: [] }]],
]);

const dataStore = {
  entityIndex: {
    byType: new Map<string, number[]>([
      ['IFCSPACE', [10, 11]],
      ['IFCDOOR', [12]],
      ['IFCWALL', [13]],
      ['IFCPROPERTYSET', [99]],
    ]),
  },
  entities: {
    getGlobalId: (id: number) => `guid-${id}`,
    getName: (id: number) => `Name ${id}`,
    getTypeName: (id: number) => (id === 12 ? 'IFCDOOR' : 'IFCSPACE'),
  },
} as unknown as IfcDataStore;

const view = {
  getForEntity: (id: number) => psets.get(id) ?? [],
  getAttributeMutationsForEntity: (id: number) => (id === 11 ? [{ name: 'Name', value: 'Neu' }] : []),
};

describe('reviewStatus', () => {
  it('bands confidence like the harmonizer', () => {
    assert.equal(confidenceBand(0.8), 'high');
    assert.equal(confidenceBand(0.79), 'review');
    assert.equal(confidenceBand(0.49), 'low');
  });

  it('reads status spellings and treats the unknown as auto', () => {
    assert.equal(parseStatus('confirmed'), 'confirmed');
    assert.equal(parseStatus('REJECTED'), 'rejected');
    assert.equal(parseStatus('Bestätigt'), 'auto');
    assert.equal(parseStatus(undefined), 'auto');
  });

  it('lists only elements with the pset, with band, status and the edited-here hint', () => {
    const list = listHarmonizerElements(dataStore, view);
    assert.deepEqual(list.map((e) => e.expressId), [10, 11, 12]);
    const [a, b, c] = list;
    assert.equal(a.typeName, 'IfcSpace');
    assert.equal(a.globalId, 'guid-10');
    assert.equal(a.band, 'high');
    assert.equal(a.status, 'auto');
    assert.equal(a.reasons, 'closed=1.00');
    assert.equal(b.editedHere, true);
    assert.equal(b.status, 'auto');
    assert.equal(c.sourceLayer, 'A-DOOR');
    assert.equal(c.status, 'rejected');
  });

  it('summarises by status and band and counts what a block confirmation would take', () => {
    const s = summarizeReview(listHarmonizerElements(dataStore, view));
    assert.equal(s.total, 3);
    assert.deepEqual(s.byStatus, { auto: 2, confirmed: 0, corrected: 0, rejected: 1 });
    assert.deepEqual(s.byBand, { high: 1, review: 1, low: 1 });
    assert.equal(s.confirmable, 1);
  });
});
