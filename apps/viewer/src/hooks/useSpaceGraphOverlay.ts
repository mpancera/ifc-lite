/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The space graph in the 3D scene.
 *
 * The plan draws the same diagram as an SVG overlay; this puts it in the
 * building, which is where it becomes believable — a graph read in plan is a
 * set of lines in one plane, and whether the line to the stairwell means
 * anything only shows when the model is turned.
 *
 * # It rides the same channel the sketch ghosts do
 * `setSpaceOverlayMeshes` goes straight to the renderer scene rather than
 * through `geometryResult`, which is what keeps a frequently-changing overlay
 * from tripping the streaming reclassifier. Space Sketch uses it too, and the
 * two are never open at once — but it is one channel, so whoever writes last
 * wins, and this one clears up after itself when the graph is switched off.
 *
 * # One storey, like everything else here
 * The graph is built per storey (express ids are local and rooms are found
 * under one storey node), so the diagram shows the storey in scope. On a
 * building it is the same restriction the plan, the escape routes and the door
 * numbers all carry.
 */

import { useEffect } from 'react';
import { useViewerStore } from '@/store';
import { useIfc } from './useIfc';
import { useSpaceGraph } from './useSpaceGraph';
import { isStairwell } from '@/lib/spaceGraph/spaceGraph';
import { spaceGraphView } from '@/lib/spaceGraph/graphView';
import { spaceGraphMeshes } from '@/lib/spaceGraph/graphMeshes';
import { stepsToSafety, type NumberingDoor, type NumberingRoom } from '@/lib/doorNumbers/doorNumbers';

export function useSpaceGraphOverlay(): void {
  const showSpaceGraph = useViewerStore((s) => s.showSpaceGraph);
  const viewMode = useViewerStore((s) => s.viewMode);
  const models = useViewerStore((s) => s.models);
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const activeStorey = useViewerStore((s) => s.activeStorey);
  const { geometryResult: legacyGeometry, ifcDataStore } = useIfc();

  const single = models.size === 1 ? [...models.entries()][0] : null;
  const modelId = single ? single[0] : models.size === 0 ? 'legacy' : activeModelId;
  const model = modelId ? models.get(modelId) : null;
  const dataStore = model?.ifcDataStore ?? (models.size === 0 ? ifcDataStore : null);
  const geometryResult = model?.geometryResult ?? legacyGeometry;
  const storeyId = activeStorey?.expressId ?? null;

  // The 2D plan draws its own; building meshes for it as well would put a
  // second diagram in a scene nobody is looking at.
  const enabled = showSpaceGraph && viewMode !== '2d';

  const graph = useSpaceGraph({ enabled, geometryResult, dataStore, modelId, storeyId });

  useEffect(() => {
    const callbacks = useViewerStore.getState().cameraCallbacks;
    if (!enabled || !graph || storeyId === null) {
      callbacks.clearSpaceOverlayMeshes?.();
      return undefined;
    }

    const rooms: NumberingRoom[] = [];
    const labels = new Map<number, string>();
    const safe = new Set<number>();
    for (const space of graph.spaces.values()) {
      const number = String(dataStore?.entities?.getName?.(space.id) ?? '').trim();
      labels.set(space.id, number || space.name);
      const isSafe = isStairwell(space);
      if (isSafe) safe.add(space.id);
      rooms.push({ id: space.id, number, centre: space.labelPoint, safe: isSafe });
    }
    const doors: NumberingDoor[] = graph.edges.map((edge) => ({
      id: edge.doorId,
      centre: graph.doors.get(edge.doorId)?.centre ?? edge.threshold[0],
      sides: [edge.from, edge.to],
    }));

    const view = spaceGraphView(graph, { steps: stepsToSafety(rooms, doors), safe, labels });
    const elevation = dataStore?.spatialHierarchy?.storeyElevations?.get(storeyId) ?? 0;
    callbacks.setSpaceOverlayMeshes?.(spaceGraphMeshes(view, { elevation }));

    return () => { useViewerStore.getState().cameraCallbacks.clearSpaceOverlayMeshes?.(); };
  }, [enabled, graph, dataStore, storeyId]);
}

export default useSpaceGraphOverlay;
