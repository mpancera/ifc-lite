/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keeps rule-driven properties current as the model changes.
 *
 * Runs off `mutationVersion`, the same signal the Lens uses, debounced so a
 * burst of placements settles once rather than recomputing per element.
 *
 * The loop hazard is the thing to understand here: a re-evaluation writes,
 * writes are changes, changes bump `mutationVersion`. It terminates because
 * the plan only contains values that actually differ, so the pass that follows
 * a write finds nothing to do and bumps nothing. Writing through the view
 * rather than the store action keeps the intermediate writes from bumping at
 * all; one bump at the end tells the UI to re-read.
 */

import { useEffect, useRef } from 'react';
import { PropertyValueType } from '@ifc-lite/data';
import { useViewerStore } from '@/store';
import { planReevaluation } from '@/lib/smartProperties/reevaluate';

/** Long enough that placing several elements settles once. */
const SYNC_DEBOUNCE_MS = 400;

export function useSmartPropertySync(): void {
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeModelId) return;
    if (timer.current) clearTimeout(timer.current);

    timer.current = setTimeout(() => {
      const state = useViewerStore.getState();
      const store = state.models.get(activeModelId)?.ifcDataStore;
      const view = state.mutationViews.get(activeModelId);
      if (!store || !view) return;

      try {
        const plan = planReevaluation({ store, view });
        if (plan.writes.length === 0) return;

        for (const write of plan.writes) {
          view.setProperty(
            write.expressId, write.pset, write.property, write.value, PropertyValueType.String,
          );
        }
        // One bump for the batch — the next pass finds nothing and stops.
        useViewerStore.getState().bumpMutationVersion();
      } catch (err) {
        // A rule that cannot resolve must never break the session.
        console.warn('[smartProperties] re-evaluation failed:', err);
      }
    }, SYNC_DEBOUNCE_MS);

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [activeModelId, mutationVersion]);
}
