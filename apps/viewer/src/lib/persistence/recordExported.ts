/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Telling a saved session which file it was exported into.
 *
 * `reconcileSnapshot` already tries to work this out by asking the open file
 * whether it holds the authored objects' GlobalIds — and it CANNOT, for a
 * session whose authored objects have no GlobalId to ask about. Geometry
 * plumbing is exactly that: a reshaped room writes points, a polyline and a
 * profile, and not one of them is an `IfcRoot`. `checkable` comes out empty,
 * `materialised` is false by its own guard, and the state is offered again on
 * every open — forever (Marc, 2026-09-16: "genau die Schleife die wir nicht
 * haben wollen", and he was right).
 *
 * Inference cannot fix that, so it is not used. The EXPORT knows: it produced
 * the bytes, so it can hash them and record the answer. No guessing, no false
 * positive — the one case where a fact is available instead of a heuristic.
 */

import { computeFullSourceHash } from '@/utils/sourceContentHash';
import { loadSnapshot, saveSnapshot } from './idbOverlayStorage';
import { withMaterialisedIn } from './reconcileSnapshot';
import type { OverlaySnapshot } from './types';

/** The two storage calls, injectable so this is testable without IndexedDB. */
export interface SnapshotStore {
  load(sourceHash: string): Promise<OverlaySnapshot | null>;
  save(snapshot: OverlaySnapshot): Promise<void>;
}

const REAL_STORE: SnapshotStore = { load: loadSnapshot, save: saveSnapshot };

/** Bytes of a produced file, however the exporter happened to make them. */
function bytesOf(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}

/**
 * Record `exported` as a file that now contains the session saved against
 * `sourceHash`.
 *
 * Silent about everything that can legitimately be missing: no snapshot for
 * this model (nothing was ever autosaved), no hash (an insecure context has no
 * `crypto.subtle`), a storage error. None of those should fail an export that
 * has already written its file — the cost is one more prompt, the cost of
 * throwing here is a user who thinks the export failed.
 */
export async function recordExportedInto(
  sourceHash: string | null,
  content: string | Uint8Array,
  store: SnapshotStore = REAL_STORE,
): Promise<void> {
  if (!sourceHash) return;
  try {
    const snapshot = await store.load(sourceHash);
    if (!snapshot) return;
    const exported = await computeFullSourceHash(bytesOf(content));
    if (!exported || exported === sourceHash) return;
    await store.save(withMaterialisedIn(snapshot, exported));
  } catch (error) {
    console.warn('[persistence] could not record the exported file on the saved session', error);
  }
}
