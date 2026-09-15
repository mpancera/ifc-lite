/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Writing down where the underlays currently sit, whenever that changes.
 *
 * Mounted once, high up, rather than in the DXF panel: a plan is moved by
 * Alt-dragging it on the canvas and by the two-point solver as much as by the
 * panel's own fields, and a memory that only recorded what the panel did would
 * forget exactly the placements that took the most work.
 *
 * MERGES rather than replaces. The store starts empty on every load, so a hook
 * that wrote the current list wholesale would erase every remembered plan in
 * the first frame after a reload — before the person has had a chance to
 * re-import anything.
 */

import { useEffect } from 'react';
import { useViewerStore } from '@/store';
import {
  isPlaced, loadDxfPlacements, saveDxfPlacements,
} from '@/lib/dxf/placementMemory';

export function useDxfPlacementMemory(): void {
  const underlays = useViewerStore((s) => s.dxfUnderlays);
  const currentProjectKey = useViewerStore((s) => s.currentProjectKey);

  useEffect(() => {
    if (underlays.length === 0) return;
    const project = currentProjectKey();
    if (project === null) return;

    const memory = loadDxfPlacements(project);
    let changed = false;
    for (const u of underlays) {
      // An untouched plan is not a decision. Recording it would put a row in
      // storage for every file ever opened, and restore a default that the
      // import would have produced anyway.
      if (!isPlaced(u.placement)) continue;
      const before = memory[u.name];
      if (before
        && before.unitScale === u.underlay.unitScale
        && before.storeyId === u.storeyId
        && before.placement.offsetX === u.placement.offsetX
        && before.placement.offsetY === u.placement.offsetY
        && before.placement.rotationDeg === u.placement.rotationDeg
        && before.placement.scale === u.placement.scale) continue;
      memory[u.name] = {
        placement: { ...u.placement },
        unitScale: u.underlay.unitScale,
        ...(u.storeyId === undefined ? {} : { storeyId: u.storeyId }),
      };
      changed = true;
    }
    if (changed) saveDxfPlacements(project, memory);
  }, [underlays, currentProjectKey]);
}
