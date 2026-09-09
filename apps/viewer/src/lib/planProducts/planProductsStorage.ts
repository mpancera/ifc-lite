/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Remembering products, and remembering how each one is turned.
 *
 * Two kinds of thing with two different lifetimes, which is why this file
 * writes to two different places:
 *
 * - **A product definition is a template.** "Plan Entrauchung, these zones,
 *   this symbol set" is worth having in every project, exactly like the saved
 *   lists and lenses that `scopedStorage` documents as deliberately global.
 *   Scoping these to a project would make somebody's own drawing definitions
 *   vanish when they open the next building.
 *
 * Getting that split wrong in either direction produces a bug nobody reports,
 * because both failures look like a setting somebody else changed.
 */

import type { ProjectKey } from '@ifc-lite/project';
import { readScoped, writeScoped, clearScoped } from '@/lib/project/scopedStorage';
import type { PlanProduct } from './planProducts.js';
import { BUILT_IN_PRODUCTS } from './planProducts.js';
import { isPlacementValid, type ProductSheet } from './productSheet.js';

/** Custom product definitions. Global — see the module note. */
const PRODUCTS_KEY = 'ifc-lite:plan-products';
/** Which product the plan is currently drawn as. Project-scoped. */
const ACTIVE_KEY = 'ifc-lite:plan-product-active';

function storage(): Storage | null {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

/**
 * Read custom products, skipping anything unusable.
 *
 * Skipping rather than failing, for the reason `parseClassCatalog` gives: one
 * product hand-edited into nonsense should cost that product, not every other
 * one somebody defined. A product that cannot say what it draws is the one
 * thing rejected outright — it would render an empty sheet and look like a
 * broken model rather than a broken setting.
 */
export function parseProducts(payload: unknown): PlanProduct[] {
  if (!Array.isArray(payload)) return [];

  const products: PlanProduct[] = [];
  for (const item of payload) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) continue;
    // A built-in's id is reserved. Letting a stored product take it would
    // shadow the shipped drawing with no way back to it.
    if (BUILT_IN_PRODUCTS.some((builtIn) => builtIn.id === id)) continue;

    const sheet = parseSheet(record.sheet);
    if (!sheet) continue;

    const classes = stringList(record.classes);
    const zoneThemes = stringList(record.zoneThemes);
    if (classes.length === 0 && zoneThemes.length === 0) continue;

    products.push({
      id,
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id,
      purpose: typeof record.purpose === 'string' ? record.purpose : '',
      // Never trusted from storage: a stored product is by definition not one
      // the viewer ships, whatever the JSON claims.
      builtIn: false,
      zoneThemes,
      // Kept as written: the EXPRESS spelling is what a reader sees in the
      // Planprodukte panel, and `productDrawsClass` folds case when matching.
      classes,
      symbolSet: typeof record.symbolSet === 'string' && record.symbolSet ? record.symbolSet : null,
      sheet,
    });
  }
  return products;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** A stored sheet, or `null` when it could not produce a drawable page. */
function parseSheet(value: unknown): ProductSheet | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const rawViews = Array.isArray(record.views) ? record.views : [];

  const views = [];
  for (const item of rawViews) {
    if (typeof item !== 'object' || item === null) continue;
    const view = item as Record<string, unknown>;

    const id = typeof view.id === 'string' ? view.id.trim() : '';
    const scale = typeof view.scaleDenominator === 'number' ? view.scaleDenominator : NaN;
    if (!id || !Number.isFinite(scale) || scale <= 0) continue;

    const placement = view.placement as Record<string, unknown> | undefined;
    if (typeof placement !== 'object' || placement === null) continue;
    const parsedPlacement = {
      x: Number(placement.x),
      y: Number(placement.y),
      width: Number(placement.width),
      height: Number(placement.height),
    };
    if (!isPlacementValid(parsedPlacement)) continue;

    const kind = (view.content as Record<string, unknown> | undefined)?.kind;
    if (kind !== 'storey' && kind !== 'site') continue;

    views.push({
      id,
      title: typeof view.title === 'string' ? view.title : id,
      scaleDenominator: scale,
      rotation: typeof view.rotation === 'number' && Number.isFinite(view.rotation)
        ? view.rotation
        : null,
      content: { kind } as const,
      placement: parsedPlacement,
    });
  }

  if (views.length === 0) return null;
  return {
    paperId: typeof record.paperId === 'string' && record.paperId
      ? record.paperId
      : 'A3_LANDSCAPE',
    views,
  };
}

/** Every product available: the shipped ones first, then whatever was saved. */
export function loadProducts(): PlanProduct[] {
  const store = storage();
  if (store === null) return [...BUILT_IN_PRODUCTS];

  const raw = store.getItem(PRODUCTS_KEY);
  if (raw === null) return [...BUILT_IN_PRODUCTS];

  try {
    return [...BUILT_IN_PRODUCTS, ...parseProducts(JSON.parse(raw))];
  } catch (error) {
    console.warn(`[plan] ignoring malformed products in ${PRODUCTS_KEY}`, error);
    return [...BUILT_IN_PRODUCTS];
  }
}

/**
 * Save the custom products.
 *
 * Built-ins are filtered out rather than trusted to be absent: they come back
 * from code on every load, and storing a copy would freeze today's definition
 * into a file that outlives the next correction to it.
 */
export function saveProducts(products: readonly PlanProduct[]): void {
  const store = storage();
  if (store === null) return;

  const custom = products.filter((product) => !product.builtIn);
  if (custom.length === 0) {
    store.removeItem(PRODUCTS_KEY);
    return;
  }
  store.setItem(PRODUCTS_KEY, JSON.stringify(custom));
}

/** Which product this project was last drawn as, if any. */
export function loadActiveProductId(project: ProjectKey | null): string | null {
  const raw = readScoped(ACTIVE_KEY, project);
  return raw !== null && raw.trim().length > 0 ? raw.trim() : null;
}

/** Remember the active product, or forget it when there is none. */
export function saveActiveProductId(project: ProjectKey | null, productId: string | null): void {
  if (productId === null || productId.trim().length === 0) {
    clearScoped(ACTIVE_KEY, project);
    return;
  }
  writeScoped(ACTIVE_KEY, project, productId.trim());
}

