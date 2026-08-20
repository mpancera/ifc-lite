/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Demo data supplied by the person at the keyboard, kept in their browser.
 *
 * # Why the browser and not the disk
 * The files a clip plays against are real buildings. `public/demo-local/` is
 * git-ignored, which keeps them out of commits — but Vite copies `public/`
 * verbatim into every build, so a model sitting there is downloadable from any
 * deployment at a predictable URL. Storing them here instead means they live
 * in one browser profile on one machine, reachable by nothing else, and the
 * repository has no path they could travel along at all.
 *
 * # Why it is not a cache
 * The stored file is the source, not a copy of one: on a machine where
 * `public/demo-local/` is empty — the normal case, and the only case on a work
 * laptop — it is the only place the file exists. So it is read BEFORE the
 * network rather than after, and nothing here expires anything.
 *
 * The open/upgrade/recovery shape mirrors `lib/catalog/idbCatalogStorage.ts`;
 * separate database, and that module's helpers are not exported for reuse.
 */

import { DEMO_FILES, isDemoFileId, type DemoFileId } from './demoFiles';

const DB_NAME = 'ifc-lite-screenflow-demo';
/** Bump when the object store shape changes; extend `onupgradeneeded` below. */
const DB_VERSION = 1;
const STORE_FILES = 'demo-files';

interface StoredDemoFile {
  /** The {@link DemoFileId} the clip asks for. */
  id: string;
  /** The name the viewer will show — and therefore what ends up in the video. */
  name: string;
  blob: Blob;
  storedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error('[screenflow/demo-files] Failed to open database:', request.error);
      dbPromise = null;
      reject(request.error);
    };
    request.onupgradeneeded = (event) => {
      const db = request.result;
      switch (event.oldVersion) {
        case 0:
          db.createObjectStore(STORE_FILES, { keyPath: 'id' });
          break;
        default:
          break;
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.close();
        dbPromise = null;
        const del = indexedDB.deleteDatabase(DB_NAME);
        del.onsuccess = () => openDatabase().then(resolve).catch(reject);
        del.onerror = () => reject(new Error('Failed to recreate the demo-file database.'));
        del.onblocked = () => reject(new Error(
          'Demo-file database recreation is blocked by another open tab. Close other tabs and reload.',
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
    const tx = db.transaction(STORE_FILES, mode);
    const store = tx.objectStore(STORE_FILES);
    let value: unknown;
    const req = fn(store);
    if (req instanceof IDBRequest) {
      req.onsuccess = () => { value = req.result; };
      req.onerror = () => reject(req.error);
    }
    tx.oncomplete = () => resolve(value as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * The uploaded file for this slot, or `null`.
 *
 * A storage failure answers `null` rather than throwing: not having the file
 * is a state every caller already handles, and a browser with IndexedDB
 * disabled should fall through to the network path, not break the launcher.
 */
export async function readStoredDemoFile(fileId: DemoFileId): Promise<File | null> {
  try {
    const db = await openDatabase();
    const row = await runStore<StoredDemoFile | undefined>(db, 'readonly', (store) => store.get(fileId));
    if (!row) return null;
    return new File([row.blob], row.name, { type: row.blob.type });
  } catch (err) {
    console.error('[screenflow/demo-files] read failed:', err);
    return null;
  }
}

/**
 * Put a file in a slot, replacing whatever was there.
 *
 * The stored name is the SLOT's name, never the uploaded file's. The slot
 * names are generic on purpose — they are what the viewer's model list shows
 * and therefore what is burned into the finished video, and a file picked off
 * a work laptop is named after the project it came from.
 */
export async function storeDemoFile(fileId: DemoFileId, file: Blob): Promise<void> {
  const db = await openDatabase();
  const row: StoredDemoFile = {
    id: fileId,
    name: DEMO_FILES[fileId].name,
    blob: file,
    storedAt: Date.now(),
  };
  await runStore(db, 'readwrite', (store) => store.put(row));
}

/** Forget one uploaded file. */
export async function removeStoredDemoFile(fileId: DemoFileId): Promise<void> {
  const db = await openDatabase();
  await runStore(db, 'readwrite', (store) => store.delete(fileId));
}

/** Which slots currently hold an uploaded file. */
export async function storedDemoFileIds(): Promise<DemoFileId[]> {
  try {
    const db = await openDatabase();
    const keys = await runStore<IDBValidKey[]>(db, 'readonly', (store) => store.getAllKeys());
    // Filtered rather than cast: the database outlives the code, so a key
    // from a slot that has since been renamed away must not be handed back
    // as a live id.
    return keys.filter(isDemoFileId);
  } catch (err) {
    console.error('[screenflow/demo-files] listing failed:', err);
    return [];
  }
}
