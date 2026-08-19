/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keeping the symbol catalogue between sessions.
 *
 * IndexedDB and not localStorage, following `classCatalogStorage` and for a
 * sharper version of its reason: this document carries the SVG source of every
 * symbol, so it is the drawings and not the list that decide its size.
 *
 * ONE document under one key. It is fetched and replaced whole, never edited,
 * so a store keyed per symbol would be a hundred writes to express one.
 */

import { parseSymbolCatalog, type SymbolCatalog } from './symbolCatalog.js';

const DB_NAME = 'ifc-lite-symbol-catalog';
/** Bump when the stored shape changes; extend `onupgradeneeded` below. */
const DB_VERSION = 1;
const STORE = 'catalog';
const KEY = 'current';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error('[symbolCatalog/idb] Failed to open database:', request.error);
      // Cleared so a later call can try again — a transient failure (private
      // browsing, a quota prompt) should not poison the rest of the session.
      dbPromise = null;
      reject(request.error);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
}

/** The stored catalogue, or `null` when none was ever synced. */
export async function loadStoredSymbolCatalog(): Promise<SymbolCatalog | null> {
  try {
    const db = await openDatabase();
    return await new Promise<SymbolCatalog | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const stored = request.result as
          | { symbols?: unknown; fetchedAt?: string; source?: string; drawings?: unknown }
          | undefined;
        if (!stored) { resolve(null); return; }
        // Re-parsed rather than trusted: what an older version of this app
        // wrote is data like any other, and the parser decides the shape.
        resolve(parseSymbolCatalog(
          stored,
          stored.source,
          stored.fetchedAt,
          (stored.drawings ?? {}) as Readonly<Record<string, string>>,
        ));
      };
    });
  } catch (error) {
    console.error('[symbolCatalog/idb] Read failed:', error);
    return null;
  }
}

/** Replace the stored catalogue. */
export async function storeSymbolCatalog(catalog: SymbolCatalog): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    // Written under `symbols` so the stored document reads like the fetched
    // one, and the same parser can be pointed at either.
    tx.objectStore(STORE).put({
      symbols: catalog.entries,
      fetchedAt: catalog.fetchedAt,
      source: catalog.source,
      drawings: catalog.drawings,
    }, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Forget it, for a settings action that wants to start clean. */
export async function clearStoredSymbolCatalog(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('[symbolCatalog/idb] Clear failed:', error);
  }
}
