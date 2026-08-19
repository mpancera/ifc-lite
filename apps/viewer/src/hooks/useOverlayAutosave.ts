/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keeps an authoring session across reloads.
 *
 * Two halves. On every committed edit the overlay is written to IndexedDB,
 * debounced so a burst of placements costs one write. On load, a snapshot
 * authored against the *same bytes* is restored without asking — that case is
 * a recovered tab, not a decision. A snapshot from a different version of the
 * file is never applied silently: it is reconciled and handed to the UI, which
 * shows what still fits before anything changes.
 *
 * Everything stays on the machine; the snapshot never leaves the browser.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { useViewerStore } from '@/store';
import { configureMutationView } from '@/utils/configureMutationView';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { computeFullSourceHash } from '@/utils/sourceContentHash';
import { captureOverlaySnapshot } from '@/lib/persistence/captureSnapshot';
import { loadSnapshot, saveSnapshot, deleteSnapshot, listSnapshots } from '@/lib/persistence/idbOverlayStorage';
import {
  reconcileSnapshot, undisputedExpressIds, hasDecisions, isMutedFor, withMaterialisedIn,
} from '@/lib/persistence/reconcileSnapshot';
import { restoreOverlaySnapshot } from '@/lib/persistence/restoreSnapshot';
import { makeReconcileTarget, makeSnapshotSource } from '@/lib/persistence/storeAdapter';
import { isSameProject, readProject } from '@/lib/persistence/referenceIndex';
import type { OverlaySnapshot, ReconcileReport } from '@/lib/persistence/types';

/** Long enough that click-place-click-place is one write, short enough that a
 *  closed tab loses at most a moment's work. */
const SAVE_DEBOUNCE_MS = 1500;

export interface PendingRestore {
  snapshot: OverlaySnapshot;
  report: ReconcileReport;
  modelId: string;
}

