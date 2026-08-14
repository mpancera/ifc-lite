/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keeping the Fachklassen catalogue between sessions.
 *
 * IndexedDB and not localStorage: thirteen hundred entries with their
 * definitions run to most of a megabyte, which is a fifth of the whole
 * localStorage budget for one document that is not even the user's data.
 *
 * ONE document under one key, not a row per class. It is fetched and replaced
 * whole, never edited in place, so a store keyed by class id would be a
 * thousand writes to express one.
 *
 * Mirrors the open/upgrade/recovery shape of `lib/catalog/idbCatalogStorage`
 * without sharing code with it: different database, different lifetime, and
 * that module's helpers are not exported.
 */

import { parseClassCatalog, type ClassCatalog } from './classCatalog.js';

const DB_NAME = 'ifc-lite-class-catalog';
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
      console.error('[classCatalog/idb] Failed to open database:', request.error);
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
export async function loadStoredClassCatalog(): Promise<ClassCatalog | null> {
  try {
    const db = await openDatabase();
    return await new Promise<ClassCatalog | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onerror = () => reject(request.error);
      // Re-parsed rather than trusted: what was written by an older version of
      // this app is data like any other, and the parser is where the shape is
      // decided.
      request.onsuccess = () => resolve(
        request.result ? parseClassCatalog(request.result, undefined, undefined) : null,
      );
    });
  } catch (error) {
    console.error('[classCatalog/idb] Read failed:', error);
    return null;
  }
}

/** Replace the stored catalogue. */
export async function storeClassCatalog(catalog: ClassCatalog): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    // The whole document, so a shrinking catalogue really shrinks.
    tx.objectStore(STORE).put({ ...catalog, classes: catalog.entries }, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Forget it, for a settings action that wants to start clean. */
export async function clearStoredClassCatalog(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('[classCatalog/idb] Clear failed:', error);
  }
}
