/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IndexedDB-backed storage for authoring snapshots, so closing a tab stops
 * losing a planning state. Stays entirely on the machine — no server, no
 * upload; the same constraint the imported catalog is held to.
 *
 * Keyed by the source file's SHA-256 rather than its name, because a name says
 * nothing about content: two revisions ship as the same file name all the time,
 * and restoring one revision's work onto another silently reattaches edits to
 * the wrong entities. A hash key means the exact-match case is provably exact,
 * and everything else is explicitly a different file.
 *
 * Mirrors `catalog/idbCatalogStorage.ts`'s open/upgrade/recovery pattern
 * (different database, and those helpers are not exported for reuse).
 */

import type { OverlaySnapshot } from './types';

const DB_NAME = 'ifc-lite-authoring';
/** Bump when the object store shape changes; extend `onupgradeneeded` below. */
const DB_VERSION = 1;
const STORE_SNAPSHOTS = 'overlay-snapshots';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error('[authoring/idb] Failed to open database:', request.error);
      dbPromise = null;
      reject(request.error);
    };
    request.onupgradeneeded = (event) => {
      const db = request.result;
      switch (event.oldVersion) {
        case 0:
          db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'sourceHash' });
          break;
        default:
          break;
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.close();
        dbPromise = null;
        const del = indexedDB.deleteDatabase(DB_NAME);
        del.onsuccess = () => openDatabase().then(resolve).catch(reject);
        del.onerror = () => reject(new Error('Failed to recreate authoring database.'));
        del.onblocked = () => reject(new Error(
          'Authoring database recreation is blocked by another open tab. Close other tabs and reload.',
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
    const transaction = db.transaction(STORE_SNAPSHOTS, mode);
    const request = run(transaction.objectStore(STORE_SNAPSHOTS));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

/** The snapshot authored against this exact file, if one was saved. */
export async function loadSnapshot(sourceHash: string): Promise<OverlaySnapshot | null> {
  try {
    const found = await tx<OverlaySnapshot | undefined>('readonly', (s) => s.get(sourceHash));
    return found ?? null;
  } catch (err) {
    console.warn('[authoring/idb] load failed:', err);
    return null;
  }
}

/**
 * Every saved snapshot, newest first — the candidates to reconcile against
 * when the open file has no exact match of its own.
 */
export async function listSnapshots(): Promise<OverlaySnapshot[]> {
  try {
    const all = await tx<OverlaySnapshot[]>('readonly', (s) => s.getAll());
    return [...all].sort((a, b) => b.savedAt - a.savedAt);
  } catch (err) {
    console.warn('[authoring/idb] list failed:', err);
    return [];
  }
}

/** Write (or replace) the snapshot for its source file. */
export async function saveSnapshot(snapshot: OverlaySnapshot): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(snapshot));
  } catch (err) {
    // Autosave must never interrupt authoring — a quota or private-mode
    // failure costs persistence, not the session.
    console.warn('[authoring/idb] save failed:', err);
  }
}

export async function deleteSnapshot(sourceHash: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(sourceHash));
  } catch (err) {
    console.warn('[authoring/idb] delete failed:', err);
  }
}

export async function clearSnapshots(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch (err) {
    console.warn('[authoring/idb] clear failed:', err);
  }
}
