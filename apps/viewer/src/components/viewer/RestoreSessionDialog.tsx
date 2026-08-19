/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Shown when saved authoring work was found for a DIFFERENT version of the
 * open file. Nothing has been changed at this point — the dialog reports what
 * the reconciliation found and lets the user choose.
 *
 * Deliberately not a yes/no: a new model version usually re-plans one area, so
 * most of a planning state still fits while a few pieces do not, and which is
 * which is the whole decision.
 *
 * # Three things a reader asked for that a verdict alone cannot give
 * 1. WHICH objects — "1 Bauteil ohne Geschoss" ends in the question "which
 *    one?", so every row with objects behind it opens to name them.
 * 2. What the button will DO — the primary action says how many objects it
 *    applies and, when something is held back, that the rest stays saved
 *    rather than being thrown away.
 * 3. Which action is dangerous — discarding is the only irreversible choice
 *    here, so it is styled as such and asks once before it deletes.
 */

import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { restoreCounts } from '@/lib/persistence/reconcileSnapshot';
import { entityLabels, moreLabel, ENTITY_LIST_LIMIT } from '@/lib/persistence/reconcileMessages';
import type { ReconcileItem, ReconcileVerdict, OverlaySnapshot } from '@/lib/persistence/types';
import type { PendingRestore } from '@/hooks/useOverlayAutosave';

const VERDICT_ICON: Record<ReconcileVerdict, typeof Check> = {
  ok: Check,
  suspect: AlertTriangle,
  orphaned: X,
};

const VERDICT_CLASS: Record<ReconcileVerdict, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  suspect: 'text-amber-600 dark:text-amber-400',
  orphaned: 'text-red-600 dark:text-red-400',
};

function ReportRow({
  item, snapshot, expanded, onToggle,
}: {
  item: ReconcileItem;
  snapshot: OverlaySnapshot;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = VERDICT_ICON[item.verdict];
  // Edits and deletions ride on their own GlobalIds and list no authored
  // objects, so there is nothing for them to open to.
  const openable = item.expressIds.length > 0;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const names = expanded ? entityLabels(snapshot, item.expressIds.slice(0, ENTITY_LIST_LIMIT)) : [];
  const hidden = item.expressIds.length - names.length;

  return (
    <div className={`border-b border-zinc-100 dark:border-zinc-900 ${
      item.verdict === 'suspect' ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''
    }`}>
      <div
        className={`flex gap-2.5 px-4 py-2.5 ${openable ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50' : ''}`}
        {...(openable
          ? { role: 'button', tabIndex: 0, 'aria-expanded': expanded, onClick: onToggle }
          : {})}
      >
        <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${VERDICT_CLASS[item.verdict]}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-zinc-900 dark:text-zinc-100">{item.label}</p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">{item.detail}</p>
        </div>
        {openable && (
          <Chevron className="h-3.5 w-3.5 shrink-0 mt-0.5 text-zinc-400" aria-hidden="true" />
        )}
      </div>

      {expanded && (
        <ul className="px-4 pb-2.5 pl-11 space-y-0.5">
          {names.map((name, i) => (
            <li key={i} className="text-[11px] font-mono text-zinc-600 dark:text-zinc-300">{name}</li>
          ))}
          {hidden > 0 && (
            <li className="text-[11px] font-mono text-zinc-400">{moreLabel(hidden)}</li>
          )}
        </ul>
      )}
    </div>
  );
}

export interface RestoreSessionDialogProps {
  pending: PendingRestore | null;
  currentModelName: string;
  onAcceptUndisputed: () => void;
  onAcceptAll: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
}

export function RestoreSessionDialog({
  pending,
  currentModelName,
  onAcceptUndisputed,
  onAcceptAll,
  onDiscard,
  onDismiss,
}: RestoreSessionDialogProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  // Deleting saved planning work is the one thing here that cannot be undone,
  // so it takes two clicks — and the second one says what it deletes.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  if (!pending) return null;
  const { snapshot, report } = pending;
  const hasDoubt = report.counts.suspect > 0 || report.counts.orphaned > 0;
  const counts = restoreCounts(report);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base">Gespeicherter Planungsstand gefunden</DialogTitle>
          <DialogDescription className="text-[13px]">
            Die geöffnete Datei ist eine andere Version als die, an der zuletzt gearbeitet wurde.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-3 flex items-center gap-2 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
          <span>{snapshot.modelName}</span>
          <span aria-hidden="true">→</span>
          <span className="text-zinc-900 dark:text-zinc-100">{currentModelName}</span>
        </div>

        <ScrollArea className="max-h-[45vh] border-t border-zinc-200 dark:border-zinc-800">
          {report.items.map((item, i) => (
            <ReportRow
              key={i}
              item={item}
              snapshot={snapshot}
              expanded={expanded === i}
              onToggle={() => setExpanded(expanded === i ? null : i)}
            />
          ))}
        </ScrollArea>

        <DialogFooter className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 sm:justify-between gap-2">
          <span className="text-[11px] text-zinc-400 dark:text-zinc-600 self-center mr-auto max-w-[16rem] leading-snug">
            {confirmingDiscard
              ? `Löscht den gespeicherten Stand von „${snapshot.modelName}“ endgültig.`
              : hasDoubt
                ? `${counts.held} strittige Objekte bleiben gespeichert und gehen nicht verloren. `
                  + 'Das Übernommene steht danach in der Änderungsliste.'
                : 'Nichts wurde bisher verändert — das Übernommene steht danach in der Änderungsliste.'}
          </span>
          <div className="flex gap-2">
            {confirmingDiscard ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDiscard(false)}>
                  Abbrechen
                </Button>
                <Button variant="destructive" size="sm" onClick={onDiscard}>
                  Endgültig löschen
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700 dark:text-red-400"
                  onClick={() => setConfirmingDiscard(true)}
                >
                  Verwerfen
                </Button>
                <Button variant="outline" size="sm" onClick={onDismiss}>Später entscheiden</Button>
                <Button size="sm" onClick={hasDoubt ? onAcceptUndisputed : onAcceptAll}>
                  {hasDoubt
                    ? `${counts.undisputed} Unstrittige übernehmen`
                    : `Übernehmen (${counts.undisputed})`}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
