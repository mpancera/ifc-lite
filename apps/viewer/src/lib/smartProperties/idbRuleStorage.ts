/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Persists edited rules, so a naming scheme outlives the tab it was defined
 * in. Local only, like every other store in this fork.
 *
 * Rules are held as a set that REPLACES the shipped defaults once anything has
 * been saved — not merged. Merging would make "I deleted that rule" mean
 * "it comes back next reload", which is the kind of surprise that erodes trust
 * in a rules feature specifically.
 */

import type { SmartPropertyRule } from './types';

const DB_NAME = 'ifc-lite-smart-properties';
/** Bump when the object store shape changes; extend `onupgradeneeded` below. */
const DB_VERSION = 1;
const STORE = 'rules';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error('[smartProperties/idb] Failed to open database:', request.error);
      dbPromise = null;
      reject(request.error);
    };
    request.onupgradeneeded = (event) => {
      const db = request.result;
      switch (event.oldVersion) {
        case 0:
          db.createObjectStore(STORE, { keyPath: 'id' });
          break;
        default:
          break;
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        dbPromise = null;
        const del = indexedDB.deleteDatabase(DB_NAME);
        del.onsuccess = () => openDatabase().then(resolve).catch(reject);
        del.onerror = () => reject(new Error('Failed to recreate the rules database.'));
        del.onblocked = () => reject(new Error(
          'Rules database recreation is blocked by another open tab. Close other tabs and reload.',
        ));
        return;
      }
      resolve(db);
    };
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

/** Saved rules, or `null` when nothing has been saved and defaults apply. */
export async function loadStoredRules(): Promise<SmartPropertyRule[] | null> {
  try {
    const all = await tx<SmartPropertyRule[]>('readonly', (s) => s.getAll());
    return all.length > 0 ? all : null;
  } catch (err) {
    console.warn('[smartProperties/idb] load failed:', err);
    return null;
  }
}

/** Replace the stored set wholesale — see the note on merging above. */
export async function saveRules(rules: readonly SmartPropertyRule[]): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      store.clear();
      for (const rule of rules) store.put(rule);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.warn('[smartProperties/idb] save failed:', err);
  }
}

/** Forget every edit and fall back to the shipped defaults. */
export async function clearStoredRules(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch (err) {
    console.warn('[smartProperties/idb] clear failed:', err);
  }
}
