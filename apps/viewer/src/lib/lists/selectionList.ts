/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The selection, as a list.
 *
 * The status bar says how many objects are in hand; this is the answer to
 * WHICH. A list rather than a panel of its own: the Lists module already
 * groups, sorts, sums, exports and edits in place, and the question a user has
 * after selecting eighty things ("what did I actually catch — which storeys,
 * which classes?") is a table question (Marc, 2026-09-13).
 *
 * A frozen snapshot, not a live view. `expressIdsByModel` pins the elements at
 * the moment the list is made, which is the honest shape: a list that followed
 * the selection would empty itself the moment the user clicked a row in it.
 */

import type { ListDefinition } from '@ifc-lite/lists';

export interface SelectionRef {
  modelId: string;
  expressId: number;
}

/**
 * Columns worth having for a cart: what it is, what it is called, and where it
 * sits. The last one is the reason this exists — a selection that spans two
 * storeys looks exactly like one that does not until something shows it.
 */
const CART_COLUMNS: ListDefinition['columns'] = [
  { id: 'attr-name', source: 'attribute', propertyName: 'Name', label: 'Name' },
  { id: 'attr-class', source: 'attribute', propertyName: 'Class', label: 'Klasse' },
  { id: 'spatial-storey', source: 'spatial', propertyName: 'Storey', label: 'Geschoss' },
  { id: 'spatial-room', source: 'spatial', propertyName: 'Room', label: 'Raum' },
];

/**
 * A list definition holding exactly the selected elements, or `null` when
 * nothing is selected — there is no useful empty list to open.
 */
export function listFromSelection(
  refs: readonly SelectionRef[],
  now: number = Date.now(),
  id: string = crypto.randomUUID(),
): ListDefinition | null {
  const expressIdsByModel: Record<string, number[]> = {};
  for (const ref of refs) {
    // Keyed by model: two federated files can hand out the same express id,
    // and a flat list of ids would select both.
    const ids = (expressIdsByModel[ref.modelId] ??= []);
    if (!ids.includes(ref.expressId)) ids.push(ref.expressId);
  }
  const total = Object.values(expressIdsByModel).reduce((n, ids) => n + ids.length, 0);
  if (total === 0) return null;

  return {
    id,
    name: `Auswahl (${total})`,
    description: 'Momentaufnahme der Auswahl',
    createdAt: now,
    updatedAt: now,
    entityTypes: [],
    expressIdsByModel,
    conditions: [],
    columns: CART_COLUMNS,
  };
}
