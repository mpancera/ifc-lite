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
 * # Not persisted, unlike the class catalogue
 * That one is stored because it backs a picker used all the time and is large
 * enough that re-fetching would be felt. This list is small, is read only
 * while a dialog is open, and — unlike a classification — an example's FILE is
 * fetched fresh at placement anyway. A stored copy would only add a way to be
 * quietly out of date.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_ELEMENT_EXAMPLES_URL,
  parseElementExamples,
  type ElementExampleCatalog,
} from './elementExamples.js';
import { externalRequestsAllowed } from '@/lib/privacy/externalRequests';

let current: ElementExampleCatalog | null = null;

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
        current = parsed;
        setCatalog(parsed);
      })
      .catch((err: Error) => setError(`Die Sammlung war nicht erreichbar: ${err.message}`))
      .finally(() => setLoading(false));
  }, [url]);

  useEffect(() => {
    if (!enabled || current) return;
    load();
  }, [enabled, load]);

  return { catalog, loading, error, load };
}

/** Test seam: drop the session's copy so the next read fetches again. */
export function resetElementExamplesForTests(): void {
  current = null;
}
