/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Door numbers — proposed, explained, then written.
 *
 * Two decisions shape this panel:
 *
 * **It proposes before it writes.** A door number is derived from the escape
 * direction, and the derivation can be wrong where the model is (a room the
 * graph could not reach, a swing nobody stated). So the list shows what each
 * door WOULD be called and what it was named after, and one button writes the
 * lot. Nothing happens until it is pressed.
 *
 * **It says how it decided.** `Fluchtweg` means the escape direction settled
 * it; `Aussentür` that the door leads outside; `Aufschlag` that both sides
 * were equally far out and the leaf decided instead. That last one is the
 * weakest of the three, so it is visible rather than buried — those are the
 * rows to look at first if a number looks wrong.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { DoorOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { useDoorNumbers } from '@/hooks/useDoorNumbers';
import type { NumberBasis, DoorProblemReason } from '@/lib/doorNumbers/doorNumbers';

const BASIS_LABEL: Record<NumberBasis, string> = {
  escape: 'Fluchtweg',
  exterior: 'Aussentür',
  swing: 'Aufschlag',
  manual: 'gewählt',
};

const BASIS_HINT: Record<NumberBasis, string> = {
  escape: 'Der Raum liegt weiter vom Ausgang weg — man flüchtet durch diese Tür aus ihm heraus.',
  exterior: 'Die Tür führt ins Freie, also benennt sie der eine Raum, an dem sie liegt.',
  swing: 'Beide Seiten sind gleich weit vom Ausgang — entschieden hat, wohin das Blatt aufschlägt.',
  manual: 'Von Hand gewählt. Nichts Hergeleitetes überstimmt das.',
};

const PROBLEM_LABEL: Record<DoorProblemReason, string> = {
  'no-room': 'liegt in keinem Raum dieses Geschosses',
  'room-has-no-number': 'der benennende Raum hat noch keine Nummer',
  'no-direction': 'beide Seiten gleich weit vom Ausgang, kein Aufschlag im Modell',
};

export interface DoorNumbersPanelProps {
  onClose?: () => void;
}

export function DoorNumbersPanel({ onClose }: DoorNumbersPanelProps) {
  const models = useViewerStore((s) => s.models);
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const activeStorey = useViewerStore((s) => s.activeStorey);
  const numberDoors = useViewerStore((s) => s.numberDoors);
  // The two channels a selection actually travels on: the EntityRef feeds the
  // property lookup, the GLOBAL id drives the highlight. Setting only
  // `selectedEntityIds` — the multi-select channel — selected the door in a
  // place nothing draws, so clicking a row lit nothing up.
  const setSelectedEntity = useViewerStore((s) => s.setSelectedEntity);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const toGlobalId = useViewerStore((s) => s.toGlobalId);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { geometryResult: legacyGeometry, ifcDataStore } = useIfc();
  const [busy, setBusy] = useState(false);

  const { modelId, dataStore, geometryResult } = useMemo(() => {
    const single = models.size === 1 ? [...models.entries()][0] : null;
    const id = single ? single[0] : models.size === 0 ? 'legacy' : activeModelId;
    const model = id ? models.get(id) : null;
    return {
      modelId: id ?? null,
      dataStore: model?.ifcDataStore ?? (models.size === 0 ? ifcDataStore : null),
      geometryResult: model?.geometryResult ?? legacyGeometry,
    };
  }, [models, activeModelId, ifcDataStore, legacyGeometry]);

  const storeyId = activeStorey?.expressId ?? null;
  const chosen = useViewerStore((s) => s.doorNumberRoom);
  const setDoorNumberRoom = useViewerStore((s) => s.setDoorNumberRoom);
  const clearDoorNumberRoom = useViewerStore((s) => s.clearDoorNumberRoom);
  const requestPlanFocus = useViewerStore((s) => s.requestPlanFocus);
  const { plan, rooms, current, ready, sidesOf, centreOf } = useDoorNumbers({
    enabled: true, geometryResult, dataStore, modelId, storeyId,
  });

  /** Which door the viewer has selected, as a LOCAL id — the list keys on that. */
  const selectedDoorId = useMemo(() => {
    if (selectedEntityId === null || !modelId) return null;
    for (const doorId of centreOf.keys()) {
      if (toGlobalId(modelId, doorId) === selectedEntityId) return doorId;
    }
    return null;
  }, [selectedEntityId, modelId, centreOf, toGlobalId]);

  // Picking a door in the viewport scrolls its row into view. The other
  // direction was there from the start; without this one the list is a
  // one-way street, and on a floor with forty doors "which row is this?" is a
  // question nobody can answer by scrolling.
  useEffect(() => {
    if (selectedDoorId === null) return;
    const row = listRef.current?.querySelector(`[data-door-row="${selectedDoorId}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedDoorId]);

  const select = (doorId: number) => {
    if (!modelId) return;
    const globalId = toGlobalId(modelId, doorId);
    setSelectedEntity({ modelId, expressId: doorId });
    setSelectedEntityId(globalId);
    requestPlanFocus(globalId, centreOf.get(doorId));
  };

  const storeyName = storeyId !== null
    ? dataStore?.entities?.getName?.(storeyId) || `#${storeyId}`
    : null;

  const apply = () => {
    if (!modelId || plan.numbers.length === 0) return;
    setBusy(true);
    try {
      const result = numberDoors(modelId, plan.numbers.map((n) => ({
        doorId: n.doorId,
        number: n.number,
        roomId: n.roomId,
        otherRoomId: n.otherRoomId,
      })));
      if ('error' in result) { toast.error(result.error); return; }
      if (result.refused) {
        // Part written is not "done". Naming the count AND the reason beats a
        // green message that hides which half of the statement landed.
        toast.error(
          `${result.numbered} von ${plan.numbers.length} Türnummern geschrieben — ${result.refused}`,
        );
        return;
      }
      toast.success(
        `${result.numbered} Türnummern geschrieben, ${result.boundaries} Raumbezüge angelegt.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <DoorOpen className="h-4 w-4 text-emerald-600" />
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">
            Türnummern
          </h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Schliessen"
            className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3 py-2 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-900">
        {storeyId === null
          ? 'Kein Geschoss gewählt — wähle links in der Hierarchie eines aus.'
          : `Geschoss ${storeyName} · ${plan.numbers.length} von ${plan.numbers.length + plan.problems.length} Türen`}
      </div>

      <div className="flex-1 overflow-auto" ref={listRef}>
        {!ready && storeyId !== null && (
          <p className="px-3 py-3 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 leading-snug">
            Dieses Geschoss hat keine Räume und Türen, aus denen sich ein Weg nach
            draussen ableiten liesse.
          </p>
        )}

        {plan.numbers.map((entry) => {
          const room = rooms.get(entry.roomId);
          const other = entry.otherRoomId === null ? null : rooms.get(entry.otherRoomId);
          const now = current.get(entry.doorId) ?? '';
          return (
            <button
              type="button"
              key={entry.doorId}
              onClick={() => select(entry.doorId)}
              data-door-row={entry.doorId}
              className={[
                'w-full text-left px-3 py-2 border-b border-zinc-100 dark:border-zinc-900',
                selectedDoorId === entry.doorId
                  ? 'bg-emerald-50 dark:bg-emerald-950/40'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-950',
              ].join(' ')}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {entry.number}
                </span>
                <span
                  title={BASIS_HINT[entry.basis]}
                  className="text-[10px] font-mono uppercase tracking-wide text-zinc-400 dark:text-zinc-600"
                >
                  {BASIS_LABEL[entry.basis]}
                </span>
              </div>
              <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 leading-snug">
                aus {room?.number || '—'} {room?.name}
                {other ? ` → ${other.number || '—'} ${other.name}` : ' → ins Freie'}
                {now && now !== entry.number ? ` · heisst jetzt „${now}"` : ''}
              </div>
              {/* Turning the door round is one click, because the derived
                  answer is a proposal and the person reading the plan can see
                  something the graph cannot. A door with one room has no
                  other side to offer. */}
              {entry.otherRoomId !== null && (
                <span
                  role="button"
                  tabIndex={0}
                  title={entry.basis === 'manual'
                    ? 'Wieder herleiten lassen'
                    : `Stattdessen nach ${other?.number || 'dem anderen Raum'} benennen`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (entry.basis === 'manual') clearDoorNumberRoom(entry.doorId);
                    else setDoorNumberRoom(entry.doorId, entry.otherRoomId as number);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.stopPropagation();
                    if (entry.basis === 'manual') clearDoorNumberRoom(entry.doorId);
                    else setDoorNumberRoom(entry.doorId, entry.otherRoomId as number);
                  }}
                  className="mt-1 inline-block cursor-pointer rounded-sm border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 hover:border-emerald-400 dark:hover:border-emerald-700"
                >
                  {entry.basis === 'manual' ? '↺ herleiten' : '↔ andere Seite'}
                </span>
              )}
            </button>
          );
        })}

        {plan.problems.length > 0 && (
          <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800">
            <div className="text-[10px] font-mono uppercase tracking-wider text-amber-600 dark:text-amber-500 mb-1">
              {plan.problems.length} ohne Nummer
            </div>
            {plan.problems.map((problem) => {
              const sides = sidesOf.get(problem.doorId) ?? [];
              return (
                <div key={problem.doorId} className="py-1" data-door-row={problem.doorId}>
                  <button
                    type="button"
                    onClick={() => select(problem.doorId)}
                    className={[
                      'block w-full text-left text-[10px] font-mono',
                      selectedDoorId === problem.doorId
                        ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100',
                    ].join(' ')}
                  >
                    #{problem.doorId} — {PROBLEM_LABEL[problem.reason]}
                  </button>
                  {/* The one case a person can settle on the spot: the door
                      joins two rooms and neither is further out. Naming which
                      side it belongs to is a decision, so it is offered as
                      one rather than left to a rule that has run out. */}
                  {problem.reason === 'no-direction' && sides.length === 2 && (
                    <div className="flex gap-1 pt-1">
                      {sides.map((roomId) => {
                        const candidate = rooms.get(roomId);
                        return (
                          <button
                            key={roomId}
                            type="button"
                            onClick={() => setDoorNumberRoom(problem.doorId, roomId)}
                            className="flex-1 h-6 rounded-sm border border-zinc-200 dark:border-zinc-800 text-[10px] font-mono truncate px-1 hover:border-emerald-400 dark:hover:border-emerald-700"
                            title={`Diese Tür nach ${candidate?.number} ${candidate?.name} benennen`}
                          >
                            {candidate?.number || `#${roomId}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800">
        <Button
          size="sm"
          className="w-full h-8 text-[11px] font-mono bg-emerald-600 hover:bg-emerald-700"
          disabled={busy || plan.numbers.length === 0}
          onClick={apply}
        >
          {plan.numbers.length === 0
            ? 'Nichts zu schreiben'
            : `${plan.numbers.length} Türnummern schreiben`}
        </Button>
        <p className="pt-1.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-600 leading-snug">
          Schreibt die Nummer in <span className="font-semibold">Name</span> — dort liest sie
          der Grundriss — und legt je Tür einen Raumbezug zu beiden angrenzenden Räumen an.
        </p>
      </div>
    </div>
  );
}

export default DoorNumbersPanel;
