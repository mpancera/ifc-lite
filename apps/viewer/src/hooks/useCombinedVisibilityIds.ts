/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The hidden / isolated element sets the 2D drawing pipeline consumes, as
 * GLOBAL ids.
 *
 * Visibility is stored twice over: a legacy single-model set plus a per-model
 * map of LOCAL express ids. The drawing generator only understands global ids,
 * so somebody has to fold the two together. Two surfaces now need that fold —
 * the 2D Section panel and plan mode — and doing it twice is how the two would
 * eventually disagree about whether a hidden element is drawn.
 */

import { useMemo } from 'react';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';

export interface CombinedVisibilityIds {
  /** Hidden elements, as global ids. Empty when nothing is hidden. */
  readonly combinedHiddenIds: Set<number>;
  /**
   * Isolated elements as global ids, or `null` when no isolation is active.
   *
   * `null` and an empty set mean different things to the generator — no
   * isolation versus "isolate nothing", which would draw an empty plan — so
   * the empty case is deliberately collapsed to `null`.
   */
  readonly combinedIsolatedIds: Set<number> | null;
}

export function useCombinedVisibilityIds(): CombinedVisibilityIds {
  const models = useViewerStore((s) => s.models);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const isolatedEntities = useViewerStore((s) => s.isolatedEntities);
  const hiddenEntitiesByModel = useViewerStore((s) => s.hiddenEntitiesByModel);
  const isolatedEntitiesByModel = useViewerStore((s) => s.isolatedEntitiesByModel);

  const combinedHiddenIds = useMemo(() => {
    const globalHiddenIds = new Set<number>(hiddenEntities); // legacy ids are already global
    for (const [modelId, localHiddenIds] of hiddenEntitiesByModel) {
      const model = models.get(modelId);
      if (model && model.idOffset !== undefined) {
        for (const localId of localHiddenIds) {
          globalHiddenIds.add(toGlobalIdFromModels(models, model.id, localId));
        }
      }
    }
    return globalHiddenIds;
  }, [hiddenEntities, hiddenEntitiesByModel, models]);

  const combinedIsolatedIds = useMemo(() => {
    // Legacy isolation wins outright and already holds global ids.
    if (isolatedEntities !== null) return isolatedEntities;

    const globalIsolatedIds = new Set<number>();
    for (const [modelId, localIsolatedIds] of isolatedEntitiesByModel) {
      const model = models.get(modelId);
      if (model && model.idOffset !== undefined) {
        for (const localId of localIsolatedIds) {
          globalIsolatedIds.add(toGlobalIdFromModels(models, model.id, localId));
        }
      }
    }
    return globalIsolatedIds.size > 0 ? globalIsolatedIds : null;
  }, [isolatedEntities, isolatedEntitiesByModel, models]);

  return { combinedHiddenIds, combinedIsolatedIds };
}

export default useCombinedVisibilityIds;
