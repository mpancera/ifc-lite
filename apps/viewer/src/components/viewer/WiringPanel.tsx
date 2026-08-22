/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Verkabeln — draw one run, then write it.
 *
 * # A draft and one commit
 * Clicking devices builds a sequence and nothing else; `wireCircuit` turns it
 * into ports, connections, a circuit and the marks in a single step. That
 * split is what makes changing your mind free — and changing your mind is most
 * of what drawing a cable is. A tool that wrote a connection per click would
 * leave half a run in the file every time somebody stopped halfway.
 *
 * # The head of the run
 * A run hangs off a line controller. Click one first and it is used; start on
 * a detector instead and one is created at the first device, because a run
 * without a head has nothing to number from and nothing to report to.
 */

import { useEffect } from 'react';
import { Cable, RotateCcw, X } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useViewerStore } from '@/store';

interface WiringPanelProps {
  onClose: () => void;
}

export function WiringPanel({ onClose }: WiringPanelProps) {
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const sequence = useViewerStore((s) => s.wiringSequence);
  const ring = useViewerStore((s) => s.wiringRing);
  const popWiringPick = useViewerStore((s) => s.popWiringPick);
  const clearWiring = useViewerStore((s) => s.clearWiring);
  const wireCircuit = useViewerStore((s) => s.wireCircuit);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const models = useViewerStore((s) => s.models);

  // The tool is the panel: opening one turns the other on, and closing the
  // panel puts the pointer back. Without this a run stays half-drawn behind a
  // closed panel, and the next click in the viewport lands on a tool nobody
  // can see.
  useEffect(() => {
    setActiveTool('wiring');
    return () => {
      clearWiring();
      setActiveTool('select');
    };
  }, [setActiveTool, clearWiring]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Backspace') {
        event.preventDefault();
        popWiringPick();
      }
      if (event.key === 'Escape') clearWiring();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popWiringPick, clearWiring]);

  const store = activeModelId ? models.get(activeModelId)?.ifcDataStore : undefined;
  const nameOf = (expressId: number) =>
    store?.entities?.getName?.(expressId) || `#${expressId}`;
  const typeOf = (expressId: number) =>
    store?.entities?.getTypeName?.(expressId) ?? '';

  const head = sequence[0];
  // A run started on a controller uses it; one started on a device gets a
  // controller made at that device's spot.
  const headIsController = head !== undefined && typeOf(head) === 'IfcController';
  const devices = headIsController ? sequence.slice(1) : sequence;

  const commit = () => {
    if (!activeModelId || devices.length === 0) return;
    const result = wireCircuit(activeModelId, {
      deviceIds: devices,
      controllerId: headIsController ? head : null,
      ring,
    });
    if ('error' in result) {
      toast.error(result.error);
      return;
    }
    const parts = [
      `${result.plan.stops.length} Gerät${result.plan.stops.length === 1 ? '' : 'e'}`,
      result.plan.ring ? 'Ring' : 'Stich',
    ];
    if (result.controllerCreated) parts.push('Linienmodul angelegt');
    if (result.plan.conflicts.length > 0) {
      parts.push(`${result.plan.conflicts.length} bereits verkabelt übersprungen`);
    }
    toast.success(`${result.plan.stops[0]?.mark.split('.')[0] ?? 'Kreis'}: ${parts.join(' · ')}`);
    clearWiring();
  };

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <Cable className="h-4 w-4" />
        <span className="font-medium">Verkabeln</span>
        <span className="ml-auto text-[11px] text-zinc-500">
          {sequence.length === 0 ? 'Startpunkt wählen' : `${devices.length} Geräte${ring ? ' · Ring' : ''}`}
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="border-b border-zinc-200 px-3 py-2 text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Der Reihe nach anklicken, wie das Kabel läuft. Zuerst das Linienmodul —
        gibt es keines, wird eines angelegt. Nochmal auf den Startpunkt schliesst
        den Ring. <span className="font-mono">Backspace</span> nimmt den letzten
        Klick zurück, <span className="font-mono">Esc</span> verwirft den Lauf.
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ol className="px-3 py-2">
          {sequence.map((expressId, at) => {
            const isHead = at === 0 && headIsController;
            return (
              <li key={expressId} className="flex items-center gap-2 py-0.5">
                <span
                  className={
                    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border '
                    + (isHead
                      ? 'border-amber-500 text-amber-600'
                      : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300')
                  }
                >
                  {isHead ? '⌂' : (headIsController ? at : at + 1)}
                </span>
                <span className="truncate">{nameOf(expressId)}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] opacity-60">
                  {typeOf(expressId)}
                </span>
              </li>
            );
          })}
          {ring && (
            <li className="py-0.5 pl-7 text-[10px] italic opacity-70">
              zurück zum Startpunkt
            </li>
          )}
          {sequence.length === 0 && (
            <li className="py-1 opacity-60">Noch nichts angeklickt.</li>
          )}
        </ol>
      </ScrollArea>

      <div className="flex gap-1.5 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 text-[11px]"
          disabled={sequence.length === 0}
          onClick={popWiringPick}
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          Zurück
        </Button>
        <Button
          size="sm"
          className="h-7 flex-1 text-[11px]"
          disabled={devices.length === 0}
          onClick={commit}
        >
          Kreis anlegen
        </Button>
      </div>
    </div>
  );
}
