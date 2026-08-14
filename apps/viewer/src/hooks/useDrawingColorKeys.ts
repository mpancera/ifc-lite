/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The colours a 2D drawing should paint its entities with.
 *
 * A drawing carries LOCAL express ids plus a model index and knows nothing
 * about the 3D scene's colour channel, so everything that wants to tint the
 * model has to be translated for it. This is the one place that happens — for
 * the plan and the 2D Section panel alike.
 *
 * Two sources feed it today:
 *
 *  - the **active lens**, which computes `globalId → hex` and colours what it
 *    matched;
 *  - the **graph panel**, which fades back everything its drawing does NOT
 *    contain, so the schematic and the plan agree about what is being looked
 *    at (see `useGraphOverlay` for the 3D half of the same idea).
 *
 * They compose in that order: a lens colour wins over the graph's fade, because
 * a lens is an explicit statement about an element and the fade is a statement
 * about everything else.
 */

import { useMemo } from 'react';
import { useViewerStore } from '@/store';
import { fromGlobalIdFromModels } from '@/store/globalId';

/**
 * The 2D stand-in for the 3D ghost.
 *
 * A flat pale grey rather than the renderer's `GHOST_COLOR`, because this path
 * carries hex only — `lensColorMap` is built with `rgbaToHex`, which drops
 * alpha. Translucency is what makes a ghost read in 3D; in line work, paleness
 * does the same job, and faking the alpha by inventing a blend against an
 * unknown background would be worse than choosing a grey.
 */
const DRAWING_GHOST = '#c9c9c9';

/**
 * `"modelIndex:entityId"` → CSS colour, or `undefined` when nothing wants to
 * tint the drawing.
 *
 * `undefined` rather than an empty map so the canvas can skip the lookup
 * entirely, and so "nothing active" is distinguishable from "active but
 * matched nothing" — the second is a real result worth seeing as an
 * uncoloured plan.
 */
export function useDrawingColorKeys(
  modelIdToIndex?: Map<string, number>,
): ReadonlyMap<string, string> | undefined {
  const lensColorMap = useViewerStore((s) => s.lensColorMap);
  const activeLensId = useViewerStore((s) => s.activeLensId);
  const graphHighlight = useViewerStore((s) => s.graphHighlight);
  const graphHighlightInView = useViewerStore((s) => s.graphHighlightInView);
  const models = useViewerStore((s) => s.models);

  return useMemo(() => {
    const lensActive = !!activeLensId && lensColorMap.size > 0;
    const graphActive =
      graphHighlightInView && !!graphHighlight && graphHighlight.expressIds.length > 0;
    if (!lensActive && !graphActive) return undefined;

    const keys = new Map<string, string>();

    // The graph goes first so a lens colour can overwrite it.
    if (graphActive) {
      const model = models.get(graphHighlight.modelId);
      const store = model?.ifcDataStore;
      if (store) {
        const index = modelIdToIndex?.get(graphHighlight.modelId) ?? 0;
        const inGraph = new Set(graphHighlight.expressIds);
        for (const [, ids] of store.entityIndex.byType) {
          for (const expressId of ids) {
            if (inGraph.has(expressId)) continue;
            if (!store.entities.hasGeometry(expressId)) continue;
            keys.set(`${index}:${expressId}`, DRAWING_GHOST);
          }
        }
      }
    }

    if (lensActive) {
      for (const [globalId, color] of lensColorMap) {
        const local = fromGlobalIdFromModels(models, globalId);
        if (local) {
          keys.set(`${modelIdToIndex?.get(local.modelId) ?? 0}:${local.expressId}`, color);
        } else {
          // Single-model fallback: the global id IS the express id, index 0.
          keys.set(`0:${globalId}`, color);
        }
      }
    }

    return keys;
  }, [lensColorMap, activeLensId, graphHighlight, graphHighlightInView, models, modelIdToIndex]);
}

export default useDrawingColorKeys;
