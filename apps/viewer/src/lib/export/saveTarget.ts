/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where a model's exports go — a folder the user picked once, remembered.
 *
 * # Why not just download
 * The download folder is the browser's, not the project's. Exporting a model
 * five times in an afternoon means five trips from Downloads into the project
 * folder, and the file that matters is the one nobody moved yet. Picking the
 * project folder once turns "export" into "save the next version where the
 * project lives".
 *
 * # Remembered per NAME, not per file
 * The obvious key would be the source hash — and it would be wrong here: every
 * export produces a new hash, so the folder would be forgotten on the very next
 * round, which is the round it exists for. The key is the name stem with its
 * time stamp removed, so `X.ifc`, `X_2026-08-19_1259.ifc` and
 * `X_2026-08-19_1324.ifc` are one project folder, as a reader would expect.
 *
 * # Deliberately not a versioning system
 * Stamped files in a folder, nothing more (Marc, 2026-08-19). Real version
 * history belongs in a DMS/CDE; anything half-way here would look like one
 * without being one, and the files stay deletable by hand.
 *
 * # Where it does not work
 * The File System Access API is Chromium-only today. Everywhere else
 * {@link saveTargetsSupported} is false, no folder can be picked, and the
 * export keeps going through the download path — reported, never silently
 * degraded into "nothing happened".
 */

import { stripStamp } from './filename-stamp';

const DB_NAME = 'ifc-lite-save-targets';
const STORE = 'targets';

/** The slice of `FileSystemDirectoryHandle` this module uses. */
export interface DirectoryTarget {
  readonly name: string;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{
      write(data: BufferSource | Blob | string): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
}

/** Whether this browser can hand out a folder at all. */
export function saveTargetsSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * The key a folder is remembered under: the file name without its extension
 * and without a stamp this app wrote.
 *
 * `stripStamp` is shared with the export naming rather than re-implemented, so
 * the two can never disagree about what counts as a stamp — which would show up
 * as a folder that is remembered for one export and forgotten for the next.
 */
export function saveTargetKey(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  return stripStamp(stem) || stem;
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore(STORE); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  });
}

/** Remember this folder for everything that shares `key`. */
export async function rememberSaveTarget(key: string, handle: DirectoryTarget): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(handle, key) as IDBRequest<unknown> as IDBRequest<void>);
  } catch (error) {
    // A remembered folder is a convenience; losing it must not cost the export.
    console.warn('[export/saveTarget] could not remember the folder:', error);
  }
}

/** The folder remembered for `key`, or null. Says nothing about permission. */
export async function loadSaveTarget(key: string): Promise<DirectoryTarget | null> {
  try {
    return (await withStore<DirectoryTarget | undefined>('readonly', (store) => store.get(key))) ?? null;
  } catch (error) {
    console.warn('[export/saveTarget] could not read the folder:', error);
    return null;
  }
}

export async function forgetSaveTarget(key: string): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(key) as IDBRequest<undefined> as IDBRequest<void>);
  } catch (error) {
    console.warn('[export/saveTarget] could not forget the folder:', error);
  }
}

/**
 * Whether the app may still write into a remembered folder.
 *
 * A handle survives a reload, its PERMISSION does not: the browser re-asks, and
 * only inside a user gesture. `prompt: false` therefore answers honestly
 * without a popup, for deciding whether to offer "save here" at all; the ask
 * happens on the click.
 */
export async function ensureWritable(
  target: DirectoryTarget,
  options: { prompt?: boolean } = {},
): Promise<boolean> {
  const descriptor = { mode: 'readwrite' } as const;
  const current = await target.queryPermission?.(descriptor);
  if (current === 'granted') return true;
  if (!options.prompt) return false;
  return (await target.requestPermission?.(descriptor)) === 'granted';
}

/**
 * Write one file into the folder, overwriting a file of that name.
 *
 * Overwriting is the intended behaviour and not a hazard here: the stamp is
 * minute-resolution, so a collision means the same export twice within the
 * same minute.
 */
export async function writeIntoTarget(
  target: DirectoryTarget,
  fileName: string,
  content: Blob | Uint8Array | string,
): Promise<void> {
  const file = await target.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  try {
    // The same copy `downloadFile` makes: a wasm-owned `Uint8Array` may sit on
    // a `SharedArrayBuffer`, which is not a `BlobPart`.
    const payload = content instanceof Uint8Array ? new Blob([new Uint8Array(content)]) : content;
    await writable.write(payload);
  } finally {
    await writable.close();
  }
}
