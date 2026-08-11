/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The active lens's colours, in the form a 2D drawing can use.
 *
 * The lens computes `globalId → hex` and pushes it into the 3D scene's colour
 * channel. A drawing carries LOCAL express ids plus a model index, and knows
 * nothing about that channel — which is why a lens that made sense of a
 * building in 3D had no effect on any drawing of it. This translates once, for
 * both the plan and the 2D Section panel.
 */

import { useMemo } from 'react';
import { useViewerStore } from '@/store';
import { fromGlobalIdFromModels } from '@/store/globalId';

/**
 * `"modelIndex:entityId"` → CSS colour, or `undefined` when no lens is active.
 *
 * `undefined` rather than an empty map so the canvas can skip the lookup
 * entirely, and so "no lens" is distinguishable from "a lens that matched
 * nothing" — the second is a real result worth seeing as an uncoloured plan.
 */
export function useLensColorKeys(
  modelIdToIndex?: Map<string, number>,
): ReadonlyMap<string, string> | undefined {
  const lensColorMap = useViewerStore((s) => s.lensColorMap);
  const activeLensId = useViewerStore((s) => s.activeLensId);
  const models = useViewerStore((s) => s.models);

  return useMemo(() => {
    if (!activeLensId || lensColorMap.size === 0) return undefined;
    const keys = new Map<string, string>();
    for (const [globalId, color] of lensColorMap) {
      const local = fromGlobalIdFromModels(models, globalId);
      if (local) {
        keys.set(`${modelIdToIndex?.get(local.modelId) ?? 0}:${local.expressId}`, color);
      } else {
        // Single-model fallback: the global id IS the express id, index 0.
        keys.set(`0:${globalId}`, color);
      }
    }
    return keys;
  }, [lensColorMap, activeLensId, models, modelIdToIndex]);
}

export default useLensColorKeys;
