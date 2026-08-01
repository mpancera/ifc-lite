/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * React entry point for the element catalog. Single hard-coded provider
 * today (`LocalSeedCatalogProvider`); swapping in an AAS-backed provider
 * later is a one-line change here, not a UI rewrite — `listEntries()` is
 * already async-shaped for that reason.
 */

import { useEffect, useState } from 'react';
import type { CatalogEntry, CatalogProvider } from './types.js';
import { LocalSeedCatalogProvider } from './localSeedCatalog.js';

const activeProvider: CatalogProvider = new LocalSeedCatalogProvider();

export function useCatalogEntries(): CatalogEntry[] {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(activeProvider.listEntries()).then((result) => {
      if (!cancelled) setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return entries;
}
