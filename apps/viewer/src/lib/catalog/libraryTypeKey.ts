/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The identity of a library entry, as it is written into the model.
 *
 * # Why one function, and why it is borrowed from the AAS
 * Placing a library entry writes an `IfcXxxType` for the product and an
 * occurrence for the device. The type is the thing worth sharing — one per
 * product, however many devices — so something has to say when two placements
 * mean the SAME product. That something is this key.
 *
 * The AAS metamodel already answers exactly this question and splits it the
 * way we need (Marc, 2026-09-17): `AssetKind` is either `Type` or `Instance`,
 * the asset carries a `globalAssetId`, and the individual device carries
 * `specificAssetIds` — its serial number, its plant designation. This key is
 * the TYPE half. See `lib/aas/connectorPset.ts`, which writes the same split
 * into the model as `AASType`.
 *
 * ## The instance half must never get in here
 * A serial number in this key would give every single device its own type and
 * its own copy of the geometry — the very thing the key exists to prevent. An
 * instance identity belongs on the occurrence, which is where the instance AAS
 * link is written too.
 *
 * # Why a URI and not the bare id
 * Two libraries can meet in one model: a company catalogue and the Swiss Data
 * Dictionary's examples today, a second company's catalogue tomorrow. A bare
 * `fire.smoke-detector` says nothing about whose detector it is, so two
 * catalogues that happened to pick the same id would collapse into one type.
 * Every branch below therefore yields something namespaced.
 *
 * The last branch is a `urn:` built from the entry, because an entry with no
 * AAS and no published file HAS no global identity — pretending otherwise by
 * inventing a http URL would read as a dereferenceable address and not be one.
 * The moment such an entry gains a `globalAssetId`, the first branch takes
 * over and nothing else here changes.
 */

import type { CatalogEntry } from './types.js';

/** Our namespace for an entry that brings no identity of its own. */
const LOCAL_URN_PREFIX = 'urn:ifclite:catalog';

function trimmed(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/**
 * What a placed entry's `IfcElementType.ElementType` carries, and what a
 * second placement matches on to find the type again.
 *
 * Deterministic and side-effect free: the same entry always yields the same
 * key, in this session and the next.
 */
export function libraryTypeKey(entry: CatalogEntry): string {
  // 1. The AAS's own answer, when the entry has been given one.
  const globalAssetId = trimmed(entry.globalAssetId);
  if (globalAssetId) return globalAssetId;

  // 2. The type AAS it belongs to. An AAS address is an identifier that often
  //    looks like a URL without being a reachable endpoint — which is exactly
  //    what we want from a key. See `CatalogAasLink.address`.
  const aasAddress = trimmed(entry.aas?.address);
  if (aasAddress) return aasAddress;

  // 3. An Elementbeispiel: the dictionary publishes no globalAssetId yet, so
  //    the published file's address stands in. The extension is dropped —
  //    `.ifc` names a file format, and the identity is of the element, not of
  //    one encoding of it. Replaced by branch 1 as soon as the dictionary
  //    publishes an identifier, with no change here.
  const exampleUrl = trimmed(entry.exampleUrl);
  if (exampleUrl) return exampleUrl.replace(/\.ifc$/i, '');

  // 4. A catalogue entry that carries no identity beyond this app. Namespaced
  //    by where it came from, so two catalogues' ids cannot collide.
  return `${LOCAL_URN_PREFIX}:${entry.provenance.source}:${entry.id}`;
}
