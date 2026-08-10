/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Persisting something that belongs to ONE project.
 *
 * Zones and annotations are statements about a particular building. Kept under
 * one shared key, opening a second project shows the first one's — not as an
 * error, but as content that looks like it belongs there. That is the same
 * failure the project key was introduced for, one layer down.
 *
 * ## What is NOT project-scoped
 *
 * Saved lists and lenses are templates: "all fire dampers with these columns"
 * is worth having in every project. Scoping those would make a person's own
 * definitions vanish on a project switch — data loss dressed as safety. They
 * stay global on purpose.
 *
 * The autosaved mutation overlay is scoped too, but on the model's byte hash
 * rather than on a project: it answers "is this the same MODEL", which is the
 * stricter question, and a project key would weaken it.
 *
 * ## Without a project
 *
 * With no key, nothing is written. There is no "unassigned" bucket, because a
 * shared bucket is exactly how the leak happens. In practice a key always
 * exists once a model is loaded — `projectKeyFromModels` sees to that — and
 * with no models there is nothing worth persisting anyway.
 */

import type { ProjectKey } from '@ifc-lite/project';

/**
 * `globalThis.localStorage`, not `window.localStorage`.
 *
 * The same object in a browser, but the narrower spelling ties this to a DOM
 * that a worker — or a test — does not have, and the slices this replaces all
 * checked the bare global.
 */
function storage(): Storage | null {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

/** The key one project's data lives under. */
export function scopedKey(base: string, project: ProjectKey): string {
  return `${base}:${project}`;
}

/**
 * Read a project's value, adopting anything left under the unscoped key.
 *
 * The migration matters more than it looks: everything written before scoping
 * existed sits under the bare key, and dropping it would silently lose zones
 * somebody drew. Adopted once, for the first project that asks, then removed —
 * leaving it would hand the same content to the next project as well, which is
 * the leak this is meant to close.
 */
export function readScoped(base: string, project: ProjectKey | null): string | null {
  const store = storage();
  if (store === null || project === null) return null;

  const scoped = store.getItem(scopedKey(base, project));
  if (scoped !== null) return scoped;

  const legacy = store.getItem(base);
  if (legacy === null) return null;

  store.setItem(scopedKey(base, project), legacy);
  store.removeItem(base);
  return legacy;
}

/**
 * Write a project's value. Does nothing without a project.
 *
 * Silent rather than throwing: persistence here is a convenience on top of an
 * explicit export, and a viewer with no project open is a normal state, not a
 * failure to report.
 */
export function writeScoped(base: string, project: ProjectKey | null, value: string): void {
  const store = storage();
  if (store === null || project === null) return;
  try {
    store.setItem(scopedKey(base, project), value);
  } catch (error) {
    // Quota or private mode. Best effort by design — the explicit file export
    // is the durable path for anyone who needs a guarantee.
    console.warn(`[project] could not persist ${base}`, error);
  }
}

/** Forget a project's value, e.g. when its content is cleared. */
export function clearScoped(base: string, project: ProjectKey | null): void {
  const store = storage();
  if (store === null || project === null) return;
  store.removeItem(scopedKey(base, project));
}
