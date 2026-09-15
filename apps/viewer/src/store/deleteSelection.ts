/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deleting what is selected — all of it.
 *
 * Deletion used to be reachable only through the right-click menu, one entity
 * at a time, while the Delete key HID the selection. Both halves of that cost
 * Marc an afternoon (2026-09-16): he pressed Delete on twenty-one rooms, saw
 * them struck through in the tree, and went looking for the export button that
 * correctly never came, because nothing had been deleted.
 *
 * The key named Delete now deletes. Hiding keeps the Space bar, which promises
 * nothing and is where the muscle memory for "get that out of my way" already
 * sits.
 *
 * ## One call per entity, on purpose
 *
 * `removeEntity` pushes its own undo record, so deleting twenty-one rooms
 * takes twenty-one undos to reverse. Batching them into one step would be
 * better and belongs in the mutation slice, not here — collapsing them at this
 * level would mean reaching past the store's own history bookkeeping.
 *
 * ## Refusals are reported, not swallowed
 *
 * `removeEntity` returns false when the active discipline role does not own
 * the entity, when a collaboration session is read-only, or when the id is not
 * in the overlay at all. A selection can be a mixture, and "12 of 21 deleted"
 * is the only honest summary of that.
 */

import { useViewerStore, resolveEntityRef } from '@/store';

export interface DeleteSelectionResult {
  /** Entities actually removed. */
  deleted: number;
  /** Selected entities the store refused to remove. */
  refused: number;
  /**
   * How many of the deleted ones existed ONLY in this session.
   *
   * Deleting one of those cancels its creation outright rather than recording
   * a deletion, so the file does not change and no export appears. Counted
   * BEFORE the delete, because afterwards a forgotten creation and a tombstone
   * are indistinguishable — and reported, because an export button that does
   * not appear is otherwise indistinguishable from a broken one.
   */
  sessionOnly: number;
}

/**
 * Delete every selected entity.
 *
 * Returns what happened rather than raising toasts itself: the keyboard path
 * and the context menu word it differently, and a command that both reports
 * and announces cannot be reused by either without fighting it.
 */
export function deleteSelectedEntities(globalIds: readonly number[]): DeleteSelectionResult {
  const state = useViewerStore.getState();
  let deleted = 0;
  let refused = 0;
  let sessionOnly = 0;

  for (const globalId of globalIds) {
    const { modelId, expressId } = resolveEntityRef(globalId);
    const wasSessionOnly = state.mutationViews.get(modelId)?.getNewEntity(expressId) != null;
    if (state.removeEntity(modelId, expressId)) {
      deleted += 1;
      if (wasSessionOnly) sessionOnly += 1;
    } else {
      refused += 1;
    }
  }

  return { deleted, refused, sessionOnly };
}

/** One line for a toast. Never just "deleted": the counts are the information. */
export function describeDeleteSelection(result: DeleteSelectionResult): string {
  const { deleted, refused, sessionOnly } = result;
  if (deleted === 0) {
    return refused === 1
      ? 'Nicht gelöscht — für dieses Objekt fehlt die Berechtigung.'
      : `Nichts gelöscht — für ${refused} Objekte fehlt die Berechtigung.`;
  }

  const head = deleted === 1 ? '1 Objekt gelöscht' : `${deleted} Objekte gelöscht`;
  const parts = [refused > 0 ? `${refused} abgelehnt` : null];
  // Only when ALL of them were session-only is "nothing to export" true; a
  // mixture still produces an export, and saying otherwise would send somebody
  // looking for a button that is right there.
  parts.push(sessionOnly === deleted
    ? 'nur in dieser Sitzung erzeugt, die Datei ändert sich nicht'
    : 'Export Changes zum Sichern');
  const tail = parts.filter(Boolean).join(' · ');
  return `${head} — ${tail}`;
}
