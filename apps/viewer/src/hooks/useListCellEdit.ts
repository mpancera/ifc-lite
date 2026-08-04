/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Committing a typed list cell to the mutation overlay.
 *
 * The list already reads through the overlay, so a committed edit is visible
 * everywhere else that does — the properties panel, the Lens, the export. What
 * this adds is the write direction, and the two things a write has to respect:
 * which columns have a meaningful inverse (`editTarget`), and whether the
 * active role may write at all (`canAuthorOn`).
 *
 * A refusal is returned, never swallowed. A cell that quietly ignores typing is
 * the worst possible outcome — the value looks entered until someone reloads.
 */

import { useCallback } from 'react';
import { useViewerStore } from '@/store';
import { cellEditability } from '@/lib/lists/editTarget';
import { coerceCellInput } from '@/lib/lists/coerceCellInput';
import type { ColumnDefinition } from '@ifc-lite/lists';

export interface CellEditRequest {
  modelId: string;
  entityId: number;
  column: ColumnDefinition;
  /** Raw text as typed or pasted. */
  raw: string;
  /** The value currently shown, which decides how the text is typed. */
  previous: unknown;
}

export type CellEditResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: string };

export function useListCellEdit() {
  const setProperty = useViewerStore((s) => s.setProperty);
  const setAttribute = useViewerStore((s) => s.setAttribute);
  const canAuthorOn = useViewerStore((s) => s.canAuthorOn);

  const commitCell = useCallback((request: CellEditRequest): CellEditResult => {
    const editability = cellEditability(request.column);
    if (!editability.editable) return { ok: false, reason: editability.reason };

    const permission = canAuthorOn(request.modelId, request.entityId);
    if (!permission.allowed) return { ok: false, reason: permission.reason };

    // Typing the value that is already there is not an edit. Skipping it keeps
    // an accidental click-through out of the undo stack and out of the
    // reference-model change list, where every entry is meant to be a decision.
    const shownPrevious = request.previous === null || request.previous === undefined
      ? '' : String(request.previous);
    if (request.raw === shownPrevious) return { ok: true, changed: false };

    const { value, valueType } = coerceCellInput(request.raw, request.previous);

    if (editability.target.kind === 'attribute') {
      const mutation = setAttribute(
        request.modelId, request.entityId, editability.target.name,
        String(value), shownPrevious,
      );
      return mutation
        ? { ok: true, changed: true }
        : { ok: false, reason: 'Die Änderung wurde nicht übernommen.' };
    }

    const mutation = setProperty(
      request.modelId, request.entityId,
      editability.target.psetName, editability.target.propertyName,
      value, valueType,
    );
    return mutation
      ? { ok: true, changed: true }
      : { ok: false, reason: 'Die Änderung wurde nicht übernommen.' };
  }, [setProperty, setAttribute, canAuthorOn]);

  return { commitCell };
}