export function useOverlayAutosave() {
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const activeStore = useViewerStore((s) => (
    s.activeModelId ? s.models.get(s.activeModelId)?.ifcDataStore ?? null : null
  ));
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  /** Source hash per model, computed once per load. */
  const hashes = useRef(new Map<string, string>());
  /** Models already checked for a snapshot, so a re-render never re-prompts. */
  const checked = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);

  const hashFor = useCallback(async (modelId: string): Promise<string | null> => {
    const cached = hashes.current.get(modelId);
    if (cached) return cached;
    const store = useViewerStore.getState().models.get(modelId)?.ifcDataStore;
    if (!store?.source?.length) return null;
    const hash = await computeFullSourceHash(store.source.materialize());
    if (hash) hashes.current.set(modelId, hash);
    return hash;
  }, []);

  const applySnapshot = useCallback((
    snapshot: OverlaySnapshot,
    modelId: string,
    keep?: ReadonlySet<number>,
  ) => {
    const state = useViewerStore.getState();
    const store = state.models.get(modelId)?.ifcDataStore;
    if (!store) return;

    // Views are created lazily by whichever surface edits first, so a restore
    // that happens before the user touches anything has to create it — with the
    // same base extractor the editing surfaces configure, or restored entities
    // would read against an empty base.
    let view = state.getMutationView(modelId);
    if (!view) {
      view = new MutablePropertyView(store.properties || null, modelId);
      configureMutationView(view, store);
      state.registerMutationView(modelId, view);
    }

    const result = restoreOverlaySnapshot(snapshot, view, {
      registerElement: ({ expressId, storeyExpressId, ifcType, name, containerExpressId }) => {
        if (store.spatialHierarchy) {
          registerAuthoredElement(
            store.spatialHierarchy, storeyExpressId, expressId, ifcType, name, containerExpressId,
          );
        }
      },
      expressIdOfGlobalId: makeReconcileTarget(store).expressIdOfGlobalId,
      appendMeshes: (meshes) => {
        const cross = useViewerStore.getState() as unknown as {
          appendGeometryBatch?: (batch: typeof meshes) => void;
        };
        cross.appendGeometryBatch?.(meshes);
      },
    }, keep);

    useViewerStore.getState().bumpMutationVersion();
    return result;
  }, []);

  // ── Restore ──
  // Keyed on the parsed store OBJECT, not the models map: streaming a model in
  // republishes that map many times, and depending on it would tear down this
  // effect mid-await on every batch — after it had already marked the model
  // checked, so the restore would be cancelled and never retried. The store is
  // created once per load, so this runs exactly once per model.
  useEffect(() => {
    if (!activeModelId || checked.current.has(activeModelId)) return;
    if (!activeStore?.source?.length) return;
    checked.current.add(activeModelId);

    let cancelled = false;
    let settled = false;
    void (async () => {
      const hash = await hashFor(activeModelId);
      if (cancelled || !hash) return;

      const exact = await loadSnapshot(hash);
      if (cancelled) return;
      if (exact) {
        // Same bytes: nothing can have drifted, so restoring is recovery, not
        // a decision to put in front of someone.
        applySnapshot(exact, activeModelId);
        settled = true;
        return;
      }

      // No snapshot for these bytes. Any other saved work might still be
      // meaningful for this file, so offer the most recent one that overlaps.
      // Geometry hashes come from the open model's meshes, so a reshaped room
      // is detected rather than passing as unchanged on GlobalId alone.
      const openMeshes = useViewerStore.getState().models.get(activeModelId)?.geometryResult?.meshes ?? [];
      const target = makeReconcileTarget(
        activeStore,
        openMeshes,
        (expressId) => useViewerStore.getState().toGlobalId(activeModelId, expressId),
      );
      // Only a version of the SAME project is worth offering. Asking whether
      // "anything applies" cannot decide this: a product type and its system
      // reference nothing in the architecture model, so they survive
      // reconciliation against any file whatsoever and every unrelated model
      // would raise the prompt.
      const openProject = readProject(activeStore);
      // The NEWEST saved state of this project, and only that one.
      //
      // `listSnapshots` sorts newest first, and the loop used to fall through
      // to older ones when the newest had nothing to say. That is how a state
      // somebody had already worked past came back: rooms discarded in a later
      // session still sit in an earlier snapshot, so the older state
      // legitimately holds "work missing from this file" and offered to put the
      // discarded rooms back. An older state of the same project is history,
      // not a candidate — it is superseded by definition.
      const candidate = (await listSnapshots()).find((snapshot) => isSameProject(
        snapshot.reference, openProject, (globalId) => target.expressIdOfGlobalId(globalId) >= 0,
      ));
      if (cancelled || !candidate) return;

      // Already known to be inside this exact file — recorded the last time it
      // was opened, so the question does not come back on every load.
      if (isMutedFor(candidate, hash)) { settled = true; return; }

      // The open file's name goes into every message: "das Geschoss gibt es
      // nicht mehr" is only actionable once the reader knows in WHAT.
      const currentModelName = useViewerStore.getState().models.get(activeModelId)?.name;
      const report = reconcileSnapshot(candidate, hash, target, { currentModelName });

      // This IS the file that state was exported to: every authored object is
      // already in it, under the same GlobalIds. Re-applying would give each
      // one a twin, and asking again on every open is the loop a user walks
      // into by doing the obvious thing — exporting what they just restored.
      // So the file is recorded on the state and the state stays: it is still
      // the recovery copy for the file it was authored against.
      if (report.materialised) {
        void saveSnapshot(withMaterialisedIn(candidate, hash));
        settled = true;
        return;
      }
      // A report with no rows has nothing to decide: whatever the state held
      // could not be re-identified in this file and would not be applied
      // either way. Offering it would be an interruption, not a choice.
      if (!hasDecisions(report)) { settled = true; return; }

      setPendingRestore({ snapshot: candidate, report, modelId: activeModelId });
      settled = true;
    })();

    // The check is marked up front so a re-render can't prompt twice, but a run
    // that was torn down mid-await never reached a decision — StrictMode's
    // double-invoke does exactly that on mount. Releasing the mark unless the
    // run settled lets the surviving invocation do the work.
    return () => {
      cancelled = true;
      if (!settled) checked.current.delete(activeModelId);
    };
  }, [activeModelId, activeStore, hashFor, applySnapshot]);

  // ── Autosave ──
  useEffect(() => {
    if (!activeModelId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {
      void (async () => {
        const state = useViewerStore.getState();
        const model = state.models.get(activeModelId);
        const view = state.mutationViews.get(activeModelId);
        if (!model?.ifcDataStore || !view) return;

        const hash = await hashFor(activeModelId);
        if (!hash) return;

        const snapshot = captureOverlaySnapshot({
          view,
          source: makeSnapshotSource({
            store: model.ifcDataStore,
            view,
            meshes: model.geometryResult?.meshes ?? [],
            toGlobalId: (expressId) => useViewerStore.getState().toGlobalId(activeModelId, expressId),
          }),
          sourceHash: hash,
          modelName: model.name,
        });

        // Undoing back to a clean slate must clear the snapshot, not leave the
        // last non-empty one to reappear on the next load.
        if (snapshot) await saveSnapshot(snapshot);
        else await deleteSnapshot(hash);
      })();
    }, SAVE_DEBOUNCE_MS);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [activeModelId, mutationVersion, hashFor]);

  const acceptUndisputed = useCallback(() => {
    if (!pendingRestore) return;
    applySnapshot(pendingRestore.snapshot, pendingRestore.modelId, undisputedExpressIds(pendingRestore.report));
    setPendingRestore(null);
  }, [pendingRestore, applySnapshot]);

  const acceptAll = useCallback(() => {
    if (!pendingRestore) return;
    applySnapshot(pendingRestore.snapshot, pendingRestore.modelId);
    setPendingRestore(null);
  }, [pendingRestore, applySnapshot]);

  const discard = useCallback(() => {
    if (!pendingRestore) return;
    void deleteSnapshot(pendingRestore.snapshot.sourceHash);
    setPendingRestore(null);
  }, [pendingRestore]);

  /** Keep the saved work untouched and decide later. */
  const dismiss = useCallback(() => setPendingRestore(null), []);

  return { pendingRestore, acceptUndisputed, acceptAll, discard, dismiss };
}
