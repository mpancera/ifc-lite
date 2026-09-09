/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which drawing the plan is currently being drawn AS.
 *
 * See `lib/planProducts/planProducts.ts` for what a product is and why it is
 * not a set of visibility toggles. This slice is deliberately thin: it holds
 * the active product, and every rule about what a product may contain lives in
 * the library, where it is testable without a store.
 *
 * # The rotation hand-off
 * `viewModeSlice.planRotation` stays the single value the canvas, the print
 * path and the DXF export read — nothing downstream learns about products.
 * What changes is where the angle is REMEMBERED: with a product active it
 * belongs to that product, without one it belongs to the project exactly as
 * before. That keeps every existing plan behaving identically while letting a
 * Feuerwehrlageplan hold an approach direction that the concept plan does not
 * inherit.
 */

import type { StateCreator } from 'zustand';
import type { ViewerState } from '../index.js';
import type { PlanProduct } from '@/lib/planProducts/planProducts';
import { BUILT_IN_PRODUCTS, findProduct, copyProduct } from '@/lib/planProducts/planProducts';
import {
  loadProducts, saveProducts,
  loadActiveProductId, saveActiveProductId,
} from '@/lib/planProducts/planProductsStorage';

export interface PlanProductsSlice {
  /** Every product available: the shipped ones, then whatever was saved. */
  planProducts: readonly PlanProduct[];
  /**
   * The active product's id, or `null` for an ordinary plan.
   *
   * `null` is a real state and the one every existing project starts in — a
   * plan that is nobody's product in particular. Defaulting to a product
   * instead would silently hide elements from people who never asked for one.
   */
  activePlanProductId: string | null;
  /**
   * Which project the products were loaded for.
   *
   * Beside the data rather than in it, following `planRotationProject`: it
   * exists to notice that the project changed.
   */
  planProductsProject: string | null;

  /** The active product, or `null`. */
  activePlanProduct: () => PlanProduct | null;
  setActivePlanProduct: (id: string | null) => void;
  /** Save a custom product, replacing one of the same id. */
  savePlanProduct: (product: PlanProduct) => void;
  /** Duplicate any product under a new id, for "copy and edit". */
  duplicatePlanProduct: (sourceId: string, id: string, name: string) => void;
  /** Delete a custom product. Built-ins are refused. */
  deletePlanProduct: (id: string) => void;
  /** Adopt the stored products, once per project. */
  restorePlanProductsForProject: () => void;
}

export const createPlanProductsSlice: StateCreator<
  ViewerState, [], [], PlanProductsSlice
> = (set, get) => ({
  planProducts: BUILT_IN_PRODUCTS,
  activePlanProductId: null,

  planProductsProject: null,

  activePlanProduct: () => {
    const product = findProduct(get().planProducts, get().activePlanProductId);
    return product;
  },

  setActivePlanProduct: (id) => {
    const product = id === null ? null : findProduct(get().planProducts, id);
    // An id nobody knows is dropped rather than stored: it would persist a
    // selection that shows an empty drawing on every later open.
    if (id !== null && product === null) return;

    set({ activePlanProductId: product?.id ?? null });
    saveActiveProductId(get().currentProjectKey(), product?.id ?? null);

    // Switching product no longer touches the angle. It used to straighten the
    // plan, because the per-product angle it read was one nothing ever wrote —
    // so turning a plan and then changing document silently undid the turn.
    // The angle belongs to the layout, with the project's as the fallback.
  },

  savePlanProduct: (product) => {
    // A built-in cannot be edited in place — that is what makes the shipped
    // drawings un-losable. `duplicatePlanProduct` is the way to change one.
    if (product.builtIn) return;
    if (BUILT_IN_PRODUCTS.some((builtIn) => builtIn.id === product.id)) return;

    const others = get().planProducts.filter((existing: PlanProduct) => existing.id !== product.id);
    const next = [...others, product];
    set({ planProducts: next });
    saveProducts(next);
  },

  duplicatePlanProduct: (sourceId, id, name) => {
    const source = findProduct(get().planProducts, sourceId);
    if (!source) return;
    if (findProduct(get().planProducts, id)) return;

    get().savePlanProduct(copyProduct(source, id, name));
  },

  deletePlanProduct: (id) => {
    const product = findProduct(get().planProducts, id);
    if (!product || product.builtIn) return;

    const next = get().planProducts.filter((existing: PlanProduct) => existing.id !== id);
    set({ planProducts: next });
    saveProducts(next);

    // A drawing that no longer exists cannot stay selected, or the plan comes
    // up blank on the next open with nothing saying why.
    if (get().activePlanProductId === id) get().setActivePlanProduct(null);
  },

  restorePlanProductsForProject: () => {
    const project = get().currentProjectKey();
    if (project === null) return;
    // Once per project, following `restorePlanRotationForProject`: re-reading
    // storage continuously would discard a selection not yet written.
    if (get().planProductsProject === project) return;

    const products = loadProducts();
    const storedId = loadActiveProductId(project);
    const active = findProduct(products, storedId);

    set({
      planProductsProject: project,
      planProducts: products,
      activePlanProductId: active?.id ?? null,
    });

  },
});
