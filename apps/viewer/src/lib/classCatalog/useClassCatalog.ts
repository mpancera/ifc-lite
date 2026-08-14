/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Fachklassen catalogue, as the app holds it.
 *
 * Module-level state rather than a store slice: it is one document, changed by
 * one action, read by whoever needs to offer a class list. Putting it in the
 * viewer store would make every catalogue read a store subscription for data
 * that changes about once a month.
 *
 * # Fetched only when asked
 * `syncClassCatalog()` is a settings action, not a start-up step. A viewer
 * that reaches out to the network to open a file is a viewer that fails to
 * open a file when the network is down — and the catalogue changes on the
 * scale of weeks, so there is nothing to be gained by asking daily.
 */

import { useEffect, useState } from 'react';
import {
  parseClassCatalog, DEFAULT_CLASS_CATALOG_URL, type ClassCatalog,
} from './classCatalog.js';
import { loadStoredClassCatalog, storeClassCatalog } from './classCatalogStorage.js';
import { externalRequestsAllowed } from '@/lib/privacy/externalRequests';

let current: ClassCatalog | null = null;
let loaded = false;
const listeners = new Set<(catalog: ClassCatalog | null) => void>();

function publish(catalog: ClassCatalog | null): void {
  current = catalog;
  for (const listener of listeners) listener(catalog);
}

/** Read what was stored, once per session. */
async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  publish(await loadStoredClassCatalog());
}

export interface ClassCatalogSyncResult {
  readonly ok: boolean;
  /** How many classes arrived, on success. */
  readonly count?: number;
  /** What to tell the user, on failure. */
  readonly error?: string;
}

/**
 * Fetch the catalogue and keep it.
 *
 * On failure the PREVIOUS catalogue stays in place. A sync that emptied the
 * list because a server was briefly down would take the class picker away from
 * somebody in the middle of using it, which is worse than working from a copy
 * three weeks old.
 */
export async function syncClassCatalog(
  url = DEFAULT_CLASS_CATALOG_URL,
): Promise<ClassCatalogSyncResult> {
  // The app has a setting for whether it may talk to anything outside itself,
  // and this is a request outside itself. Asked here rather than assumed:
  // somebody who turned that off did so on purpose, and a catalogue sync is
  // not the exception that gets to ignore it.
  if (!externalRequestsAllowed()) {
    return {
      ok: false,
      error: 'Externe Anfragen sind blockiert. Unter Datei → Datenschutz freigeben.',
    };
  }

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return { ok: false, error: `Der Katalog antwortete mit ${response.status}.` };
    }
    const catalog = parseClassCatalog(await response.json(), url);
    if (!catalog) {
      return { ok: false, error: 'Der Katalog kam in einer unbekannten Form zurück.' };
    }
    await storeClassCatalog(catalog);
    loaded = true;
    publish(catalog);
    return { ok: true, count: catalog.entries.length };
  } catch (error) {
    return { ok: false, error: `Der Katalog war nicht erreichbar: ${(error as Error).message}` };
  }
}

/** The catalogue as it stands, without subscribing. */
export function getClassCatalog(): ClassCatalog | null {
  return current;
}

/** The catalogue, loading the stored copy on first use. */
export function useClassCatalog(): ClassCatalog | null {
  const [catalog, setCatalog] = useState<ClassCatalog | null>(current);

  useEffect(() => {
    listeners.add(setCatalog);
    void ensureLoaded();
    return () => { listeners.delete(setCatalog); };
  }, []);

  return catalog;
}

/** Test seam: drop the session's copy so the next read goes to storage. */
export function resetClassCatalogForTests(): void {
  current = null;
  loaded = false;
  listeners.clear();
}
