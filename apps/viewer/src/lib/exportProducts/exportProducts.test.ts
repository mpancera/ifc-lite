/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectKey } from '@ifc-lite/project';
import {
  batchProducts, productFilename, productBlocker, isFormatValid, defaultFormat,
  newPlan2DProduct, FORMATS_BY_KIND,
  type ExportProduct,
} from './exportProducts.js';
import {
  parseExportProducts, loadExportProducts, saveExportProducts, nextProductId,
} from './exportProductsStorage.js';
import { BUILT_IN_PRODUCTS } from '@/lib/planProducts/planProducts';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

const PROJECT_A = 'projekt-a' as ProjectKey;
const PROJECT_B = 'projekt-b' as ProjectKey;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
});

const plan = (over: Partial<ExportProduct> = {}): ExportProduct => ({
  kind: 'plan2d', id: 'p1', name: 'Plan Brandschutzkonzept',
  inBatch: true, format: 'pdf',
  planProductId: BUILT_IN_PRODUCTS[0].id, storeyId: null,
  ...over,
} as ExportProduct);

describe('formats', () => {
  it('keeps a drawing off the tabular formats', () => {
    // CSV of a drawing is meaningless, and offering it invites an empty file.
    assert.ok(isFormatValid('plan2d', 'pdf'));
    assert.ok(isFormatValid('plan2d', 'dxf'));
    assert.ok(!isFormatValid('plan2d', 'csv'));
    assert.ok(!isFormatValid('list', 'pdf'));
  });

  it('gives every kind a usable starting format', () => {
    for (const kind of ['plan2d', 'list', 'graph'] as const) {
      assert.ok(isFormatValid(kind, defaultFormat(kind)));
      assert.ok(FORMATS_BY_KIND[kind].length > 0);
    }
  });
});

describe('batchProducts', () => {
  it('takes only what is ticked, in the author’s own order', () => {
    // Somebody who arranged deliverables in submission order should get that
    // order in the folder.
    const products = [
      plan({ id: 'a', inBatch: true }),
      plan({ id: 'b', inBatch: false }),
      plan({ id: 'c', inBatch: true }),
    ];
    assert.deepEqual(batchProducts(products).map((p) => p.id), ['a', 'c']);
  });
});

describe('productFilename', () => {
  it('names the file after the drawing, not after a counter', () => {
    // Hyphenated rather than run together: a folder of deliverables is read by
    // a person, and `planbrandschutzkonzept` is not a word anybody scans.
    assert.equal(productFilename(plan({ name: 'Plan Brandschutzkonzept' })),
      'plan-brandschutzkonzept');
  });

  it('strips what a filesystem would choke on', () => {
    // A slash would silently create a folder; the rest Windows forbids.
    const name = productFilename(plan({ name: 'EG / OG: "Flucht" *1' }));
    assert.ok(!/[<>:"/\\|?*]/.test(name), name);
  });

  it('falls back to the id rather than producing an empty filename', () => {
    assert.equal(productFilename(plan({ id: 'p9', name: '   ' })), 'p9');
    assert.equal(productFilename(plan({ id: 'p9', name: '///' })), 'p9');
  });
});

describe('productBlocker', () => {
  it('passes a drawing whose plan product still exists', () => {
    assert.equal(productBlocker(plan(), BUILT_IN_PRODUCTS), null);
  });

  it('catches a drawing pointing at a deleted plan product', () => {
    // Caught before the batch starts: a run that stops on the fifth file
    // leaves a half-finished submission nobody can tell apart from a whole one.
    const blocker = productBlocker(plan({ planProductId: 'weg' }), BUILT_IN_PRODUCTS);
    assert.match(String(blocker), /gibt es nicht mehr/);
  });

  it('says plainly that the unbuilt kinds are unbuilt', () => {
    // Better than writing an empty file that looks like a successful export.
    const list = { kind: 'list', id: 'l', name: 'L', inBatch: true, format: 'csv', listId: 'x' } as ExportProduct;
    assert.match(String(productBlocker(list, BUILT_IN_PRODUCTS)), /noch nicht gebaut/);
  });
});

describe('parseExportProducts', () => {
  it('drops a product whose kind nobody knows', () => {
    assert.deepEqual(parseExportProducts([{ id: 'x', kind: 'hologramm', name: 'X' }]), []);
  });

  it('drops a duplicate id instead of editing two rows at once', () => {
    const parsed = parseExportProducts([
      { id: 'p1', kind: 'plan2d', name: 'Erst', planProductId: 'a' },
      { id: 'p1', kind: 'plan2d', name: 'Zweit', planProductId: 'b' },
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, 'Erst');
  });

  it('repairs a format that does not fit its kind', () => {
    // The product is still meaningful; only its output setting was wrong.
    const parsed = parseExportProducts([
      { id: 'p1', kind: 'plan2d', name: 'P', planProductId: 'a', format: 'csv' },
    ]);
    assert.equal(parsed[0].format, 'pdf');
  });

  it('drops a drawing that names no plan product', () => {
    assert.deepEqual(parseExportProducts([{ id: 'p1', kind: 'plan2d', name: 'P' }]), []);
  });

  it('treats a missing inBatch as ticked', () => {
    const parsed = parseExportProducts([
      { id: 'p1', kind: 'plan2d', name: 'P', planProductId: 'a' },
    ]);
    assert.equal(parsed[0].inBatch, true);
  });

  it('survives something that is not a list at all', () => {
    assert.deepEqual(parseExportProducts(null), []);
    assert.deepEqual(parseExportProducts({ products: [] }), []);
  });
});

describe('storage', () => {
  it('keeps one project’s delivery list out of the next', () => {
    // Carried across, it would offer the last building's storeys for this
    // one's submission.
    saveExportProducts(PROJECT_A, [plan()]);
    assert.equal(loadExportProducts(PROJECT_A).length, 1);
    assert.deepEqual(loadExportProducts(PROJECT_B), []);
  });

  it('round-trips a product', () => {
    saveExportProducts(PROJECT_A, [plan({ storeyId: 42, format: 'dxf' })]);
    const [loaded] = loadExportProducts(PROJECT_A);
    assert.equal(loaded.kind, 'plan2d');
    assert.equal(loaded.format, 'dxf');
    assert.equal(loaded.kind === 'plan2d' ? loaded.storeyId : null, 42);
  });

  it('clearing the last product leaves nothing behind', () => {
    saveExportProducts(PROJECT_A, [plan()]);
    saveExportProducts(PROJECT_A, []);
    assert.deepEqual(loadExportProducts(PROJECT_A), []);
  });

  it('falls back to empty when storage holds nonsense', () => {
    globalThis.localStorage.setItem('ifc-lite:export-products:projekt-a', '{not json');
    assert.deepEqual(loadExportProducts(PROJECT_A), []);
  });
});

describe('nextProductId', () => {
  it('avoids ids already taken', () => {
    const products = [plan({ id: 'plan-1' }), plan({ id: 'plan-2' })];
    assert.equal(nextProductId(products, 'plan'), 'plan-3');
  });

  it('starts at one for an empty list', () => {
    assert.equal(nextProductId([], 'plan'), 'plan-1');
  });
});

describe('newPlan2DProduct', () => {
  it('starts from the plan product’s own name and joins the batch', () => {
    const created = newPlan2DProduct(BUILT_IN_PRODUCTS[1], 'plan-1');
    assert.equal(created.name, BUILT_IN_PRODUCTS[1].name);
    assert.equal(created.planProductId, BUILT_IN_PRODUCTS[1].id);
    assert.equal(created.inBatch, true);
    assert.equal(created.format, 'pdf');
  });
});
