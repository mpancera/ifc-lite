/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The models a clip plays against.
 *
 * # Where a file comes from
 * Either the person at the keyboard uploaded it (kept in their browser, see
 * `demoFileStore.ts`) or the server serves it out of the git-ignored
 * `public/demo-local/`. The upload is asked first: on the machine where a clip
 * is actually presented, that folder is usually empty. The slots themselves
 * live in `demoFiles.ts` and are re-exported here, so existing importers are
 * unaffected.
 *
 * # Why not the committed sample building
 * The sample has no rooms worth naming and no fire-detection model at all.
 * Most of the series is about exactly those two things, so a clip against the
 * sample would demonstrate the interface and none of the argument.
 */

import { EVENT_ADD_MODEL, EVENT_LOAD_FILE } from '@/lib/tours/events';
import { DEMO_FILES, type DemoFileId } from './demoFiles';
import { readStoredDemoFile, storedDemoFileIds } from './demoFileStore';

export { DEMO_FILES, isDemoFileId, type DemoFileId } from './demoFiles';

export class MissingDemoFileError extends Error {
  constructor(public readonly fileId: DemoFileId, status: number) {
    const { path, name } = DEMO_FILES[fileId];
    super(
      `Screenflow-Datei fehlt: ${name} (HTTP ${status}). `
      + `Erwartet unter apps/viewer/public${path}, oder im Demo-Flows-Panel hochladen `
      + '- der Ordner ist absichtlich nicht im Repository.',
    );
    this.name = 'MissingDemoFileError';
  }
}

/**
 * The file for a slot: what the user uploaded, else what the server serves.
 *
 * Upload first, and not as a cache layer. On the machine where these clips are
 * actually presented `public/demo-local/` is empty — that folder is a
 * convenience for the machine the clips were built on — so the uploaded copy
 * is usually the only one that exists.
 */
async function fetchDemoFile(fileId: DemoFileId): Promise<File> {
  const stored = await readStoredDemoFile(fileId);
  if (stored) return stored;

  const { path, name } = DEMO_FILES[fileId];
  const res = await fetch(path);
  // A 404 and a page of HTML mean the same thing: the file is not there. The
  // dev server answers an unknown path with the SPA shell and a 200, and
  // without this check the clip walks into the parser with index.html.
  if (!res.ok || looksLikeSpaFallback(res)) throw new MissingDemoFileError(fileId, res.status);
  return new File([await res.blob()], name, { type: 'application/x-step' });
}

/** Replace whatever is loaded with this file (the user-open path). */
export async function openDemoFile(fileId: DemoFileId): Promise<void> {
  const file = await fetchDemoFile(fileId);
  window.dispatchEvent(new CustomEvent(EVENT_LOAD_FILE, { detail: file }));
}

/** Federate this file onto what is already loaded (the add-model path). */
export async function addDemoFile(fileId: DemoFileId): Promise<void> {
  const file = await fetchDemoFile(fileId);
  window.dispatchEvent(new CustomEvent(EVENT_ADD_MODEL, { detail: file }));
}

/**
 * Register a drawing as a reference underlay, through the same ingest the
 * drag-and-drop path uses. A drawing is not a model: it never becomes an
 * entry in the model list, and nothing in it can be selected.
 */
export async function underlayDemoFile(fileId: DemoFileId): Promise<void> {
  const file = await fetchDemoFile(fileId);
  const { ingestDxfFile } = await import('@/hooks/ingest/dxfIngest');
  await ingestDxfFile(file);
}

/**
 * A 200 is not proof the file exists.
 *
 * The dev server answers an unknown path with the single-page app's
 * `index.html` and a 200, so a plain `res.ok` check reports every missing
 * model as present and the clip walks into the parser with a page of HTML.
 * The content type is what actually distinguishes the two.
 */
export function looksLikeSpaFallback(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

/**
 * Which of these files are missing. The stage runs this before it starts a
 * clip, so a missing file is a refusal to start rather than a dead take in
 * front of a running recorder.
 */
export async function missingDemoFiles(ids: readonly DemoFileId[]): Promise<DemoFileId[]> {
  // Asked once for the whole set rather than per file: this runs every time
  // the launcher opens, and a slot the user filled must count as present or
  // the panel goes on offering an upload for a file it already has.
  const uploaded = new Set(await storedDemoFileIds());
  const missing: DemoFileId[] = [];
  for (const id of ids) {
    if (uploaded.has(id)) continue;
    try {
      const res = await fetch(DEMO_FILES[id].path, { method: 'HEAD' });
      if (!res.ok || looksLikeSpaFallback(res)) missing.push(id);
    } catch {
      // A network-level failure and a 404 mean the same thing here: not there.
      missing.push(id);
    }
  }
  return missing;
}
