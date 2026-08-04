/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Connects counter allocation to a live model.
 *
 * Peers are the elements the number counts against, and they are read from the
 * authoring overlay: a counter numbers what THIS discipline placed, not what
 * the architect happened to model. Their stored numbers come from a property,
 * so a number outlives the session, the export and a reload — the alternative,
 * parsing it back out of the assembled identifier, breaks the moment a room
 * name contains the separator.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import { allocateCounter, scopeKeyOf } from './counter';
import { COUNTER_STORE_PROPERTY, type CounterSource, type ValueResolver } from './types';
import type { CounterPeer } from './counter';

export interface ModelCounterArgs {
  view: MutablePropertyView;
  resolve: ValueResolver;
  /** Pset the number is stored in — the rule's own target. */
  pset: string;
  /** Classes the rule applies to; only these are peers. */
  applicability: readonly string[];
  /** Persists a freshly allocated number. Omit for a read-only preview. */
  store?: (expressId: number, value: number) => void;
}

/** The number stored on an element, or `null` when it has none yet. */
export function readStoredCounter(
  view: MutablePropertyView,
  expressId: number,
  pset: string,
): number | null {
  for (const set of view.getForEntity(expressId)) {
    if (set.name !== pset) continue;
    for (const property of set.properties) {
      if (property.name !== COUNTER_STORE_PROPERTY) continue;
      const parsed = Number(String(property.value).trim());
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
  }
  return null;
}

export function makeModelCounterResolver(args: ModelCounterArgs) {
  const { view, resolve, pset, applicability, store } = args;
  const applies = new Set(applicability.map((entry) => entry.toLowerCase()));

  return (source: CounterSource, expressId: number): string => {
    const keyFor = (id: number) => scopeKeyOf(
      source.scopedBy.map((scope) => resolve({ scope, field: fieldForScope(scope) }, id)),
    );

    const peers: CounterPeer[] = [];
    for (const entity of view.getNewEntities()) {
      if (!applies.has(entity.type.toLowerCase())) continue;
      peers.push({
        expressId: entity.expressId,
        scopeKey: keyFor(entity.expressId),
        assigned: readStoredCounter(view, entity.expressId, pset),
      });
    }

    const allocation = allocateCounter({ source, expressId, scopeKey: keyFor(expressId), peers });
    if (allocation.allocated) store?.(expressId, allocation.value);
    return allocation.text;
  };
}

/**
 * The field that identifies a scope.
 *
 * `Name` for spatial containers (for a room that is its NUMBER by convention),
 * `Tag` for the product type — the catalogue id, which is what makes two
 * detectors "the same product" rather than merely the same IFC class.
 */
function fieldForScope(scope: CounterSource['scopedBy'][number]): string {
  return scope === 'IfcEntityType' ? 'Tag' : 'Name';
}
