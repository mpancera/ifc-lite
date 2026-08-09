/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Remembering bound folders across restarts.
 *
 * **IndexedDB, not localStorage.** A `FileSystemDirectoryHandle` is
 * structured-clonable, which is exactly what IndexedDB stores and exactly what
 * localStorage cannot: that only takes strings, and a handle has no string
 * form (see `folder.ts` — there is no path).
 *
 * The pure list operations are separated from the storage so they can be
 * tested without a browser; only `loadBindings`/`saveBindings` touch IndexedDB.
 */

import type { FolderBinding } from './folder.js';

const DB_NAME = 'ifc-lite-projects';
const DB_VERSION = 1;
const STORE = 'folders';
const KEY = 'bindings';

/** How many unpinned entries survive. Pinned ones always do. */
export const MAX_UNPINNED = 8;

// ── list rules (pure) ───────────────────────────────────────────────────

/**
 * Put a binding at the front, replacing any earlier entry for the same folder.
 *
 * Matched on `id`, not on `name`: two folders can share a name, and the same
 * folder can be renamed. The id is what the store issued.
 */
export function rememberBinding(
  bindings: readonly FolderBinding[],
  binding: FolderBinding,
): FolderBinding[] {
  const rest = bindings.filter((b) => b.id !== binding.id);
  return evictUnpinned([binding, ...rest]);
}

/** Drop the oldest unpinned entries past {@link MAX_UNPINNED}. Pinned entries
 *  are kept whatever their age — that is what pinning means. */
export function evictUnpinned(bindings: readonly FolderBinding[]): FolderBinding[] {
  let unpinnedSeen = 0;
  return bindings.filter((b) => {
    if (b.pinned) return true;
    unpinnedSeen += 1;
    return unpinnedSeen <= MAX_UNPINNED;
  });
}

/** Apply a patch to one binding, leaving the list order alone. */
export function updateBinding(
  bindings: readonly FolderBinding[],
  id: string,
  patch: Partial<Pick<FolderBinding, 'label' | 'pinned' | 'lastOpenedAt'>>,
): FolderBinding[] {
  return bindings.map((b) => (b.id === id ? { ...b, ...patch } : b));
}

/** Forget one binding. Does not touch the folder on disk. */
export function forgetBinding(
  bindings: readonly FolderBinding[],
  id: string,
): FolderBinding[] {
  return bindings.filter((b) => b.id !== id);
}

/**
 * Find the binding for a handle already held.
 *
 * `isSameEntry` is the only correct comparison — two handles to one folder are
 * different objects, and the name is not unique. It is async, hence this is
 * too.
 */
export async function findBindingForHandle(
  bindings: readonly FolderBinding[],
  handle: FileSystemDirectoryHandle,
): Promise<FolderBinding | undefined> {
  for (const binding of bindings) {
    if (await binding.handle.isSameEntry(handle)) return binding;
  }
  return undefined;
}

// ── storage ─────────────────────────────────────────────────────────────

/** Everything remembered, newest first. Empty when nothing is stored yet. */
export async function loadBindings(): Promise<FolderBinding[]> {
  const db = await openDb();
  try {
    const stored = await request<FolderBinding[] | undefined>(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY),
    );
    return stored ?? [];
  } finally {
    db.close();
  }
}

/** Replace what is stored. The list operations above produce the argument. */
export async function saveBindings(bindings: readonly FolderBinding[]): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await request(tx.objectStore(STORE).put([...bindings], KEY));
    await done(tx);
  } finally {
    db.close();
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error(`Cannot open ${DB_NAME}.`));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed.'));
  });
}

/** Resolves when the transaction commits — a `put` that resolved can still be
 *  rolled back if the transaction then aborts. */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
  });
}
