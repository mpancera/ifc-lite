/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Putting a derived file where it belongs.
 *
 * With a folder bound, that is the project folder: the reading side looks for
 * these files there, and a download folder is not there. Without one — no
 * binding, or a browser without the API — it stays a download, because the
 * alternative is refusing to export at all.
 *
 * ## Why this is one function
 *
 * Both call sites have the same four-way outcome (written, replaced,
 * downloaded because nothing is bound, downloaded because access was refused),
 * and the interesting one is the last. A silent fall back to the download
 * folder is the failure mode worth designing against: somebody clicks export,
 * sees a success message, and the file the other application is waiting for
 * never appears. So the result says which path was taken, and the caller says
 * so out loud.
 *
 * ## Overwriting is the point
 *
 * These files are derived. A second export of the same thing must update it,
 * not accumulate `dc.heights (3).json` — a folder full of near-identical
 * exports is worse than no export, because then nobody knows which is current.
 * The result distinguishes `replaced` from `written` so a person can see that
 * something was already there.
 */

import { folderHasFile, restoreFolderAccess, writeFileToFolder } from '@ifc-lite/project';
import type { FolderBinding } from '@ifc-lite/project';
import { downloadFile } from '@/lib/export/download';

export type SidecarSaveResult =
  /** Landed in the bound folder. */
  | { to: 'folder'; folder: string; replaced: boolean }
  /** No folder is bound, so it went to the browser's downloads. */
  | { to: 'download'; reason: 'no-folder' }
  /** A folder is bound but the browser would not grant access to it. */
  | { to: 'download'; reason: 'no-permission' };

/**
 * Write a sidecar into the bound folder, or download it.
 *
 * **Must be called from a user gesture.** A remembered folder does not carry a
 * standing right to write, and asking for it again only works inside one — the
 * export click is that gesture.
 */
export async function saveSidecar(
  folder: FolderBinding | null,
  fileName: string,
  contents: string,
): Promise<SidecarSaveResult> {
  if (!folder) {
    downloadFile(contents, fileName, 'application/json');
    return { to: 'download', reason: 'no-folder' };
  }

  // The click is the gesture, so this is the one moment access can be asked
  // for. Granted already? Then it returns straight away without prompting.
  const permission = await restoreFolderAccess(folder.handle, 'readwrite');
  if (permission !== 'granted') {
    downloadFile(contents, fileName, 'application/json');
    return { to: 'download', reason: 'no-permission' };
  }

  // Asked BEFORE writing — afterwards the answer is always yes and says
  // nothing about what was there a moment ago.
  const replaced = await folderHasFile(folder.handle, fileName);
  await writeFileToFolder(folder.handle, fileName, contents);
  return { to: 'folder', folder: folder.label?.trim() || folder.name, replaced };
}

/** One line a person can act on. Never just "exported": which of the four
 *  outcomes happened is the whole information. */
export function describeSidecarSave(fileName: string, result: SidecarSaveResult): string {
  if (result.to === 'folder') {
    return `${fileName} ${result.replaced ? 'ersetzt' : 'geschrieben'} in ${result.folder}`;
  }
  return result.reason === 'no-folder'
    ? `${fileName} heruntergeladen — kein Projektordner gebunden`
    : `${fileName} heruntergeladen — kein Schreibzugriff auf den Projektordner`;
}
