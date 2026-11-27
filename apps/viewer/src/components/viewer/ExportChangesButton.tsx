/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Dedicated toolbar button for exporting IFC with pending changes applied.
 * Shows when any loaded model has pending changes and exports ALL of them in
 * one click: a single `.ifc` (or `.ifcx`) when one model changed, or a single
 * zip bundling every changed model's file when several did (issue #1534 — this
 * used to look at only the first federated model for both the badge and the
 * export).
 */

import type { ExportSurface } from '@/lib/analytics-export-events';
import { trackExportCompleted } from '@/lib/analytics';
import { useState, useCallback, useLayoutEffect, useEffect, useRef, cloneElement, isValidElement, type MouseEvent, type ReactNode } from 'react';
import { Download, Check, AlertCircle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { zipArtifacts } from '@/lib/export/artifact-bundle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { useChangedModels } from '@/hooks/useUnexportedChanges';
import { useReplaceableTimeout } from '@/hooks/useReplaceableTimeout';
import { useTranslation } from '@/i18n';
import { toast } from '@/components/ui/toast';
import { buildExportFilename, downloadFile } from '@/lib/export/download';
// Fork: stamped names that do not grow per round, and a remembered project folder.
import { restamp } from '@/lib/export/filename-stamp';
import {
  saveTargetsSupported, saveTargetKey, loadSaveTarget, rememberSaveTarget, forgetSaveTarget,
  ensureWritable, writeIntoTarget, type DirectoryTarget,
} from '@/lib/export/saveTarget';
import {
  collectChangedModels,
  totalChangeCount,
  buildChangedArtifacts,
  type ChangedModelsResult,
} from '@/lib/export/model-changes';
import { defaultBuildArtifactsDeps, unrepresentedPsetsNote } from '@/lib/export/changed-model-export';
import {
  ExportChangesReviewDialog,
  buildReviewGroups,
  type ModelReviewGroup,
} from './ExportChangesReviewDialog';

interface ExportChangesButtonProps {
  surface: ExportSurface;
  /** Optional custom class name */
  className?: string;
  /**
   * The export registry's dialog contract (`ExportDialogComponent`, #5838):
   * a menu row, ribbon button or palette auto-trigger that opens the review.
   * Without it this renders the standing amber toolbar button, shown only
   * while there are unexported edits.
   */
  trigger?: ReactNode;
}

/**
 * Structural equality for two `buildReviewGroups()` outputs (issue: review
 * dialog can diverge from what actually gets exported — every mutating
 * action mutates its `MutablePropertyView` instance in place rather than
 * bumping `mutationVersion` through the store's tracked `set()`, so a
 * mutation made while the review is open can leave the on-screen list stale
 * without React re-rendering it).
 *
 * Deliberately NOT `JSON.stringify(a) === JSON.stringify(b)`: that would be
 * order-sensitive, and while `collectEffectiveChanges` sorts deterministically
 * (entityId, then kind, then name, then setName — see
 * `packages/mutations/src/effective-changes.ts`), a field-by-field walk
 * doesn't lean on that invariant holding forever. Both inputs come from the
 * same `buildReviewGroups()` call site (open-time vs. click-time, or
 * click-time vs. post-export in `handleExport` below), so position-based
 * comparison across the two arrays is valid either way.
 */
function reviewGroupsEqual(a: ModelReviewGroup[], b: ModelReviewGroup[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ga = a[i];
    const gb = b[i];
    if (ga.modelId !== gb.modelId || ga.modelName !== gb.modelName || ga.unitemizedCount !== gb.unitemizedCount) {
      return false;
    }
    if (ga.entities.length !== gb.entities.length) return false;
    for (let j = 0; j < ga.entities.length; j++) {
      const ea = ga.entities[j];
      const eb = gb.entities[j];
      if (ea.entityId !== eb.entityId || ea.label !== eb.label) return false;
      if (ea.changes.length !== eb.changes.length) return false;
      for (let k = 0; k < ea.changes.length; k++) {
        const ca = ea.changes[k];
        const cb = eb.changes[k];
        if (
          ca.entityId !== cb.entityId ||
          ca.kind !== cb.kind ||
          ca.name !== cb.name ||
          ca.setName !== cb.setName ||
          ca.previousValue !== cb.previousValue ||
          ca.newValue !== cb.newValue ||
          !!ca.deleted !== !!cb.deleted
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * The `groups` state backing the review dialog, plus its setter for the
 * refused-confirm refresh path (`handleConfirm` / `handleExport` below call
 * `setGroups` directly on a mismatch).
 *
 * Extracted from `ExportChangesButton` as its own hook (rather than inlined
 * `useState`/`useLayoutEffect` calls) specifically so it's unit-testable on
 * its own, real-DOM, `<div>`-only harness — mounted under
 * `ExportChangesReviewDialog`'s real Radix `Dialog`, the same commit-timing
 * bug this hook exists to avoid is invisible to a `MutationObserver`-based
 * test: Radix's own `FocusScope` / `DismissableLayer` / `Presence` layout
 * effects trigger additional synchronous re-renders while the dialog opens,
 * and each one forces React to flush any already-pending passive effect
 * first (`flushPassiveEffects()`, called by React internally whenever a new
 * synchronous update is scheduled while one is outstanding) — so Radix's own
 * churn incidentally flushes this hook's passive effect before any of it
 * ever reaches the DOM, masking a plain `useEffect` regression completely
 * when observed through the full dialog. See
 * `useReviewGroups.test.tsx` for the isolated reproduction.
 */
export function useReviewGroups(
  reviewOpen: boolean,
  changed: ChangedModelsResult,
): [ModelReviewGroup[], (groups: ModelReviewGroup[]) => void] {
  // This is `useState`, not `useMemo`, because a refused confirm must be able
  // to force a refresh: a bypass mutation (by definition) never bumps
  // `mutationVersion`, so `changed` never changes either — a memo keyed on
  // `[reviewOpen, changed]` would never re-derive, and every subsequent
  // confirm click would keep comparing against the SAME stale snapshot,
  // refusing forever ("check the updated list" would have been a lie — the
  // list never updated). `handleConfirm` / `handleExport` below call
  // `setGroups` directly on a mismatch so the screen actually reflects what
  // was just detected (maintainer finding on #1967).
  //
  // `useLayoutEffect`, not `useEffect` (CodeRabbit finding on #1967, and a
  // regression from the `useState` change above): a passive effect commits
  // AFTER the browser paints, so opening the review would render one frame
  // with `groups` still at its initial `[]` — `isEmpty` in
  // `ExportChangesReviewDialog` treats an empty `groups` array as "nothing to
  // export" (`[].every(...)` is vacuously `true`), so that frame flashes the
  // empty-state copy and a disabled Export button before the real list
  // appears. A layout effect commits synchronously, in the same browser task
  // as the paint, before the user sees anything — the refused-confirm refresh
  // this state exists for is unaffected, since `setGroups` is still called
  // from ordinary event handlers there, not from this effect.
  // `revision` (#4918 review finding, macroscope on this PR): `describeEntity`
  // resolves its labels through the module-level `resolve` at BUILD time, so
  // a locale switch while the review is open needs this effect to rebuild
  // `groups` too, or the entity labels stay in the old locale while the
  // dialog's own `t()`-driven chrome and `describeChangeKind(c, t)` (which
  // both re-read the CURRENT locale on every render) retranslate around
  // them — `revision` (not just `locale`) so an active-catalogue swap
  // (`registerLocale` overwriting the locale currently in use, not only a
  // `setLocale` call) also triggers a rebuild, matching what `useTranslation`
  // itself documents as its own re-render trigger.
  const { revision } = useTranslation();
  const [groups, setGroups] = useState<ModelReviewGroup[]>([]);
  useLayoutEffect(() => {
    setGroups(reviewOpen ? buildReviewGroups(useViewerStore.getState().mutationViews, changed) : []);
  }, [reviewOpen, changed, revision]);
  return [groups, setGroups];
}

export function ExportChangesButton({ surface, className, trigger }: ExportChangesButtonProps) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  // The success/error tick reverts to idle on a timer owned by the latest export.
  const statusReset = useReplaceableTimeout();
  const flashStatus = useCallback((status: 'success' | 'error', ms: number) => {
    setExportStatus(status);
    statusReset.schedule(() => setExportStatus('idle'), ms);
  }, [statusReset]);
  // Two-step export (issue #1915): the toolbar button opens a review dialog
  // listing the pending changes; the dialog's own Export button is the
  // confirm step that actually runs `handleExport` below.
  const [reviewOpen, setReviewOpen] = useState(false);

  // The same live change set the unexported-edits guards read (#5604).
  const changed = useChangedModels();

  const totalCount = totalChangeCount(changed);
  const modelCount = changed.models.length;

  // Built only while the dialog is open, from the live overlay — this is what
  // the user sees on screen. `handleConfirm` below re-derives this same shape
  // synchronously at click time and compares, to catch a mutation that landed
  // while the review was open without bumping `mutationVersion` (a direct
  // mutation of the same `MutablePropertyView` instance, bypassing the
  // store's tracked `set()`). See `useReviewGroups` above for why this is
  // `useState` + `useLayoutEffect`, not `useMemo` or a passive `useEffect`.
  const [groups, setGroups] = useReviewGroups(reviewOpen, changed);

  // Fork: the project folder this model's exports go to, if one was chosen.
  // Keyed on the name without its stamp (see `lib/export/saveTarget`).
  const activeModelName = useViewerStore((s) => (
    s.activeModelId ? s.models.get(s.activeModelId)?.name ?? null : null
  ));
  const targetKey = activeModelName ? saveTargetKey(activeModelName) : null;
  const [target, setTarget] = useState<DirectoryTarget | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!targetKey || !saveTargetsSupported()) { setTarget(null); return () => { cancelled = true; }; }
    void loadSaveTarget(targetKey).then((found) => { if (!cancelled) setTarget(found); });
    return () => { cancelled = true; };
  }, [targetKey]);

  const chooseFolder = useCallback(async () => {
    if (!targetKey) return;
    try {
      const picked = await (window as unknown as {
        showDirectoryPicker(options?: { mode?: 'readwrite' }): Promise<DirectoryTarget>;
      }).showDirectoryPicker({ mode: 'readwrite' });
      await rememberSaveTarget(targetKey, picked);
      setTarget(picked);
      toast.success(`Exporte gehen nach „${picked.name}“`);
    } catch (error) {
      // An aborted picker is a decision, not a failure.
      if ((error as { name?: string })?.name === 'AbortError') return;
      console.warn('[export] folder picker failed:', error);
      toast.error('Der Ordner liess sich nicht öffnen.');
    }
  }, [targetKey]);

  const clearFolder = useCallback(async () => {
    if (!targetKey) return;
    await forgetSaveTarget(targetKey);
    setTarget(null);
    toast.info('Exporte gehen wieder in den Download-Ordner.');
  }, [targetKey]);

  // Fork: somebody else (the restore prompt) asked to see the pending changes.
  const reviewRequests = useViewerStore((s) => s.changesReviewRequests);
  const lastHandledRequest = useRef(reviewRequests);
  useEffect(() => {
    if (reviewRequests === lastHandledRequest.current) return;
    lastHandledRequest.current = reviewRequests;
    if (totalCount > 0) setReviewOpen(true);
  }, [reviewRequests, totalCount]);

  const handleExport = useCallback(async (reviewedGroups: ModelReviewGroup[]) => {
    setIsExporting(true);
    statusReset.cancel();
    setExportStatus('idle');

    try {
      const { files, skipped } = await buildChangedArtifacts(
        useViewerStore.getState(),
        defaultBuildArtifactsDeps,
      );

      // `buildChangedArtifacts` is async and yields to the event loop while it
      // runs (`StepExporter.exportAsync` pauses with `setTimeout(0)` between
      // its progress phases before it reads the overlay) — `handleConfirm`'s
      // `reviewGroupsEqual` check only covers the instant right before this
      // call starts, not the window while it's in flight. A normal, tracked
      // mutation landing in that window (no bypass needed, just an edit made
      // elsewhere while the export runs) would previously ship silently in
      // the produced file with no error and no re-review. Re-derive once more
      // against what was actually reviewed and refuse the same way
      // `handleConfirm` does, rather than hand out a file that may no longer
      // match it.
      const postState = useViewerStore.getState();
      const postGroups = buildReviewGroups(postState.mutationViews, collectChangedModels(postState));
      if (!reviewGroupsEqual(reviewedGroups, postGroups)) {
        flashStatus('error', 3000);
        toast.error('Changes were made while exporting — check the updated list and confirm again.');
        setGroups(postGroups);
        setReviewOpen(true);
        return;
      }

      if (files.length === 0) {
        if (skipped.length > 0) {
          flashStatus('error', 3000);
          toast.error(`Export failed: ${skipped[0].reason}`);
        } else {
          toast.info('No changes to export');
        }
        return;
      }

      // Fork: `restamp`, not "append": the file being exported is often itself
      // a previous export, and appending grew the name by a stamp per round.
      const named: Array<{ name: string; content: Blob | Uint8Array | string; mime: string }> =
        files.length === 1
          ? [{ name: buildExportFilename(restamp(files[0].base), files[0].ext), content: files[0].content, mime: files[0].mime }]
          : [{ name: `${restamp('ifc-lite-changes')}.zip`, content: await zipArtifacts(files), mime: 'application/zip' }];

      // Fork: a chosen project folder wins over the download folder, but only
      // with permission; a refusal falls back to the download.
      let wroteTo: string | null = null;
      if (target && await ensureWritable(target, { prompt: true })) {
        try {
          for (const file of named) await writeIntoTarget(target, file.name, file.content);
          wroteTo = target.name;
        } catch (error) {
          console.warn('[export] writing into the chosen folder failed:', error);
          toast.error(`Schreiben nach „${target.name}“ ist fehlgeschlagen — gespeichert im Download-Ordner.`);
        }
      }
      if (!wroteTo) {
        for (const file of named) downloadFile(file.content, file.name, file.mime);
      } else {
        toast.success(`${named[0].name} in „${wroteTo}“ gespeichert`);
      }

      flashStatus('success', 2000);

      const exportedChanges = files.reduce((n, f) => n + f.changeCount, 0);
      trackExportCompleted({
        format: files.length === 1 ? files[0].ext : 'zip',
        surface,
        model_count: files.length,
        change_count: exportedChanges,
      });
      const unrepresented = files.reduce((n, f) => n + f.skippedCount, 0);
      if (skipped.length > 0) {
        // The empty-pset note rides along: a skipped model must not hide it (#5201).
        toast.info(
          `Exported ${files.length} of ${files.length + skipped.length} models — ${skipped.length} skipped (${skipped[0].reason})${unrepresentedPsetsNote(unrepresented)}`,
        );
      } else if (unrepresented > 0) {
        // Not a plain success: part of the edits could not be written (#5201).
        toast.info(`Exported ${files.length === 1 ? `${files[0].base}.${files[0].ext}` : `${files.length} models`} (${exportedChanges} changes)${unrepresentedPsetsNote(unrepresented)}`);
      } else if (files.length === 1) {
        toast.success(`Exported ${files[0].base}.${files[0].ext} (${exportedChanges} changes)`);
      } else {
        toast.success(`Exported ${files.length} models (${exportedChanges} changes)`);
      }
    } catch (error) {
      console.error('[ExportChangesButton] Export failed:', error);
      flashStatus('error', 3000);
      toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  }, [surface, statusReset, flashStatus, target]);

  const handleConfirm = useCallback(() => {
    // Re-derive fresh, synchronously, at click time — comparing against
    // `groups` (what's on screen) so a mutation applied in place while the
    // review was open (not routed through the store's tracked `set()`, so it
    // never bumped `mutationVersion` or re-rendered the dialog) is caught
    // instead of silently exporting a file that no longer matches what the
    // user reviewed.
    const state = useViewerStore.getState();
    const freshChanged = collectChangedModels(state);
    const freshGroups = buildReviewGroups(state.mutationViews, freshChanged);

    if (!reviewGroupsEqual(groups, freshGroups)) {
      // Actually refresh what's on screen — not just claim to. Without this,
      // a bypass mutation (which by definition never bumps `mutationVersion`)
      // left `groups` frozen at its stale snapshot forever, so every
      // subsequent confirm click re-compared against the SAME stale value and
      // refused again (maintainer finding on #1967).
      setGroups(freshGroups);
      toast.error('Changes were made since you opened this review — check the updated list and confirm again.');
      return;
    }

    setReviewOpen(false);
    void handleExport(freshGroups);
  }, [groups, handleExport]);

  const review = (
    <ExportChangesReviewDialog
      open={reviewOpen}
      onOpenChange={setReviewOpen}
      groups={groups}
      totalCount={totalCount}
      isExporting={isExporting}
      onConfirm={handleConfirm}
      targetFolder={target?.name ?? null}
      onChooseFolder={saveTargetsSupported() ? chooseFolder : undefined}
      onClearFolder={clearFolder}
    />
  );

  // A registry surface's own trigger; it composes with (not replaces) the
  // trigger's click handler, and the surface gates it on pending changes.
  if (isValidElement<{ onClick?: (event: MouseEvent) => void }>(trigger)) {
    const own = trigger.props.onClick;
    return (
      <>
        {cloneElement(trigger, { onClick: (event: MouseEvent) => { own?.(event); setReviewOpen(true); } })}
        {review}
      </>
    );
  }

  // Nothing to export — but keep rendering while an export is in flight so a
  // mid-export clear (count -> 0) doesn't unmount the button and drop state.
  if (totalCount === 0 && !isExporting) {
    return null;
  }

  const tooltip =
    modelCount > 1
      ? t('exportChangesButton.tooltipMulti', { models: modelCount, count: totalCount })
      : t('exportChangesButton.tooltipSingle', { count: totalCount });

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReviewOpen(true)}
            disabled={isExporting}
            aria-busy={isExporting}
            // Amber = unsaved-changes affordance (matches the app convention used
            // by the Cesium placement editor / ExportDialog dirty marker). The
            // button only renders while changes exist, so it should read as a
            // standing "you have unexported edits" prompt (issue #1107, item 5).
            className={`border-amber-500/60 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 ${className ?? ''}`}
          >
            {isExporting ? (
              <Spinner size="md" className="mr-2" />
            ) : exportStatus === 'success' ? (
              <Check className="h-4 w-4 mr-2 text-ok" />
            ) : exportStatus === 'error' ? (
              <AlertCircle className="h-4 w-4 mr-2 text-danger" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {t('exportChangesButton.buttonLabel')}
            <Badge className="ml-2 text-xs bg-warn-solid text-solid-foreground border-transparent hover:bg-warn-solid">
              {totalCount}
            </Badge>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {review}
    </>
  );
}
