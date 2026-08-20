/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The short trade designation a product's discipline contributes to an asset
 * identifier — the `FST` in `A.01.03_FST.RM.001`.
 *
 * # Why it hangs off the PRODUCT and not off the installation
 * A device could take its trade from the system it was placed into, and that
 * would be simpler. It would also be wrong in the case that matters: a camera
 * placed while the fire-detection role happens to be active is still a camera,
 * and an identifier that called it fire-detection equipment would be a
 * statement about the plan rather than about the thing.
 *
 * # Why the table is short
 * Only the trade actually in use is filled in. The rest are deliberately
 * absent rather than guessed: an identifier is quoted in submissions, on
 * labels and over the phone, and a code somebody invented is worse than a
 * segment that is visibly missing. The rule omits the segment where no code
 * exists, so a security device gets a shorter identifier and nobody gets a
 * wrong one.
 */

import type { CatalogEntry } from './types.js';

/** The pset the code travels in, on the product's IfcTypeProduct. */
export const TRADE_PSET = 'Pset_ProductTrade';
/** The property name inside it. */
export const TRADE_PROPERTY = 'TradeCode';

const CODES: Partial<Record<CatalogEntry['discipline'], string>> = {
  fire: 'FST',
  security: 'SEC',
  automation: 'AUT',
  // `intrusion` and `other` are still open. Intrusion detection sits under
  // security in practice, so `SEC` is the obvious guess — and a guess is
  // exactly what must not go into an identifier that gets quoted in a
  // submission. Left absent until somebody says.
};

/** The trade code for a discipline, or `null` where none is established. */
export function tradeCodeFor(discipline: CatalogEntry['discipline']): string | null {
  return CODES[discipline] ?? null;
}
