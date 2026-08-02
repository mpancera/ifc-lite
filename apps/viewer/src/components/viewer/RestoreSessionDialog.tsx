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
 */

import { AlertTriangle, Check, X } from 'lucide-react';
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
import type { ReconcileItem, ReconcileVerdict } from '@/lib/persistence/types';
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

function ReportRow({ item }: { item: ReconcileItem }) {
  const Icon = VERDICT_ICON[item.verdict];
  return (
    <div className={`flex gap-2.5 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-900 ${
      item.verdict === 'suspect' ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''
    }`}>
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${VERDICT_CLASS[item.verdict]}`} />
      <div className="min-w-0">
        <p className="text-[13px] text-zinc-900 dark:text-zinc-100">{item.label}</p>
        <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">{item.detail}</p>
      </div>
    </div>
  );
}

interface RestoreSessionDialogProps {
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
  if (!pending) return null;
  const { snapshot, report } = pending;
  const hasDoubt = report.counts.suspect > 0 || report.counts.orphaned > 0;

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
          {report.items.map((item, i) => <ReportRow key={i} item={item} />)}
        </ScrollArea>

        <DialogFooter className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 sm:justify-between gap-2">
          <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-600 self-center mr-auto">
            Nichts wurde bisher verändert
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onDiscard}>Verwerfen</Button>
            <Button variant="outline" size="sm" onClick={onDismiss}>Später entscheiden</Button>
            <Button size="sm" onClick={hasDoubt ? onAcceptUndisputed : onAcceptAll}>
              {hasDoubt ? 'Unstrittige übernehmen' : 'Übernehmen'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
