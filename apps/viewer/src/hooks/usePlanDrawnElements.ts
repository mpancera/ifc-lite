/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The one test every derived plan layer asks before drawing an element.
 *
 * Binds `planDrawsElement` to the store: the mutation overlay of the model
 * being drawn (for the deletion tombstone) and the visibility sets the caller
 * already folded for the drawing generator, so the layers on top of the cut
 * and the cut itself answer from the same state.
 *
 * Recomputed on `mutationVersion` — the signal every overlay reader in the
 * viewer recomputes on. Without it a deletion would only reach the plan on the
 * next unrelated re-render.
 */

import { useMemo } from 'react';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { planDrawsElement, type PlanElementTest } from '@/lib/plan/planVisibility';

export interface UsePlanDrawnElementsOptions {
  /** The single model the plan is drawing, or null. */
  modelId: string | null;
  /** Hidden elements as global ids, from `useCombinedVisibilityIds`. */
  hiddenGlobalIds?: ReadonlySet<number> | null;
  /** Isolated elements as global ids, `null` when no isolation is active. */
  isolatedGlobalIds?: ReadonlySet<number> | null;
}

export function usePlanDrawnElements({
  modelId, hiddenGlobalIds, isolatedGlobalIds,
}: UsePlanDrawnElementsOptions): PlanElementTest {
  const models = useViewerStore((s) => s.models);
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  return useMemo((): PlanElementTest => {
    // Same key mapping the other overlay readers use for the pre-federation
    // model, which the store files under `__legacy__`.
    const overlay = modelId
      ? mutationViews.get(modelId === 'legacy' ? '__legacy__' : modelId)
      : undefined;

    return planDrawsElement({
      hiddenGlobalIds,
      isolatedGlobalIds,
      isDeleted: overlay ? (expressId) => overlay.isDeleted(expressId) : undefined,
      toGlobalId: modelId
        ? (expressId) => toGlobalIdFromModels(models, modelId, expressId)
        : undefined,
    });
    // `mutationVersion` is a deliberate dependency: the overlay is mutated in
    // place, so its identity never changes when a room is deleted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, hiddenGlobalIds, isolatedGlobalIds, models, mutationViews, mutationVersion]);
}

export default usePlanDrawnElements;
