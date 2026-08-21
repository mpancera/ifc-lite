/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Whether the active role may author at all — for the controls that offer it.
 *
 * The store already refuses a write the role does not permit, and says why.
 * The trouble was WHEN: edit mode switched on, handles appeared, a room was
 * dragged into shape, and only the attempt to write produced the sentence about
 * a read-only role. The permission was enforced at the end of the gesture and
 * advertised nowhere at the start of it.
 *
 * So the same predicate the store uses is available here, for disabling the
 * control and putting the reason in its tooltip. `mayCreateEntities` is the
 * right one: it asks whether this role may author ANYTHING, which is what an
 * Edit toggle promises. A discipline role passes — it may add, and may change
 * what it added; whether a particular reference-model element is off limits is
 * a question about that element, answered per write by `mayEditEntity`, and not
 * something to grey out a whole mode over.
 */

import { useMemo } from 'react';
import { useViewerStore } from '@/store';
import { mayCreateEntities, type EditPermission } from '@/lib/roles/roleGuard';
import { normalizeRoleId } from '@/lib/roles/disciplineRoles';

export function useMayAuthor(): EditPermission {
  const activeSystemId = useViewerStore((s) => s.activeDisciplineSystemId);
  return useMemo(
    () => mayCreateEntities(normalizeRoleId(activeSystemId)),
    [activeSystemId],
  );
}
