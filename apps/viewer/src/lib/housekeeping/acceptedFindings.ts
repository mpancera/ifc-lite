/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Remembering which findings the user has deliberately let stand.
 *
 * # Keyed by the project's own GlobalId
 * A model id is a session uuid — it is different the next time the same file
 * is opened, so acceptances stored under it would evaporate at exactly the
 * moment they were meant to help. `IfcProject.GlobalId` is in the file, is
 * stable across openings, and is a GUID rather than anything about the
 * project, which matters because this key is written to the browser.
 *
 * Without a project GlobalId nothing is persisted and the acceptance lives for
 * the session. That is the honest failure: a wrong key would silently apply
 * one file's decisions to another.
 *
 * localStorage and not IndexedDB: this is a handful of short strings, and it
 * has to be readable synchronously while the plan renders.
 */

const PREFIX = 'ifc-lite/housekeeping-accepted/';

function key(projectGlobalId: string): string {
  return `${PREFIX}${projectGlobalId}`;
}

/** What the user accepted for this project, or an empty set. */
export function loadAcceptedFindings(projectGlobalId: string | null): Set<string> {
  if (!projectGlobalId) return new Set();
  try {
    const raw = localStorage.getItem(key(projectGlobalId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === 'string'))
      : new Set();
  } catch (error) {
    // A quota prompt, private browsing, or a value some older version wrote.
    // An unreadable memory of what was accepted is the same as none.
    console.warn('[housekeeping] Could not read accepted findings:', error);
    return new Set();
  }
}

/** Replace what is remembered. A no-op where there is no stable key. */
export function storeAcceptedFindings(
  projectGlobalId: string | null,
  accepted: ReadonlySet<string>,
): void {
  if (!projectGlobalId) return;
  try {
    if (accepted.size === 0) localStorage.removeItem(key(projectGlobalId));
    else localStorage.setItem(key(projectGlobalId), JSON.stringify([...accepted]));
  } catch (error) {
    console.warn('[housekeeping] Could not store accepted findings:', error);
  }
}
