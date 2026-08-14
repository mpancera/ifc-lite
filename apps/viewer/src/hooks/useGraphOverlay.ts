/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Paints what the graph is drawing into the model: the elements in the
 * schematic keep their colour, everything else fades back.
 *
 * # Why this reuses the lens channel
 * "Colour these, ghost the rest" is exactly what a lens does, down to the
 * ghost colour. A second colouring path would mean a second definition of what
 * ghosted looks like, a second thing to clear, and two overlays fighting over
 * the same elements. So this goes through the one overlay channel
 * (`setPendingColorUpdates` → `scene.setColorOverrides`), and follows the
 * ownership protocol `useCompareOverlay` established: while the graph shows
 * something it owns the channel, and on teardown it hands the channel back to
 * whatever owned it before — an active lens, or nothing.
 *
 * # Why the highlighted elements are not given a colour
 * Only the ghosts are written. An element the graph contains is left alone, so
 * it keeps whatever colour it already had — its material, or the lens colour
 * underneath. Painting the highlight a single accent would throw away the
 * information the model is already showing, and the contrast against the
 * ghosts is what makes it read anyway.
 *
 * Mounted by the graph panel, so closing the panel restores the model.
 */

import { useEffect, useRef } from 'react';
import { GHOST_COLOR } from '@ifc-lite/lens';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';

type ViewerStore = ReturnType<typeof useViewerStore.getState>;

/** Hand the shared colour channel back to its prior owner: if a lens is still
 *  active, restore its overlay; otherwise clear. Same contract as compare —
 *  an active lens may merely have its panel hidden, not be switched off. */
function handBackColorChannel(store: ViewerStore): void {
  const lensColors = store.lensAppliedColors;
  store.setPendingColorUpdates(lensColors && lensColors.size > 0 ? new Map(lensColors) : new Map());
}

export function useGraphOverlay(): void {
  const highlight = useViewerStore((s) => s.graphHighlight);
  const enabled = useViewerStore((s) => s.graphHighlightInView);
  // Whether we are currently the channel's owner. Tracked rather than derived
  // from `highlight`, because teardown has to know if there is anything to
  // hand back even when the highlight has already been cleared.
  const owningRef = useRef(false);

  useEffect(() => {
    const store = useViewerStore.getState();

    if (!enabled || !highlight || highlight.expressIds.length === 0) {
      if (owningRef.current) {
        handBackColorChannel(store);
        owningRef.current = false;
      }
      return;
    }

    const inGraph = new Set(highlight.expressIds);
    const { models } = store;
    const model = models.get(highlight.modelId);
    if (!model?.ifcDataStore) return;

    // Ghost every entity of the highlighted model that the drawing does NOT
    // contain. Only that model: in a federation the other models are not what
    // this drawing is about, and fading them too would say they are.
    const entities = model.ifcDataStore.entities;
    const overrides = new Map<number, [number, number, number, number]>();
    for (const [, ids] of model.ifcDataStore.entityIndex.byType) {
      for (const expressId of ids) {
        if (inGraph.has(expressId)) continue;
        // Only what is drawn can be ghosted. Without this the map carries an
        // entry for every cartesian point and property in the file — 129,000
        // of them in the electrical test model, against the 3,600 that have a
        // mesh — to say nothing about anything visible.
        if (!entities.hasGeometry(expressId)) continue;
        overrides.set(toGlobalIdFromModels(models, highlight.modelId, expressId), GHOST_COLOR);
      }
    }

    store.setPendingColorUpdates(overrides);
    owningRef.current = true;
  }, [highlight, enabled]);

  // Teardown on unmount (panel closed) — give the model back.
  useEffect(() => {
    return () => {
      if (!owningRef.current) return;
      handBackColorChannel(useViewerStore.getState());
      owningRef.current = false;
    };
  }, []);
}
