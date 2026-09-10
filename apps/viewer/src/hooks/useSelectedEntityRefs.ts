/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The current selection as model-local refs, kept live.
 *
 * A hook and not a plain selector because the answer is assembled from four
 * store fields (see `store/selectedRefs.ts`); subscribing to each one keeps a
 * panel re-rendering when ANY of them changes, which is the whole point — a
 * panel that watches one field shows a stale count for the other three.
 */

import { useMemo } from 'react';
import { useViewerStore } from '@/store';
import { selectedEntityRefs } from '@/store/selectedRefs';
import type { EntityRef } from '@/store/types';

export function useSelectedEntityRefs(): EntityRef[] {
  const selectedEntity = useViewerStore((s) => s.selectedEntity);
  const selectedEntities = useViewerStore((s) => s.selectedEntities);
  const selectedEntitiesSet = useViewerStore((s) => s.selectedEntitiesSet);
  const selectedEntityIds = useViewerStore((s) => s.selectedEntityIds);
  const resolveGlobalIdFromModels = useViewerStore((s) => s.resolveGlobalIdFromModels);
  const fromGlobalId = useViewerStore((s) => s.fromGlobalId);
  // `models` is not read here, but resolving a global id walks it — without the
  // dependency the refs would keep naming a model that has been unloaded.
  const models = useViewerStore((s) => s.models);

  return useMemo(
    () => selectedEntityRefs({
      selectedEntity,
      selectedEntities,
      selectedEntitiesSet,
      selectedEntityIds,
      resolveGlobalIdFromModels,
      fromGlobalId,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedEntity, selectedEntities, selectedEntitiesSet, selectedEntityIds,
      resolveGlobalIdFromModels, fromGlobalId, models],
  );
}
