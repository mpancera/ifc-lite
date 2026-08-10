/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Swap project-scoped state when the project changes.
 *
 * Scoping where things are STORED is only half the job. Without this the
 * previous project's zones simply stay on screen after a switch — still on
 * disk under their own key, but visible here, which is the leak in person
 * rather than in the file.
 *
 * Watches the three things a project key is derived from rather than the key
 * itself: `currentProjectKey()` is a function, so subscribing to it would
 * re-run on every store change instead of on the ones that matter.
 */

import { useEffect, useRef } from 'react';
import { useViewerStore } from '@/store';

export function useProjectScopedState(): void {
  const projectFolder = useViewerStore((s) => s.projectFolder);
  const offeredProject = useViewerStore((s) => s.offeredProject);
  const models = useViewerStore((s) => s.models);
  const loadZoneSetsForProject = useViewerStore((s) => s.loadZoneSetsForProject);
  const loadAnnotationsForProject = useViewerStore((s) => s.loadAnnotationsForProject);

  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const key = useViewerStore.getState().currentProjectKey();
    // Compared, not just reacted to: the model map is a new object on every
    // load, and re-reading storage on each of those would fight an import that
    // is still in progress.
    if (key === lastKey.current) return;
    lastKey.current = key;

    loadZoneSetsForProject();
    loadAnnotationsForProject();
  }, [projectFolder, offeredProject, models,
      loadZoneSetsForProject, loadAnnotationsForProject]);
}
