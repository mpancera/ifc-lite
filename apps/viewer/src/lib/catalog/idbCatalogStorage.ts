/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IndexedDB-backed storage for a user-imported catalog — so picking a
 * "Firmenbibliothek" JSON file once persists across reloads without ever
 * writing the (potentially confidential) product data to disk in a form
 * this repo tracks. Mirrors the structure of
 * `services/extensions/idb-storage.ts` (open/upgrade/recovery pattern)
 * without sharing code with it — different database, and the extensions
 * store's helpers aren't exported for reuse.
 */

import type { CatalogEntry } from './types.js';

const DB_NAME = 'ifc-lite-catalog';
/** Bump when the object store shape changes; extend `onupgradeneeded` below. */
const DB_VERSION = 1;
const STORE_ENTRIES = 'imported-entries';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error('[catalog/idb] Failed to open database:', request.error);
      dbPromise = null;
      reject(request.error);
    };
    request.onupgradeneeded = (event) => {
      const db = request.result;
      switch (event.oldVersion) {
        case 0:
          db.createObjectStore(STORE_ENTRIES, { keyPath: 'id' });
          break;
        default:
          break;
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.close();
        dbPromise = null;
        const del = indexedDB.deleteDatabase(DB_NAME);
        del.onsuccess = () => openDatabase().then(resolve).catch(reject);
        del.onerror = () => reject(new Error('Failed to recreate catalog database.'));
        del.onblocked = () => reject(new Error(
          'Catalog database recreation is blocked by another open tab. Close other tabs and reload.',
        ));
        return;
      }
      resolve(db);
    };
  });
  return dbPromise;
}

function runStore<T = unknown>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest | void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_ENTRIES, mode);
    const store = tx.objectStore(STORE_ENTRIES);
    let value: unknown;
    const req = fn(store);
    if (req instanceof IDBRequest) {
      req.onsuccess = () => {
        value = req.result;
      };
      req.onerror = () => reject(req.error);
    }
    tx.oncomplete = () => resolve(value as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadImportedCatalog(): Promise<CatalogEntry[]> {
  const db = await openDatabase();
  return runStore<CatalogEntry[]>(db, 'readonly', (store) => store.getAll());
}

/** Replaces the whole stored catalog with `entries` (clear + bulk put in one transaction). */
export async function saveImportedCatalog(entries: CatalogEntry[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ENTRIES, 'readwrite');
    const store = tx.objectStore(STORE_ENTRIES);
    store.clear();
    for (const entry of entries) store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearImportedCatalog(): Promise<void> {
  const db = await openDatabase();
  await runStore(db, 'readwrite', (store) => store.clear());
}
