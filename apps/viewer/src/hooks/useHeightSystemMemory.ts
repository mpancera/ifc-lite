/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Restoring the height system on open, and recording every change after.
 *
 * Mounted once, high up, like the DXF placement memory beside it: the system
 * is edited from the heights panel, from the DXF panel's "Aus Modell ableiten"
 * shortcut and from the storey dropdowns, and a memory that only watched one
 * of those would lose the other two.
 *
 * ## Restore only into emptiness
 *
 * A stored system is applied ONLY when the store has none. Anything else would
 * let a reload's restore land on top of a system just derived from a freshly
 * opened model — the newer, deliberate thing losing to the older, automatic
 * one. So: nothing there, put it back; something there, leave it and record it.
 */

import { useEffect, useRef } from 'react';
import { useViewerStore } from '@/store';
import { loadHeightSystem, saveHeightSystem } from '@/lib/heights/systemMemory';

export function useHeightSystemMemory(): void {
  const heightSystem = useViewerStore((s) => s.heightSystem);
  const setHeightSystem = useViewerStore((s) => s.setHeightSystem);
  const currentProjectKey = useViewerStore((s) => s.currentProjectKey);
  const models = useViewerStore((s) => s.models);

  /** Projects already offered their stored system, so a restore is not retried
   *  after somebody deliberately cleared one. */
  const restored = useRef<Set<string>>(new Set());

  useEffect(() => {
    // `models` is in the dependencies because the project key is DERIVED from
    // the loaded model names when no folder is bound: before the first model
    // arrives there is no project to restore into.
    const project = currentProjectKey();
    if (project === null) return;

    if (heightSystem === null) {
      if (restored.current.has(project)) return;
      restored.current.add(project);
      const stored = loadHeightSystem(project);
      if (stored) setHeightSystem(stored);
      return;
    }

    restored.current.add(project);
    saveHeightSystem(project, heightSystem);
  }, [heightSystem, setHeightSystem, currentProjectKey, models]);
}
