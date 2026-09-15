/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Dropping rows whose entity has been deleted.
 *
 * A list result is a SNAPSHOT: `executeList` runs once and the rows are stored
 * as they came out. That is the right shape — re-running on every edit would
 * throw away the sort, the scroll and any half-typed cell — but it means the
 * table goes on showing entities that no longer exist. Delete a room from the
 * list and the tree hides it while the row it was deleted from stays exactly
 * where it was (Marc, 2026-09-15).
 *
 * Deletion is the one change a stale snapshot cannot survive. A renamed entity
 * showing its old name is out of date; a DELETED entity still listed is a row
 * that answers to nothing — click it and it selects an id the model no longer
 * has, and every total counts it.
 *
 * Filtered at display time rather than written back into the stored result:
 * deleting is undoable, and a row removed from the snapshot would not come
 * back with it.
 */

import type { ListRow } from '@ifc-lite/lists';
import type { MutablePropertyView } from '@ifc-lite/mutations';

/**
 * `rows` without the ones whose entity is tombstoned.
 *
 * `views` is the store's `mutationViews`; a model with no view has nothing
 * deleted. The `'default'` → `'legacy'` mapping is the same one the visibility
 * filter applies — a single-model session writes rows under `'default'` while
 * the store keys the view as `'legacy'`, and without it nothing would ever
 * match in exactly the ordinary case.
 */
export function dropDeletedRows(
  rows: ListRow[],
  views: ReadonlyMap<string, MutablePropertyView>,
): ListRow[] {
  if (views.size === 0) return rows;

  // Nothing tombstoned anywhere: return the same array so the memo downstream
  // keeps its identity and a list with no deletions costs nothing.
  let any = false;
  for (const view of views.values()) {
    if (view.getTombstones().size > 0) { any = true; break; }
  }
  if (!any) return rows;

  return rows.filter((row) => {
    const view = views.get(row.modelId === 'default' ? 'legacy' : row.modelId)
      ?? views.get(row.modelId);
    return !view?.isDeleted(row.entityId);
  });
}
