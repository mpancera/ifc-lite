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
 * - **A product's rotation belongs to ONE building.** The approach direction
 *   of a Feuerwehrlageplan is a fact about this plot and means nothing on the
 *   next one. Kept global it would be worse than absent: the next project
 *   would open turned to a neighbour's driveway, which looks deliberate.
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
/** Per-product rotation, in radians. Project-scoped. */
const ROTATIONS_KEY = 'ifc-lite:plan-product-rotations';
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
      rotation: null,
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

/**
 * The rotation each product is turned to in THIS project, in radians.
 *
 * A product with no entry is not turned — which is different from being turned
 * to zero, and is why the caller gets a map with the product missing rather
 * than a map full of zeroes.
 */
export function loadProductRotations(project: ProjectKey | null): Record<string, number> {
  const raw = readScoped(ROTATIONS_KEY, project);
  if (raw === null) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};

    const rotations: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      // A NaN angle turns every coordinate in the drawing into NaN and the
      // page comes up blank with nothing saying why — the same trap
      // `loadPlanRotation` guards.
      if (typeof value === 'number' && Number.isFinite(value)) rotations[id] = value;
    }
    return rotations;
  } catch (error) {
    console.warn(`[plan] ignoring malformed product rotations in ${ROTATIONS_KEY}`, error);
    return {};
  }
}

/**
 * Turn one product, or straighten it again.
 *
 * Zero is stored as absence, following `savePlanRotation`: a product that was
 * straightened should read like one that was never turned, rather than
 * leaving behind a row that says nothing.
 */
export function saveProductRotation(
  project: ProjectKey | null,
  productId: string,
  radians: number | null,
): void {
  const rotations = loadProductRotations(project);

  if (radians === null || !Number.isFinite(radians) || radians === 0) {
    delete rotations[productId];
  } else {
    rotations[productId] = radians;
  }

  if (Object.keys(rotations).length === 0) {
    clearScoped(ROTATIONS_KEY, project);
    return;
  }
  writeScoped(ROTATIONS_KEY, project, JSON.stringify(rotations));
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

/**
 * A product with this project's rotation folded in.
 *
 * The definition is a template and carries no angle; the angle is a fact about
 * the building. Callers want the two together, and doing it here means no
 * caller can forget to.
 */
export function withProjectRotation(
  product: PlanProduct,
  rotations: Record<string, number>,
): PlanProduct {
  const rotation = rotations[product.id];
  if (typeof rotation !== 'number' || !Number.isFinite(rotation)) return product;
  return { ...product, rotation };
}
