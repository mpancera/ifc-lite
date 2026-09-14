/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Prüfung des DataHarmonizer-Entwurfs: bestätigen, korrigiert, verwerfen.
 *
 * Der Entwurf kommt als IFC mit `Pset_DataHarmonizer` je Element. Hier sieht
 * die Rolle Editor jedes vorgeschlagene Element mit Konfidenz und Begründung,
 * springt hin, und setzt den Status. Der Status ist eine gewöhnliche
 * Merkmal-Mutation, also geht er mit „Änderungen exportieren" in die Datei —
 * und von dort liest der Harmonizer ihn beim nächsten Lauf zurück.
 *
 * Bestätigen im Block (alle Vertrauenswürdigen auf einmal) ist erlaubt, aber
 * ein eigener Knopf mit Zahl, kein Standard: wer ihn drückt, weiss, was er
 * bestätigt.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, Crosshair, PenLine, X, XCircle } from 'lucide-react';
import { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { configureMutationView } from '@/utils/configureMutationView';
import { EDITOR_ROLE_ID } from '@/lib/roles/disciplineRoles';
import {
  listHarmonizerElements,
  setReviewStatus,
  summarizeReview,
  type ConfidenceBand,
  type HarmonizerElement,
  type ReviewStatus,
} from '@/lib/harmonizer/reviewStatus';

interface HarmonizerReviewPanelProps {
  onClose: () => void;
}

const STATUS_LABEL: Record<ReviewStatus, string> = { auto: 'automatisch', confirmed: 'bestätigt', corrected: 'korrigiert', rejected: 'verworfen' };
const STATUS_CLASS: Record<ReviewStatus, string> = {
  auto: 'text-muted-foreground',
  confirmed: 'text-emerald-600 dark:text-emerald-400',
  corrected: 'text-sky-600 dark:text-sky-400',
  rejected: 'text-red-600 dark:text-red-400',
};
const BAND_LABEL: Record<ConfidenceBand, string> = { high: 'sicher', review: 'prüfen', low: 'zweifelhaft' };
const BAND_CLASS: Record<ConfidenceBand, string> = { high: 'bg-emerald-500', review: 'bg-amber-500', low: 'bg-red-500' };

export function HarmonizerReviewPanel({ onClose }: HarmonizerReviewPanelProps) {
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const models = useViewerStore((s) => s.models);
  const legacyStore = useViewerStore((s) => s.ifcDataStore);
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const getMutationView = useViewerStore((s) => s.getMutationView);
  const registerMutationView = useViewerStore((s) => s.registerMutationView);
  const bumpMutationVersion = useViewerStore((s) => s.bumpMutationVersion);
  const roleId = useViewerStore((s) => s.activeDisciplineSystemId);
  const setSelectedEntityIds = useViewerStore((s) => s.setSelectedEntityIds);
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>('all');
  const [bandFilter, setBandFilter] = useState<ConfidenceBand | 'all'>('all');

  const dataStore: IfcDataStore | null = (activeModelId ? models.get(activeModelId)?.ifcDataStore : null) ?? legacyStore ?? null;
  const isEditor = roleId === EDITOR_ROLE_ID;

  // Die Mutationssicht des Modells, angelegt wie im Bulk-Editor, damit der Status als gewöhnliche Merkmal-Mutation läuft.
  useEffect(() => {
    if (!activeModelId || !dataStore) return;
    if (getMutationView(activeModelId)) return;
    const view = new MutablePropertyView(dataStore.properties || null, activeModelId);
    configureMutationView(view, dataStore);
    registerMutationView(activeModelId, view);
  }, [activeModelId, dataStore, getMutationView, registerMutationView]);

  const view = activeModelId ? mutationViews.get(activeModelId) : undefined;

  const elements = useMemo<HarmonizerElement[]>(() => {
    if (!dataStore || !view) return [];
    return listHarmonizerElements(dataStore, view);
    // `mutationVersion` is what changes when a status is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataStore, view, mutationVersion]);
  const summary = useMemo(() => summarizeReview(elements), [elements]);
  const visible = useMemo(
    () => elements.filter((e) => (statusFilter === 'all' || e.status === statusFilter) && (bandFilter === 'all' || e.band === bandFilter)),
    [elements, statusFilter, bandFilter],
  );

  const apply = (ids: number[], status: ReviewStatus) => {
    if (!view || ids.length === 0) return;
    if (!isEditor) {
      toast.error('Zum Prüfen die Rolle „Editor" wählen — nur sie korrigiert das Referenzmodell.');
      return;
    }
    for (const id of ids) setReviewStatus(view, id, status);
    bumpMutationVersion();
    toast.success(`${ids.length} Element${ids.length === 1 ? '' : 'e'} ${STATUS_LABEL[status]}`);
  };

  const jumpTo = (e: HarmonizerElement) => {
    setSelectedEntityIds([e.expressId]);
    requestAnimationFrame(() => useViewerStore.getState().cameraCallbacks.frameSelection?.());
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[12px] font-medium">Prüfung DataHarmonizer</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <p className="border-b px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Jedes vorgeschlagene Element mit Konfidenz und Begründung aus <span className="font-mono">Pset_DataHarmonizer</span>.
        Bestätigen, als korrigiert markieren oder verwerfen; verworfene bleiben als Marke in der Datei, damit der nächste
        Lauf sie nicht wieder anlegt. Der Status geht mit „Änderungen exportieren" in die Datei.
      </p>

      {!isEditor && (
        <p className="border-b bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          Nur die Rolle „Editor" prüft. Unter Architecture → Role auf „Editor" wechseln.
        </p>
      )}

      {elements.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-[10px]">
          {(['all', 'auto', 'confirmed', 'corrected', 'rejected'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`rounded border px-1.5 py-0.5 ${statusFilter === s ? 'bg-accent' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? `alle ${summary.total}` : `${summary.byStatus[s]} ${STATUS_LABEL[s]}`}
            </button>
          ))}
          <span className="mx-1 text-muted-foreground">·</span>
          {(['all', 'high', 'review', 'low'] as const).map((b) => (
            <button
              key={b}
              type="button"
              className={`rounded border px-1.5 py-0.5 ${bandFilter === b ? 'bg-accent' : ''}`}
              onClick={() => setBandFilter(b)}
            >
              {b === 'all' ? 'jede Konfidenz' : `${summary.byBand[b]} ${BAND_LABEL[b]}`}
            </button>
          ))}
        </div>
      )}

      <ScrollArea className="flex-1">
        {!dataStore ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">Kein Modell geladen.</p>
        ) : elements.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            Kein Element trägt <span className="font-mono">Pset_DataHarmonizer</span>.
            <br />
            Dieses Panel prüft Entwürfe aus dem DataHarmonizer; ein gewöhnliches Modell hat hier nichts zu tun.
          </p>
        ) : (
          <ul className="divide-y">
            {visible.map((e) => (
              <li key={e.expressId} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${BAND_CLASS[e.band]}`} title={`${BAND_LABEL[e.band]} · ${e.reasons}`} />
                  <button type="button" className="flex-1 truncate text-left text-[12px] hover:underline" onClick={() => jumpTo(e)} title={e.reasons}>
                    <span className="text-muted-foreground">{e.typeName}</span> {e.name || <span className="text-muted-foreground">ohne Namen</span>}
                  </button>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{e.confidence.toFixed(2)}</span>
                  <span className={`shrink-0 text-[10px] ${STATUS_CLASS[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" title="Hinspringen" onClick={() => jumpTo(e)}>
                    <Crosshair className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600" title="Bestätigen: das Element ist richtig" disabled={!isEditor || e.status === 'confirmed'} onClick={() => apply([e.expressId], 'confirmed')}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-sky-600" title="Korrigiert: das Element wurde hier geändert" disabled={!isEditor || e.status === 'corrected'} onClick={() => apply([e.expressId], 'corrected')}>
                    <PenLine className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600" title="Verwerfen: falsch erkannt, beim nächsten Lauf nicht wieder anlegen" disabled={!isEditor || e.status === 'rejected'} onClick={() => apply([e.expressId], 'rejected')}>
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                  {e.editedHere && e.status === 'auto' && (
                    <span className="ml-1 text-[10px] text-sky-600 dark:text-sky-400">hier geändert → korrigiert?</span>
                  )}
                  {e.sourceLayer && <span className="ml-auto font-mono text-[10px] text-muted-foreground">{e.sourceLayer}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      {elements.length > 0 && (
        <div className="border-t px-3 py-2">
          <Button
            size="sm"
            className="h-8 w-full bg-emerald-600 text-[11px] hover:bg-emerald-700"
            disabled={!isEditor || summary.confirmable === 0}
            title="Alle noch automatischen Elemente mit Konfidenz ≥ 0.8 auf einen Klick bestätigen — bewusst, nicht als Vorgabe"
            onClick={() => apply(elements.filter((e) => e.status === 'auto' && e.band === 'high').map((e) => e.expressId), 'confirmed')}
          >
            {summary.confirmable} sichere Elemente bestätigen
          </Button>
        </div>
      )}
    </div>
  );
}
