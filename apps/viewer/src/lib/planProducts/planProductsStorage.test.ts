/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectKey } from '@ifc-lite/project';
import {
  parseProducts, loadProducts, saveProducts,
  loadProductRotations, saveProductRotation,
  loadActiveProductId, saveActiveProductId, withProjectRotation,
} from './planProductsStorage.js';
import {
  BUILT_IN_PRODUCTS, BRANDSCHUTZKONZEPT_ID, FEUERWEHRLAGEPLAN_ID, copyProduct,
} from './planProducts.js';

/** A localStorage good enough for the two things this module does with one. */
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

const sheet = {
  paperId: 'A3_LANDSCAPE',
  views: [{
    id: 'v1', title: 'Grundriss', scaleDenominator: 100, rotation: null,
    content: { kind: 'storey' as const },
    placement: { x: 0, y: 0, width: 1, height: 1 },
  }],
};

describe('parseProducts', () => {
  it('refuses to let stored JSON shadow a shipped product', () => {
    // The trap this guards: a saved product taking a built-in's id would hide
    // the shipped drawing with no way back to it.
    const products = parseProducts([
      { id: BRANDSCHUTZKONZEPT_ID, name: 'Untergeschoben', classes: ['ifcwall'], sheet },
    ]);
    assert.deepEqual(products, []);
  });

  it('never trusts builtIn from storage', () => {
    const products = parseProducts([
      { id: 'meins', name: 'Meins', builtIn: true, classes: ['ifcwall'], sheet },
    ]);
    assert.equal(products.length, 1);
    assert.equal(products[0].builtIn, false);
  });

  it('drops one broken product without losing the others', () => {
    // A catalogue is a living document; one bad entry should cost that entry.
    const products = parseProducts([
      { id: 'gut', name: 'Gut', classes: ['ifcwall'], sheet },
      { id: '', name: 'Kein Id', classes: ['ifcwall'], sheet },
      { id: 'ohne-blatt', name: 'Ohne Blatt', classes: ['ifcwall'] },
      { id: 'auch-gut', name: 'Auch gut', zoneThemes: ['fire-compartment'], sheet },
    ]);
    assert.deepEqual(products.map((p) => p.id), ['gut', 'auch-gut']);
  });

  it('rejects a product that draws nothing at all', () => {
    // It would render an empty sheet and read as a broken model rather than a
    // broken setting.
    assert.deepEqual(parseProducts([{ id: 'leer', name: 'Leer', sheet }]), []);
  });

  it('lower-cases class names so lookup can find them', () => {
    const products = parseProducts([
      { id: 'meins', name: 'Meins', classes: ['IfcWall', 'IFCDOOR'], sheet },
    ]);
    assert.deepEqual(products[0].classes, ['ifcwall', 'ifcdoor']);
  });

  it('drops a view placed off the page', () => {
    const products = parseProducts([{
      id: 'daneben', name: 'Daneben', classes: ['ifcwall'],
      sheet: {
        paperId: 'A3_LANDSCAPE',
        views: [{
          id: 'v1', title: 'X', scaleDenominator: 100,
          content: { kind: 'storey' },
          placement: { x: 0.8, y: 0, width: 0.5, height: 1 },
        }],
      },
    }]);
    // The sheet lost its only view, so the product cannot draw a page.
    assert.deepEqual(products, []);
  });

  it('survives being handed something that is not a list', () => {
    assert.deepEqual(parseProducts(null), []);
    assert.deepEqual(parseProducts({ products: [] }), []);
    assert.deepEqual(parseProducts('[]'), []);
  });
});

describe('loadProducts / saveProducts', () => {
  it('always offers the shipped products, even with nothing saved', () => {
    assert.deepEqual(
      loadProducts().map((p) => p.id),
      BUILT_IN_PRODUCTS.map((p) => p.id),
    );
  });

  it('round-trips a custom product', () => {
    const mine = copyProduct(BUILT_IN_PRODUCTS[1], 'meins', 'Mein Lageplan');
    saveProducts([...BUILT_IN_PRODUCTS, mine]);

    const loaded = loadProducts();
    assert.equal(loaded.length, BUILT_IN_PRODUCTS.length + 1);
    assert.equal(loaded.at(-1)?.id, 'meins');
    assert.equal(loaded.at(-1)?.builtIn, false);
  });

  it('does not store the built-ins, so a later correction to them lands', () => {
    // Freezing today's shipped definition into storage would outlive the next
    // fix to it, and nobody would know why their drawing stayed wrong.
    saveProducts(BUILT_IN_PRODUCTS);
    assert.equal(globalThis.localStorage.getItem('ifc-lite:plan-products'), null);
  });

  it('falls back to the shipped products when storage holds nonsense', () => {
    globalThis.localStorage.setItem('ifc-lite:plan-products', '{not json');
    assert.deepEqual(
      loadProducts().map((p) => p.id),
      BUILT_IN_PRODUCTS.map((p) => p.id),
    );
  });
});

