/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A project description left in the folder by whatever manages it.
 *
 * The folder is the one thing two applications working on the same project
 * both hold. So it is also the natural place to agree on what the project IS —
 * no message passing, no service between them, and it still works when only
 * one of the two is running.
 *
 * Reading it is optional in both directions. A folder without a descriptor is
 * a folder somebody picked, and gets a key of its own; a descriptor written by
 * a tool this one has never heard of is read as far as it makes sense and
 * ignored beyond that. Neither side may require the other to exist.
 *
 * ## Nothing here is trusted
 *
 * The file is written by another program and editable by a person. Adopting
 * whatever it says would let a damaged descriptor put two different projects
 * under one key — the exact confusion the key exists to prevent, walking in
 * through the front door. Every field is checked, and a bad one is dropped
 * rather than repaired: a guessed correction is a claim nobody made.
 */

import { isValidProjectKey, type ProjectKey } from './key.js';

/** What a folder says about itself. Every field beyond the key is optional. */
export interface ProjectDescriptor {
  key: ProjectKey;
  /** Display name, e.g. `Nordbau`. */
  name?: string;
  /** Project number, e.g. `017`. Kept apart from the name because the two
   *  sort differently and are searched differently. */
  number?: string;
}

/**
 * Where a descriptor may live, in the order it is looked for.
 *
 * The subdirectory first, because that is where a folder's own tooling keeps
 * its files and where new ones are written. The root second, for folders
 * written before the subdirectory existed — reading is deliberately more
 * forgiving than writing, since refusing a well-formed older file would lose
 * information for no gain.
 */
export const PROJECT_DESCRIPTOR_LOCATIONS: readonly { dir: string | null; file: string }[] = [
  { dir: 'dc', file: 'project.json' },
  { dir: null, file: 'dc.project.json' },
];

/**
 * Read a descriptor out of parsed JSON, or `null` when there is nothing usable.
 *
 * `null` specifically when the KEY is unusable: a descriptor without a
 * trustworthy key cannot do the one job it exists for, and taking its name
 * while ignoring its identity would label a project after a file it then
 * refused to believe.
 */
export function parseProjectDescriptor(raw: unknown): ProjectDescriptor | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  if (!isValidProjectKey(record.key)) return null;

  return {
    key: record.key,
    ...(nonEmptyString(record.name) ? { name: record.name.trim() } : {}),
    ...(nonEmptyString(record.number) ? { number: record.number.trim() } : {}),
  };
}

/**
 * The label to show for a project: number and name, whichever exist.
 *
 * Both when both are there — a folder holding five projects is a list where
 * `017` sorts and `Nordbau` is recognised, and dropping either makes one of
 * those harder.
 */
export function projectDisplayName(descriptor: ProjectDescriptor): string | null {
  const parts = [descriptor.number, descriptor.name].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Look for a descriptor in a folder. `null` when there is none to find.
 *
 * A missing file is the ordinary case and not an error — most folders are not
 * managed by anything. A malformed one is also `null`, but the caller is told
 * apart from "absent" through {@link readProjectDescriptorResult}, because a
 * descriptor that exists and cannot be read is worth mentioning and a folder
 * without one is not.
 */
export async function readProjectDescriptor(
  folder: FileSystemDirectoryHandle,
): Promise<ProjectDescriptor | null> {
  return (await readProjectDescriptorResult(folder)).descriptor;
}

export interface ProjectDescriptorResult {
  descriptor: ProjectDescriptor | null;
  /** True when a file was there but could not be read as a descriptor. */
  malformed: boolean;
}

/** As {@link readProjectDescriptor}, but distinguishing absent from unreadable. */
export async function readProjectDescriptorResult(
  folder: FileSystemDirectoryHandle,
): Promise<ProjectDescriptorResult> {
  for (const location of PROJECT_DESCRIPTOR_LOCATIONS) {
    const file = await openIfPresent(folder, location.dir, location.file);
    if (!file) continue;

    try {
      const descriptor = parseProjectDescriptor(JSON.parse(await (await file.getFile()).text()));
      // A file that exists but does not parse stops the search: falling through
      // to an older location would quietly use stale identity while a newer,
      // broken file sits next to it.
      return { descriptor, malformed: descriptor === null };
    } catch {
      return { descriptor: null, malformed: true };
    }
  }

  return { descriptor: null, malformed: false };
}

async function openIfPresent(
  folder: FileSystemDirectoryHandle,
  dir: string | null,
  file: string,
): Promise<FileSystemFileHandle | null> {
  try {
    const place = dir === null ? folder : await folder.getDirectoryHandle(dir);
    return await place.getFileHandle(file);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return null;
    throw err;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
