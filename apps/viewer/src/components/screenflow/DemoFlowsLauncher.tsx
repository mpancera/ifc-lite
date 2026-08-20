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
 * # Readiness is asked of the machine, not of the code
 * A built strand can still be unplayable: the demo data it reads lives outside
 * the repository. A row says so instead of letting somebody press start and
 * watch nothing happen.
 *
 * # Why the data section lists every slot, not just what a step is missing
 * The first version offered an upload beside the step that needed the file,
 * which left the two federation models unreachable — no step of the journey
 * requires them, so nothing ever rendered a control for them and there was no
 * way to supply them at all. The section below answers "what data does this
 * machine have", which has to cover every slot to be usable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { demoDataSlots, journeySteps, type DemoSlotStatus, type JourneyStep } from '@/lib/screenflow/journey';
import { removeStoredDemoFile, storeDemoFile } from '@/lib/screenflow/demoFileStore';
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

/** Present, and where from — the same three states the section explains. */
const SOURCE_LABEL: Record<DemoSlotStatus['source'], string> = {
  uploaded: 'hochgeladen',
  served: 'lokal vorhanden',
  missing: 'fehlt',
};

const SOURCE_CLASS: Record<DemoSlotStatus['source'], string> = {
  uploaded: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  served: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  missing: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
};

/**
 * One demo slot, fillable from the machine the presenter is sitting at.
 *
 * The file goes into the browser, never onto the server: `public/demo-local/`
 * is copied verbatim into every build, so a model placed there would be
 * downloadable from any deployment at a predictable URL. This way it exists in
 * one browser profile and nowhere else, which is what makes uploading a real
 * building acceptable at all.
 */
function SlotRow({ slot, onChanged }: { slot: DemoSlotStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      // Named, not swallowed: a quota rejection on a 200 MB model looks
      // exactly like a click that did nothing.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border-t border-zinc-200 py-2 first:border-t-0 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <code className="shrink-0 text-[11px]">{slot.name}</code>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${SOURCE_CLASS[slot.source]}`}>
          {SOURCE_LABEL[slot.source]}
        </span>
        <span className="flex-1" />
        {slot.source === 'uploaded' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 text-[11px]"
            disabled={busy}
            onClick={() => void guard(() => removeStoredDemoFile(slot.id))}
          >
            Entfernen
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-6 shrink-0 text-[11px]"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Lädt …' : slot.source === 'missing' ? 'Hochladen' : 'Ersetzen'}
        </Button>
      </div>
      {slot.source === 'missing' && (
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{slot.howToGetDe}</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={slot.accept}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          // Cleared so picking the same file twice fires again — after a
          // failed first attempt that is exactly what a person does.
          e.target.value = '';
          if (picked) void guard(() => storeDemoFile(slot.id, picked));
        }}
      />
      {error && <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">Fehlgeschlagen: {error}</p>}
    </li>
  );
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
          <p className="mt-1 text-[12px] leading-snug text-amber-700 dark:text-amber-400">
            Braucht {step.missingFiles.map((f) => f.name).join(', ')} — unten unter Demodaten hochladen.
          </p>
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
  const [slots, setSlots] = useState<DemoSlotStatus[] | null>(null);
  const [reloads, setReloads] = useState(0);
  const recheck = useCallback(() => setReloads((n) => n + 1), []);

  // Re-asked on every open, and again after an upload: a file can also be
  // dropped into `demo-local` while the app runs, and a launcher that answered
  // once would go on claiming the data is missing.
  useEffect(() => {
    if (!open) { setSteps(null); setSlots(null); return; }
    let cancelled = false;
    void journeySteps().then((rows) => { if (!cancelled) setSteps(rows); });
    void demoDataSlots().then((rows) => { if (!cancelled) setSlots(rows); });
    return () => { cancelled = true; };
  }, [open, reloads]);

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
          Escape beendet beides. Fehlende Demodaten lassen sich hier hochladen; sie bleiben in
          diesem Browser und werden weder ins Repository noch auf den Server geschrieben.
        </p>

        {steps === null ? (
          <p className="mt-4 text-[12px] text-zinc-500">Wird geprüft …</p>
        ) : (
          <ul className="mt-3" aria-label="Journey-Schritte">
            {steps.map((step) => <StepRow key={step.number} step={step} />)}
          </ul>
        )}

        <div className="mt-5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h3 className="text-[12px] font-semibold">Demodaten</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Hochgeladene Dateien bleiben in diesem Browser — sie gehen weder ins Repository noch auf
            einen Server, und ein anderes Gerät sieht sie nicht. Der Name im Modellbaum ist immer der
            hier gezeigte, nicht der der hochgeladenen Datei.
          </p>
          {slots === null ? (
            <p className="mt-2 text-[11px] text-zinc-500">Wird geprüft …</p>
          ) : (
            <ul className="mt-2" aria-label="Demodaten">
              {slots.map((slot) => <SlotRow key={slot.id} slot={slot} onChanged={recheck} />)}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={closeDemoFlows}>Schliessen</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
