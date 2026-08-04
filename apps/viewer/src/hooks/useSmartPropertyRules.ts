/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Loads, edits and persists the rule set.
 *
 * Publishing to `activeRules` is the point: placement and re-evaluation both
 * run from imperative code and cannot read a hook, so the module-level value is
 * what actually drives them. React state here only feeds the editor.
 */

import { useCallback, useEffect, useState } from 'react';
import { useViewerStore } from '@/store';
import { activeRules, setActiveRules, usingDefaultRules } from '@/lib/smartProperties/activeRules';
import { clearStoredRules, loadStoredRules, saveRules } from '@/lib/smartProperties/idbRuleStorage';
import type { SmartPropertyRule } from '@/lib/smartProperties/types';

export function useSmartPropertyRules() {
  const [rules, setRules] = useState<readonly SmartPropertyRule[]>(() => activeRules());
  const [isDefault, setIsDefault] = useState(() => usingDefaultRules());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadStoredRules().then((stored) => {
      if (cancelled) return;
      setActiveRules(stored);
      setRules(activeRules());
      setIsDefault(usingDefaultRules());
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * Publish, persist, and nudge the model to re-evaluate — a changed rule that
   * left existing elements on their old values would look broken.
   */
  const commit = useCallback(async (next: readonly SmartPropertyRule[]) => {
    setActiveRules(next);
    setRules(activeRules());
    setIsDefault(usingDefaultRules());
    await saveRules(next);
    useViewerStore.getState().bumpMutationVersion();
  }, []);

  const reset = useCallback(async () => {
    setActiveRules(null);
    setRules(activeRules());
    setIsDefault(true);
    await clearStoredRules();
    useViewerStore.getState().bumpMutationVersion();
  }, []);

  return { rules, isDefault, loaded, commit, reset };
}