describe('product rotations', () => {
  it('keeps one project’s approach direction out of the next project', () => {
    // The failure this prevents is worse than a missing value: the next
    // building would open turned to a neighbour's driveway, looking deliberate.
    saveProductRotation(PROJECT_A, FEUERWEHRLAGEPLAN_ID, 1.2);

    assert.equal(loadProductRotations(PROJECT_A)[FEUERWEHRLAGEPLAN_ID], 1.2);
    assert.equal(loadProductRotations(PROJECT_B)[FEUERWEHRLAGEPLAN_ID], undefined);
  });

  it('lets two products in ONE project hold different angles', () => {
    // The whole reason the rotation moved off the project: north for the
    // concept plan, approach direction for the Lageplan, at the same time.
    saveProductRotation(PROJECT_A, FEUERWEHRLAGEPLAN_ID, 1.2);
    saveProductRotation(PROJECT_A, BRANDSCHUTZKONZEPT_ID, 0.3);

    const rotations = loadProductRotations(PROJECT_A);
    assert.equal(rotations[FEUERWEHRLAGEPLAN_ID], 1.2);
    assert.equal(rotations[BRANDSCHUTZKONZEPT_ID], 0.3);
  });

  it('stores a straightened product as absent, not as zero', () => {
    saveProductRotation(PROJECT_A, FEUERWEHRLAGEPLAN_ID, 1.2);
    saveProductRotation(PROJECT_A, FEUERWEHRLAGEPLAN_ID, 0);

    assert.equal(FEUERWEHRLAGEPLAN_ID in loadProductRotations(PROJECT_A), false);
  });

  it('clearing the last rotation leaves nothing behind', () => {
    saveProductRotation(PROJECT_A, FEUERWEHRLAGEPLAN_ID, 1.2);
    saveProductRotation(PROJECT_A, FEUERWEHRLAGEPLAN_ID, null);

    assert.deepEqual(loadProductRotations(PROJECT_A), {});
  });

  it('ignores a NaN angle rather than blanking the drawing', () => {
    globalThis.localStorage.setItem(
      'ifc-lite:plan-product-rotations:projekt-a',
      JSON.stringify({ [FEUERWEHRLAGEPLAN_ID]: 'schräg', [BRANDSCHUTZKONZEPT_ID]: 0.4 }),
    );
    const rotations = loadProductRotations(PROJECT_A);
    assert.equal(rotations[FEUERWEHRLAGEPLAN_ID], undefined);
    assert.equal(rotations[BRANDSCHUTZKONZEPT_ID], 0.4);
  });

  it('writes nothing at all without a project', () => {
    // Following scopedStorage: there is no "unassigned" bucket, because a
    // shared bucket is exactly how one project's data leaks into another.
    saveProductRotation(null, FEUERWEHRLAGEPLAN_ID, 1.2);
    assert.deepEqual(loadProductRotations(null), {});
  });
});

describe('the active product', () => {
  it('is remembered per project', () => {
    saveActiveProductId(PROJECT_A, FEUERWEHRLAGEPLAN_ID);
    assert.equal(loadActiveProductId(PROJECT_A), FEUERWEHRLAGEPLAN_ID);
    assert.equal(loadActiveProductId(PROJECT_B), null);
  });

  it('can be cleared', () => {
    saveActiveProductId(PROJECT_A, FEUERWEHRLAGEPLAN_ID);
    saveActiveProductId(PROJECT_A, null);
    assert.equal(loadActiveProductId(PROJECT_A), null);
  });
});

describe('withProjectRotation', () => {
  it('folds this building’s angle onto the template', () => {
    const lageplan = BUILT_IN_PRODUCTS.find((p) => p.id === FEUERWEHRLAGEPLAN_ID)!;
    assert.equal(lageplan.rotation, null);

    const turned = withProjectRotation(lageplan, { [FEUERWEHRLAGEPLAN_ID]: 1.2 });
    assert.equal(turned.rotation, 1.2);
    // The template itself is untouched — it is shared across projects.
    assert.equal(lageplan.rotation, null);
  });

  it('leaves a product alone when this project never turned it', () => {
    const lageplan = BUILT_IN_PRODUCTS.find((p) => p.id === FEUERWEHRLAGEPLAN_ID)!;
    assert.equal(withProjectRotation(lageplan, {}).rotation, null);
  });
});
