/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Updating the library: every body through the geometry pipeline, once.
 *
 * Marc's shape for this (2026-09-17): the library is updated as its own act,
 * which runs all of its geometry through the pipeline in one go — and
 * afterwards everything is ready to place and shows up in the scene straight
 * away. That separates a slow, deliberate step from a fast, frequent one.
 *
 * # Why not simply do it while syncing
 * Syncing reads a LIST: a few kilobytes of names and classes. Preparing the
 * geometry downloads every example's file and meshes it. Folding the second
 * into the first would make the cheap action as expensive as the dear one, and
 * take the choice away from whoever only wanted to see what exists.
 *
 * # The identity has to be derived, never spelled out
 * What goes into the cupboard is found again by `libraryTypeKey`, and the key
 * is built from a CATALOG ENTRY. So this builds the same entry the picker
 * builds (`exampleToCatalogEntry`) and asks the same function. Writing the key
 * by hand here — "the file address without .ifc" — would be a second
 * definition of identity, correct until one of them moved.
 */

import { libraryTypeKey } from '@/lib/catalog/libraryTypeKey';
import { exampleToCatalogEntry } from './exampleCatalogEntries.js';
import { ensureExampleMeshes, storedExampleMeshes } from './exampleMeshes.js';
import { fetchExampleModel } from './fetchExampleModel.js';
import type { ElementExample, ElementExampleCatalog } from './elementExamples.js';

/** The key one example's meshes are kept under. */
export function exampleMeshKey(example: ElementExample, listUrl: string): string {
  return libraryTypeKey(exampleToCatalogEntry(example, listUrl));
}

/** Whether this example is ready to show the moment it is placed. */
export function exampleIsPrepared(example: ElementExample, listUrl: string): boolean {
  return storedExampleMeshes(exampleMeshKey(example, listUrl)) !== null;
}

export interface PreparationProgress {
  /** How many examples have been attempted. */
  readonly done: number;
  readonly total: number;
  /** The one being worked on, for the line the user reads. */
  readonly current: string;
}

export interface PreparationResult {
  readonly prepared: number;
  /** Names that could not be prepared, with the reason, in order. */
  readonly failures: { readonly name: string; readonly reason: string }[];
}

/**
 * Fetch and mesh every example of a synced list.
 *
 * Sequential on purpose. The pipeline is one wasm instance and the files come
 * from one server; firing ten at once would make the progress line a lie and
 * the server's life harder for no gain on a list this size.
 *
 * One example's failure never stops the rest — the point of the action is to
 * get as much ready as possible, and a single unreachable file says nothing
 * about the other nine.
 */
export async function prepareExampleGeometry(
  catalog: ElementExampleCatalog,
  onProgress?: (progress: PreparationProgress) => void,
): Promise<PreparationResult> {
  const total = catalog.entries.length;
  const failures: { name: string; reason: string }[] = [];
  let prepared = 0;
  let done = 0;

  for (const example of catalog.entries) {
    onProgress?.({ done, total, current: example.name });
    const key = exampleMeshKey(example, catalog.source);

    if (storedExampleMeshes(key)) {
      prepared += 1;
    } else {
      const fetched = await fetchExampleModel(
        exampleToCatalogEntry(example, catalog.source).exampleUrl!,
      );
      if (!fetched.ok) {
        failures.push({ name: example.name, reason: fetched.error });
      } else if (await ensureExampleMeshes(key, fetched.bytes)) {
        prepared += 1;
      } else {
        failures.push({ name: example.name, reason: 'Die Geometrie liess sich nicht aufbereiten.' });
      }
    }

    done += 1;
    onProgress?.({ done, total, current: example.name });
  }

  return { prepared, failures };
}
