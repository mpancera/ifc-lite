/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Elementbeispiele, as the app holds them.
 *
 * Module state rather than a store slice, like the class catalogue: one
 * document, changed by one action, read by whoever offers the list. Putting it
 * in the viewer store would make every read a store subscription for data that
 * changes on the scale of weeks.
 *
 * # Persisted, unlike an earlier draft of this file
 * It said a stored copy would only add a way to be quietly out of date, which
 * was right while the list lived in one dialog. Since the examples sit in the
 * Add Element library and are placed by click (Marc, 2026-09-16), a picker
 * cannot reach out to the network every time somebody opens it. Syncing is the
 * user's action; what it yields has to survive until the next one.
 *
 * Only the LIST is stored. An example's IFC file is fetched fresh at
 * placement, because that is the moment its geometry matters.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_ELEMENT_EXAMPLES_URL,
  parseElementExamples,
  type ElementExampleCatalog,
} from './elementExamples.js';
import { externalRequestsAllowed } from '@/lib/privacy/externalRequests';
import { loadStoredElementExamples, storeElementExamples } from './elementExamplesStorage.js';

let current: ElementExampleCatalog | null = null;
let loadedFromStorage = false;
const listeners = new Set<(catalog: ElementExampleCatalog | null) => void>();

function publish(catalog: ElementExampleCatalog | null): void {
  current = catalog;
  for (const listener of listeners) listener(catalog);
}

/** Read what was synced, once per session. */
async function ensureLoaded(): Promise<void> {
  if (loadedFromStorage) return;
  loadedFromStorage = true;
  const stored = await loadStoredElementExamples();
  if (stored && !current) publish(stored);
}

/** The synced list as it stands, without subscribing. */
export function getElementExamples(): ElementExampleCatalog | null {
  return current;
}

/** Subscribe to syncs. Returns an unsubscribe function. */
export function subscribeElementExamples(
  listener: (catalog: ElementExampleCatalog | null) => void,
): () => void {
  listeners.add(listener);
  void ensureLoaded();
  return () => { listeners.delete(listener); };
}

export interface ElementExamplesState {
  readonly catalog: ElementExampleCatalog | null;
  readonly loading: boolean;
  /** What to tell the user, on failure. `null` while things are fine. */
  readonly error: string | null;
  /** Fetch (or re-fetch) the list. */
  readonly load: () => void;
}

/**
 * The examples, fetched when `enabled` first becomes true.
 *
 * `enabled` is the dialog being open. The list is not fetched on mount: a
 * panel nobody opened should not reach out to anything, and the Product
 * Library's other two tabs work entirely offline.
 */
export function useElementExamples(enabled: boolean, url = DEFAULT_ELEMENT_EXAMPLES_URL): ElementExamplesState {
  const [catalog, setCatalog] = useState<ElementExampleCatalog | null>(current);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // The app has a setting for whether it may talk to anything outside
    // itself, and this is a request outside itself. Asked here rather than
    // assumed: somebody who turned that off did so on purpose.
    if (!externalRequestsAllowed('catalog')) {
      setError('Externe Anfragen sind blockiert. Unter Datei → Datenschutz freigeben.');
      return;
    }
    setLoading(true);
    setError(null);
    fetch(url, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Die Sammlung antwortete mit ${response.status}.`);
        const parsed = parseElementExamples(await response.json(), url);
        if (!parsed) throw new Error('Die Sammlung kam in einer unbekannten Form zurück.');
        // On failure the PREVIOUS list stays in place — same reasoning as the
        // class catalogue: emptying the panel because a server was briefly
        // down is worse than showing a copy a few minutes old.
        publish(parsed);
        setCatalog(parsed);
        // Written after publishing, not before: a failed write should cost the
        // next session's head start, never this session's list.
        void storeElementExamples(parsed).catch((err: Error) => {
          console.error('[elementExamples] Sync could not be stored:', err);
        });
      })
      .catch((err: Error) => setError(`Die Sammlung war nicht erreichbar: ${err.message}`))
      .finally(() => setLoading(false));
  }, [url]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // A stored sync first: opening the panel should show what is already
    // there, and only fetch when there is nothing at all.
    void ensureLoaded().then(() => {
      if (cancelled) return;
      if (current) setCatalog(current);
      else load();
    });
    return () => { cancelled = true; };
  }, [enabled, load]);

  return { catalog, loading, error, load };
}

/** Test seam: drop the session's copy so the next read fetches again. */
export function resetElementExamplesForTests(): void {
  current = null;
  loadedFromStorage = false;
  listeners.clear();
}
