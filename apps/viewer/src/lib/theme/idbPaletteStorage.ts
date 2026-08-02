/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Persists the loaded palette, so a deployment keeps its look across reloads
 * without the colours ever being compiled into this repository.
 *
 * Mirrors `catalog/idbCatalogStorage.ts`'s open/upgrade/recovery pattern
 * (different database; those helpers are not exported for reuse).
 */

import type { ColorPalette } from './palette';

const DB_NAME = 'ifc-lite-theme';
/** Bump when the object store shape changes; extend `onupgradeneeded` below. */
const DB_VERSION = 1;
const STORE = 'palette';
/** Single-row store: one palette is active at a time. */
const ACTIVE_KEY = 'active';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error('[theme/idb] Failed to open database:', request.error);
      dbPromise = null;
      reject(request.error);
    };
    request.onupgradeneeded = (event) => {
      const db = request.result;
      switch (event.oldVersion) {
        case 0:
          db.createObjectStore(STORE);
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
        del.onerror = () => reject(new Error('Failed to recreate theme database.'));
        del.onblocked = () => reject(new Error(
          'Theme database recreation is blocked by another open tab. Close other tabs and reload.',
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

export async function loadActivePalette(): Promise<ColorPalette | null> {
  try {
    const found = await tx<ColorPalette | undefined>('readonly', (s) => s.get(ACTIVE_KEY));
    return found ?? null;
  } catch (err) {
    // A palette is cosmetic — never let storage trouble stop the app booting.
    console.warn('[theme/idb] load failed:', err);
    return null;
  }
}

export async function saveActivePalette(palette: ColorPalette): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(palette, ACTIVE_KEY));
  } catch (err) {
    console.warn('[theme/idb] save failed:', err);
  }
}

export async function clearActivePalette(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(ACTIVE_KEY));
  } catch (err) {
    console.warn('[theme/idb] clear failed:', err);
  }
}
