/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * React entry point for the element catalog. Prefers a user-imported
 * "Firmenbibliothek" (`FileImportCatalogProvider`, cached in IndexedDB)
 * when one has been imported; falls back to the small generic
 * `LocalSeedCatalogProvider` demo entries otherwise, so the Add Element
 * library is never empty before a real catalog exists. Swapping in an
 * AAS-backed provider later only touches this file.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CatalogEntry } from './types.js';
import { LocalSeedCatalogProvider } from './localSeedCatalog.js';
import { FileImportCatalogProvider } from './fileImportCatalogProvider.js';

const localSeedProvider = new LocalSeedCatalogProvider();
export const fileImportProvider = new FileImportCatalogProvider();

export interface UseCatalogEntriesResult {
  entries: CatalogEntry[];
  /** True once the imported-catalog check has resolved (avoids a seed→import flash on first paint). */
  loaded: boolean;
  /** Which provider `entries` actually came from. */
  source: 'file-import' | 'local-seed';
  /** Re-checks IndexedDB for an imported catalog — call after `FileImportCatalogProvider.importFromFile`/`clear`. */
  refresh: () => void;
}

export function useCatalogEntries(): UseCatalogEntriesResult {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [source, setSource] = useState<'file-import' | 'local-seed'>('local-seed');
  const [loaded, setLoaded] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    fileImportProvider.listEntries().then((imported) => {
      if (cancelled) return;
      if (imported.length > 0) {
        setEntries(imported);
        setSource('file-import');
      } else {
        setEntries(localSeedProvider.listEntries());
        setSource('local-seed');
      }
      setLoaded(true);
    }).catch((err) => {
      console.error('[catalog] Failed to load imported catalog, falling back to seed data:', err);
      if (cancelled) return;
      setEntries(localSeedProvider.listEntries());
      setSource('local-seed');
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  return { entries, loaded, source, refresh };
}
