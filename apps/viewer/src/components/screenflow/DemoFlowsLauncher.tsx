/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The demo launcher: the user journey as five steps, with a way to start one.
 *
 * # Why it closes itself, and why it is not a docked panel
 * A flow takes the whole screen the moment it starts, and this is the surface
 * the presenter opened to start it — a launcher still sitting in the corner
 * would be in the recording and in the room's view of the demo. So it is a
 * dialog, and starting a flow dismisses it.
 *
 * # The list is derived, never kept
 * `journeySteps` reads the clip registry and the plan beside it, so a strand
 * that gets built changes its own row and a strand that gets added appears.
 * A hand-kept list here would be a second copy of the plan, and the copy would
 * be the one that goes stale.
 *
 * # Readiness is asked of the disk
 * A built strand can still be unplayable: the demo data it reads lives outside
 * the repository. The row says which file is missing instead of letting
 * somebody press start and watch nothing happen.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { journeySteps, type JourneyStep } from '@/lib/screenflow/journey';
import { playClip } from '@/lib/screenflow/player';
import { patchScreenflowState, useScreenflowStore } from '@/lib/screenflow/screenflow-store';

const STATE_LABEL: Record<JourneyStep['state'], string> = {
  ready: 'bereit',
  'missing-data': 'Daten fehlen',
  planned: 'geplant',
};

const STATE_CLASS: Record<JourneyStep['state'], string> = {
  ready: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  'missing-data': 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  planned: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

export function closeDemoFlows(): void {
  patchScreenflowState({ launcherOpen: false });
}

export function openDemoFlows(): void {
  patchScreenflowState({ launcherOpen: true });
}

function StepRow({ step }: { step: JourneyStep }) {
  const start = (mode: 'record' | 'present') => {
    if (!step.clipId) return;
    closeDemoFlows();
    void playClip(step.clipId, { mode });
  };

  return (
    <li className="flex gap-3 border-t border-zinc-200 py-3 first:border-t-0 dark:border-zinc-800">
      <span className="mt-0.5 w-5 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-400">
        {step.number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{step.titleDe}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATE_CLASS[step.state]}`}>
            {STATE_LABEL[step.state]}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{step.subtitleDe}</p>
        {step.state === 'missing-data' && (
          <ul className="mt-1 space-y-0.5 text-[12px] leading-snug text-amber-700 dark:text-amber-400">
            {step.missingFiles.map((file) => (
              <li key={file.name}>
                <code>{file.name}</code> fehlt in <code>apps/viewer/public/demo-local/</code> — {file.howToGetDe}
              </li>
            ))}
          </ul>
        )}
        {step.needsDe && (
          <p className="mt-1 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
            Offen: {step.needsDe}
          </p>
        )}
      </div>
      {step.state === 'ready' && (
        <div className="flex shrink-0 flex-col gap-1">
          <Button size="sm" className="h-7 text-[11px]" onClick={() => start('present')}>
            Vorführen
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => start('record')}>
            Aufnehmen
          </Button>
        </div>
      )}
    </li>
  );
}

export function DemoFlowsLauncher() {
  const open = useScreenflowStore((s) => s.launcherOpen);
  const status = useScreenflowStore((s) => s.status);
  const [steps, setSteps] = useState<JourneyStep[] | null>(null);

  // Re-asked on every open: a file can be dropped into `demo-local` while the
  // app is running, and a launcher that answered from the first open would go
  // on claiming the data is missing.
  useEffect(() => {
    if (!open) { setSteps(null); return; }
    let cancelled = false;
    void journeySteps().then((rows) => { if (!cancelled) setSteps(rows); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeDemoFlows();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // A flow that is running owns the screen; the launcher has nothing to add.
  if (!open || status !== 'idle') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeDemoFlows}>
      <div
        role="dialog"
        aria-label="Demo-Flows"
        className="max-h-[80vh] w-[34rem] overflow-y-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Demo-Flows</h2>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">User Journey, fünf Schritte</span>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          <strong>Vorführen</strong> hält auf Leertaste an und lässt sich per Kapitel steuern.{' '}
          <strong>Aufnehmen</strong> läuft ohne Bedienelemente durch — für den Bildschirmrekorder.
          Escape beendet beides.
        </p>

        {steps === null ? (
          <p className="mt-4 text-[12px] text-zinc-500">Wird geprüft …</p>
        ) : (
          <ul className="mt-3">
            {steps.map((step) => <StepRow key={step.number} step={step} />)}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={closeDemoFlows}>Schliessen</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
