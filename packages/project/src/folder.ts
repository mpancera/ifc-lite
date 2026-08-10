/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/// <reference path="./file-system-access.d.ts" />

/**
 * Binding a project to a folder on disk.
 *
 * ## There is no path, for anybody
 *
 * The File System Access API hands out **no filesystem path** — not `C:\…`,
 * not anything comparable. A handle knows its own name and nothing else. That
 * is a deliberate browser decision: a page should not learn how the device is
 * laid out.
 *
 * So "remember the folder path" is not a thing any browser application can do,
 * and an application that appears to do it is showing something it made up.
 * What IS achievable, and what this module provides, is a durable BINDING: the
 * same folder can be reopened after a restart, recognised, and given a name by
 * the person using it.
 *
 * Two folders called `Planung` are therefore indistinguishable by name. The
 * substitute is `label` — chosen by a person, who knows which is which.
 *
 * ## Permission is not durable, and that is on purpose
 *
 * A stored handle does not carry a standing right to read. On the next visit
 * the browser reports `prompt`, and `requestPermission()` only succeeds inside
 * a real user gesture. Checking and restoring are therefore two separate
 * operations here — {@link folderPermission} may be called at any time,
 * {@link restoreFolderAccess} only from a click. Silently regaining access to
 * somebody's disk on page load would not be desirable even if it worked.
 */

import type { ProjectKey } from './key.js';

/** A folder a project is bound to. */
export interface FolderBinding {
  /** Stable across renames of the folder; the key in the store. */
  id: string;
  /**
   * The project this folder IS.
   *
   * The whole reason a binding is stored rather than recreated. Reopening a
   * remembered folder hands back the same key, so the height system, the
   * zones and the lists that were derived in it are recognised as belonging
   * to it — and everything derived in a DIFFERENT project is recognised as
   * not belonging.
   */
  projectKey: ProjectKey;
  /** The live handle. Structured-clonable, so it survives in IndexedDB. */
  handle: FileSystemDirectoryHandle;
  /** The folder's own name, as the browser reports it. */
  name: string;
  /** Chosen by a person. The substitute for the path that does not exist. */
  label?: string;
  /** Kept across the eviction of unpinned entries. */
  pinned: boolean;
  /** ISO-8601. */
  lastOpenedAt: string;
}

/** `granted` — usable now. `prompt` — needs a gesture. `denied` — refused. */
export type FolderPermission = PermissionState;

/** What to show for a binding: the person's label, else the folder name. */
export function folderDisplayName(binding: Pick<FolderBinding, 'name' | 'label'>): string {
  const label = binding.label?.trim();
  return label || binding.name;
}

/** Whether this browser can bind a folder at all.
 *
 *  Chromium has the picker; Firefox and Safari do not. Callers use this to
 *  offer something else rather than to show a button that cannot work. */
export function canBindFolder(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/**
 * Ask a person to choose a folder. Needs a user gesture.
 *
 * Returns `null` when they cancel — a cancelled picker is an answer, not a
 * failure, and making callers catch an exception for it invites an empty
 * `catch` that then swallows the real errors too.
 */
export async function pickFolder(
  options: { mode?: 'read' | 'readwrite'; id?: string } = {},
): Promise<FileSystemDirectoryHandle | null> {
  if (!canBindFolder()) {
    throw new Error('This browser cannot open a folder (File System Access API missing).');
  }

  try {
    return await window.showDirectoryPicker!({ mode: options.mode ?? 'readwrite', id: options.id });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

/** What the browser currently grants on this handle. No gesture needed. */
export async function folderPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<FolderPermission> {
  return handle.queryPermission({ mode });
}

/** Ask for access again. **Only works from inside a user gesture.** */
export async function restoreFolderAccess(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<FolderPermission> {
  const current = await handle.queryPermission({ mode });
  if (current === 'granted') return current;
  return handle.requestPermission({ mode });
}

/**
 * Write a file into the bound folder, replacing what was there.
 *
 * Overwriting is the intended behaviour: these files are derived, and a second
 * export of the same thing should update it rather than accumulate
 * `heights (3).json`. The caller decides WHEN, so it stays a deliberate act.
 */
export async function writeFileToFolder(
  folder: FileSystemDirectoryHandle,
  fileName: string,
  contents: string,
  options: { dir?: string } = {},
): Promise<void> {
  // Created on demand: writing the first sidecar into a folder that has never
  // held one must work without a separate setup step.
  const place = options.dir
    ? await folder.getDirectoryHandle(options.dir, { create: true })
    : folder;
  const fileHandle = await place.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(contents);
  } finally {
    // Without close() the write never lands. In a `finally` so a failed write
    // does not also leak the lock on the file.
    await writable.close();
  }
}

/** Whether the folder already holds this file. For "this will replace an
 *  existing file" before writing one. */
export async function folderHasFile(
  folder: FileSystemDirectoryHandle,
  fileName: string,
  options: { dir?: string } = {},
): Promise<boolean> {
  try {
    const place = options.dir ? await folder.getDirectoryHandle(options.dir) : folder;
    await place.getFileHandle(fileName);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return false;
    throw err;
  }
}
