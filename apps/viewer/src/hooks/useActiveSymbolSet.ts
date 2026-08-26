/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which symbol set the drawing on screen is using.
 *
 * The symbol catalogue has always carried a `products` field saying which
 * drawings a symbol belongs on, and every lookup passed `null` for it — so
 * every plan drew every symbol. That was invisible while the catalogue held
 * one source: a symbol listed for the Feuerwehrlageplan looked fine on a
 * concept plan too.
 *
 * It stopped being invisible with a second source. The authorities and the
 * installers' association both prescribe a drawing for a smoke detector, and
 * which is correct depends on the document. Without the product, the lookup
 * has no way to tell them apart and would put association symbols on an
 * authority plan.
 *
 * `null` means "no product chosen", and the catalogue reads that as "every
 * symbol applies" — the behaviour from before products existed, which is what
 * a viewer with no plan product open should still do.
 */

import { useViewerStore } from '@/store';
import { findProduct } from '@/lib/planProducts/planProducts';

export function useActiveSymbolSet(): string | null {
  const products = useViewerStore((s) => s.planProducts);
  const activeId = useViewerStore((s) => s.activePlanProductId);
  // The set, not the product id: a copied product keeps the symbol set of the
  // one it was copied from, which is the whole point of copying it.
  return findProduct(products, activeId)?.symbolSet ?? null;
}
