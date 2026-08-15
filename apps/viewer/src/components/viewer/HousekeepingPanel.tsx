/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Housekeeping — the model's Prüfplan.
 *
 * # A plan, not a warning list
 * Every check is a row, including the ones that pass. "Georeferenzierung —
 * geprüft, in Ordnung" is a thing the user needs to be able to read; a panel
 * that only listed problems could never say it, and the difference between
 * that and a checklist is the whole of Marc's request (2026-08-13).
 *
 * # Three states, because two is not enough
 * Behoben, bewusst so gelassen, oder offen. Without the middle one a plan
 * grows back to full length on every pass and the user learns to skip it —
 * the same reason the proxy triage lets an author declare a proxy deliberate.
 *
 * # It sends work elsewhere rather than doing it
 * A finding names the tool that answers it and opens that tool. The panel that
 * assigns classes is the triage; the one that fixes coordinates is the
 * georeferencing panel. A second place to do the same edits would be a second
 * place for it to be done differently.
 */

import React, { useState } from 'react';
import {
  ClipboardList, CheckCircle2, AlertTriangle, XCircle, Info, MinusCircle,
  ChevronRight, ChevronDown, Eye, Undo2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useHousekeeping } from '@/hooks/useHousekeeping';
import {
  summariseChecks, formatProgress,
  type CheckState, type FindingSeverity, type HousekeepingFinding, type RemedyTarget,
} from '@/lib/housekeeping/findings';
import { useViewerStore } from '@/store';

const STATE_ICON: Record<CheckState, React.ComponentType<{ className?: string }>> = {
  clean: CheckCircle2,
  open: AlertTriangle,
  accepted: CheckCircle2,
  unavailable: MinusCircle,
};

const STATE_CLASS: Record<CheckState, string> = {
  clean: 'text-emerald-600',
  open: 'text-amber-600',
  accepted: 'text-muted-foreground',
  unavailable: 'text-muted-foreground/60',
};

const STATE_WORD: Record<CheckState, string> = {
  clean: 'in Ordnung',
  open: 'offen',
  accepted: 'bewusst so',
  unavailable: 'nicht prüfbar',
};

const SEVERITY_ICON: Record<FindingSeverity, React.ComponentType<{ className?: string }>> = {
  error: XCircle, warning: AlertTriangle, info: Info,
};

const SEVERITY_CLASS: Record<FindingSeverity, string> = {
  error: 'text-red-600', warning: 'text-amber-600', info: 'text-muted-foreground',
};

export function HousekeepingPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const { results, hasModel, canRemember, accept, unaccept } = useHousekeeping(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const activeModelId = useViewerStore((state) => state.activeModelId);
  const setSelectedEntities = useViewerStore((state) => state.setSelectedEntities);
  const openPanel = useViewerStore((state) => state.setSidebarActivePanel);

  const summary = summariseChecks(results);

  const toggle = (checkId: string) => {
    const next = new Set(expanded);
    if (next.has(checkId)) next.delete(checkId);
    else next.add(checkId);
    setExpanded(next);
  };

  const show = (finding: HousekeepingFinding) => {
    if (!activeModelId || finding.elements.length === 0) return;
    setSelectedEntities(
      finding.elements.map((expressId) => ({ modelId: activeModelId, expressId })),
    );
  };

  /** Where a remedy lives today. The finding names the destination; this
   *  knows which panel currently hosts it. */
  const goTo = (target: RemedyTarget) => {
    // Georeferencing is a section of the Information panel, not a panel of its
    // own — so both land in the same place, for now.
    if (target === 'georeference' || target === 'properties') openPanel('properties');
    else if (target === 'ids') openPanel('ids');
    else if (target === 'proxy-triage') openPanel('proxyTriage');
  };

  const renderFinding = (finding: HousekeepingFinding, isAccepted: boolean) => {
    const Icon = SEVERITY_ICON[finding.severity];
    return (
      <div key={finding.id} className="border-t px-2 py-2 first:border-t-0">
        <div className="flex items-start gap-1.5">
          <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
            isAccepted ? 'text-muted-foreground/60' : SEVERITY_CLASS[finding.severity]
          }`} />
          <div className="min-w-0 flex-1">
            <div className={isAccepted ? 'text-muted-foreground line-through' : ''}>
              {finding.title}
            </div>
            <p className="mt-0.5 leading-tight text-muted-foreground">{finding.detail}</p>

            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {finding.elements.length > 0 && (
                <Button
                  size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                  onClick={() => show(finding)}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  Im Modell zeigen
                </Button>
              )}

              {finding.remedy && (
                <Button
                  size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                  onClick={() => goTo(finding.remedy!.target)}
                >
                  {finding.remedy.label}
                </Button>
              )}

              <Button
                size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                onClick={() => (isAccepted ? unaccept(finding.id) : accept(finding.id))}
              >
                {isAccepted
                  ? <><Undo2 className="mr-1 h-3 w-3" />Wieder aufnehmen</>
                  : 'Bewusst so lassen'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <ClipboardList className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Housekeeping</span>
        <span className="ml-auto tabular-nums text-muted-foreground">
          {hasModel ? formatProgress(summary) : ''}
        </span>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!hasModel ? (
        <p className="p-4 text-center text-muted-foreground">Kein Modell geladen.</p>
      ) : (
        <ScrollArea className="flex-1">
          {summary.open > 0 && summary.affectedElements > 0 && (
            <p className="border-b bg-muted/40 px-2 py-1.5 text-muted-foreground">
              {summary.affectedElements.toLocaleString('de-CH')} Elemente sind von mindestens
              einem offenen Punkt betroffen.
            </p>
          )}

          {results.map((result) => {
            const Icon = STATE_ICON[result.state];
            const isOpen = expanded.has(result.checkId);
            const total = result.findings.length + result.accepted.length;
            return (
              <div key={result.checkId} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(result.checkId)}
                  disabled={total === 0}
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {total > 0
                    ? (isOpen
                      ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />)
                    : <span className="w-3 shrink-0" />}
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${STATE_CLASS[result.state]}`} />
                  <span className="truncate">{result.title}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {result.state === 'unavailable'
                      ? result.unavailableReason
                      : STATE_WORD[result.state]}
                  </span>
                </button>

                {isOpen && (
                  <div className="bg-muted/30">
                    {result.findings.map((f) => renderFinding(f, false))}
                    {result.accepted.map((f) => renderFinding(f, true))}
                  </div>
                )}
              </div>
            );
          })}

          {!canRemember && (
            <p className="px-2 py-2 leading-tight text-muted-foreground">
              Dieses Modell hat keine IfcProject-GlobalId. „Bewusst so lassen" gilt
              deshalb nur für diese Sitzung.
            </p>
          )}
        </ScrollArea>
      )}
    </div>
  );
}

export default HousekeepingPanel;
