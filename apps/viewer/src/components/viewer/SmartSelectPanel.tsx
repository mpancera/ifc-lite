/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Smarte Auswahl — the magic wand.
 *
 * Tick what has to be the SAME, switch the wand on, click an element: every
 * element that matches in those respects joins the selection. "Select all
 * IfcColumn" in the context menu answers "same in what respect" for you and
 * always answers "class", so it reaches across the whole building — 22 columns
 * where 14 were meant (Marc, 2026-09-13). Here the answer is yours, and the
 * context menu does not grow a row per combination.
 *
 * It rides the PRIMARY selection rather than the picking pipeline, the same
 * way the zone brush does: a click anywhere — viewport, tree, list — sets the
 * primary pick, and this reacts to it. One mechanism, and it works from every
 * surface that can select something, which a viewport hook would not.
 *
 * Its own result is what makes that delicate: expanding the selection moves
 * the primary pick to the last match, which arrives looking exactly like the
 * next click. That key is remembered and ignored for as long as it keeps
 * arriving — `useModelSelection` re-announces the same primary a tick later
 * when the highlight changes, so swallowing it only once still loops. The
 * memory is dropped when the selection is emptied, so clicking that very
 * element afterwards works like any other click.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import {
  collectSmartSelection, DEFAULT_CRITERIA, SMART_CRITERIA, type SmartCriterion,
} from '@/lib/smartSelect/criteria';
import { smartSelectSources } from '@/lib/smartSelect/model-facts';

interface SmartSelectPanelProps {
  onClose?: () => void;
}

export function SmartSelectPanel({ onClose }: SmartSelectPanelProps) {
  const models = useViewerStore((s) => s.models);
  const selectedEntity = useViewerStore((s) => s.selectedEntity);
  const clearEntitySelection = useViewerStore((s) => s.clearEntitySelection);
  const setSelectedEntityIds = useViewerStore((s) => s.setSelectedEntityIds);
  const addEntitiesToSelection = useViewerStore((s) => s.addEntitiesToSelection);

  const [criteria, setCriteria] = useState<Set<SmartCriterion>>(new Set(DEFAULT_CRITERIA));
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /** The primary pick our own last expansion caused; ignored while it stands. */
  const echo = useRef<string | null>(null);
  const selectionSize = useViewerStore((s) => s.selectedEntitiesSet.size);

  const enabled = useMemo(
    () => SMART_CRITERIA.filter((c) => criteria.has(c.id)).map((c) => c.id),
    [criteria],
  );

  const toggle = (id: SmartCriterion) => {
    setCriteria((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandFrom = useCallback((seed: { modelId: string; expressId: number }) => {
    const model = models.get(seed.modelId);
    const dataStore = model?.ifcDataStore;
    if (!dataStore) {
      setNote('Dieses Modell ist nicht (mehr) geladen.');
      return;
    }
    if (enabled.length === 0) {
      setNote('Kein Merkmal gewählt — der Zauberstab wüsste nicht, worin gleich.');
      return;
    }

    const started = performance.now();
    const { ids, deepReads } = collectSmartSelection(
      seed.expressId, enabled, smartSelectSources(dataStore),
    );
    const took = Math.round(performance.now() - started);

    // Both channels, the way every other bulk pick in the app drives them:
    // the renderer highlights global ids, the tools read model-local refs.
    const refs = ids.map((expressId) => ({ modelId: seed.modelId, expressId }));
    // `addEntitiesToSelection` makes the LAST ref primary — that is the echo.
    const last = refs[refs.length - 1];
    echo.current = `${last.modelId}:${last.expressId}`;
    clearEntitySelection();
    setSelectedEntityIds(ids.map((id) => toGlobalIdFromModels(models, seed.modelId, id)));
    addEntitiesToSelection(refs);

    const seedClass = dataStore.entities?.getTypeName?.(seed.expressId) || 'Element';
    setNote(
      `${ids.length}× ${seedClass} · ${took} ms`
      + (deepReads > 0 ? ` · ${deepReads} tief gelesen` : ''),
    );
  }, [models, enabled, clearEntitySelection, setSelectedEntityIds, addEntitiesToSelection]);

  useEffect(() => {
    if (!armed || !selectedEntity) return;
    const key = `${selectedEntity.modelId}:${selectedEntity.expressId}`;
    // Our own answer, not a new pick.
    if (echo.current === key) return;
    expandFrom(selectedEntity);
  }, [armed, selectedEntity, expandFrom]);

  // An empty selection means whatever we answered is gone, so the element we
  // were ignoring is a legitimate pick again.
  useEffect(() => {
    if (selectionSize === 0) echo.current = null;
  }, [selectionSize]);

  // Re-aiming the wand while it is armed re-answers the question for the
  // element already picked, instead of waiting for a click that says nothing
  // new. The primary stays what it was, so the echo guard is cleared for it.
  const reapply = () => {
    if (!selectedEntity) {
      setNote('Erst ein Element anklicken.');
      return;
    }
    echo.current = null;
    expandFrom(selectedEntity);
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-violet-600" />
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">
            Smarte Auswahl
          </h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Schliessen"
            className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3 py-2 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-900 leading-snug">
        Gleich worin? Anhaken, Zauberstab einschalten, ein Objekt anklicken —
        alles Gleiche kommt dazu.
      </div>

      <div className="flex-1 overflow-auto">
        {SMART_CRITERIA.map((def) => (
          <label
            key={def.id}
            className="flex items-start gap-2 px-3 py-2 border-b border-zinc-100 dark:border-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-950"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={criteria.has(def.id)}
              onChange={() => toggle(def.id)}
            />
            <span className="min-w-0">
              <span className="block text-xs text-zinc-900 dark:text-zinc-100">{def.label}</span>
              <span className="block text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                {def.hint}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-2 flex flex-col gap-2">
        <Button
          size="sm"
          variant={armed ? 'default' : 'outline'}
          onClick={() => { setArmed((v) => !v); setNote(null); }}
          className="w-full"
        >
          <Wand2 className="h-4 w-4 mr-2" />
          {armed ? 'Zauberstab ist an' : 'Zauberstab einschalten'}
        </Button>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={reapply}>
            Auf Auswahl anwenden
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { clearEntitySelection(); setNote(null); }}>
            Leeren
          </Button>
        </div>
        {note && (
          <p className="text-[11px] font-mono text-zinc-600 dark:text-zinc-300">{note}</p>
        )}
      </div>
    </div>
  );
}
