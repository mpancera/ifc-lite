/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Publishes the saved rule set for the session.
 *
 * Mounted at the layout root rather than beside the viewport, because the
 * viewport only renders once a model is open — loading rules there would tie
 * "which rules are in force" to "has a file been opened yet", and the first
 * placements of a session would quietly use the shipped defaults.
 */

import { useEffect } from 'react';
import { useViewerStore } from '@/store';
import { setActiveRules } from '@/lib/smartProperties/activeRules';
import { loadStoredRules } from '@/lib/smartProperties/idbRuleStorage';

export function SmartPropertyRulesMount() {
  useEffect(() => {
    let cancelled = false;
    void loadStoredRules().then((stored) => {
      if (cancelled) return;
      setActiveRules(stored);
      // Only nudge when custom rules exist — a bump on every boot would make
      // the autosave write a snapshot nobody asked for.
      if (stored) useViewerStore.getState().bumpMutationVersion();
    });
    return () => { cancelled = true; };
  }, []);

  return null;
}
