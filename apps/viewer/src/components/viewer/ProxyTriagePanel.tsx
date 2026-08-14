/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Working through a model's `IfcBuildingElementProxy` elements, by group.
 *
 * # A list of groups, never a list of elements
 * "Eine mühselige Krankheit vieler Modellautoren" (Marc, 2026-08-13) — and the
 * models that have this have it in the thousands. So the list shows GROUPS: a
 * class is chosen once and every member takes it. The element count is on the
 * row so it is obvious how much one decision is worth.
 *
 * # Selecting a group before deciding it
 * Clicking a row selects its members in the viewer. Deciding what several
 * hundred nameless elements are, without being able to see which ones they
 * are, is guesswork; this is what makes it not guesswork.
 *
 * # The class comes from the catalogue
 * Free text would put a new spelling of `IfcLightFixture` in the file every
 * time. The picker searches the synced Fachklassen list, so what lands in the
 * model is an entity and a PredefinedType that exist.
 */

import React, { useMemo, useState } from 'react';
import { Boxes, Check, Search, Eye, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useProxyTriage } from '@/hooks/useProxyTriage';
import {
  groupProxies, suggestAxes, summariseGroups, groupSearchTerm, AXIS_ORDER, AXIS_LABELS,
  type ProxyGroup, type ProxyGroupAxis,
} from '@/lib/proxyTriage/proxyGroups';
import {
  proxyWrites, describeDecision, psetNotice, countUndecided,
  type ProxyDecision,
} from '@/lib/proxyTriage/proxyDecisions';
import { useClassCatalog } from '@/lib/classCatalog/useClassCatalog';
import { searchClassCatalog, describeClass } from '@/lib/classCatalog/classCatalog';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';

export interface ProxyTriagePanelProps {
  trigger: React.ReactNode;
}

export function ProxyTriagePanel({ trigger }: ProxyTriagePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { elements, hasModel, alreadyStated } = useProxyTriage(open);
  const catalog = useClassCatalog();

  const [axes, setAxes] = useState<ProxyGroupAxis[] | null>(null);
  const [decisions, setDecisions] = useState<Map<string, ProxyDecision>>(new Map());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [keepWord, setKeepWord] = useState('');

  const activeModelId = useViewerStore((state) => state.activeModelId);
  const ensureMutationView = useViewerStore((state) => state.ensureMutationView);
  const setEntityType = useViewerStore((state) => state.setEntityType);
  const setAttribute = useViewerStore((state) => state.setAttribute);
  const canAuthorOn = useViewerStore((state) => state.canAuthorOn);
  const setSelectedEntities = useViewerStore((state) => state.setSelectedEntities);

  // The suggestion is the starting point, not a lock: once the user has
  // changed the axes, their choice stands even as the list shortens.
  const suggested = useMemo(() => suggestAxes(elements), [elements]);
  const activeAxes = axes ?? suggested;
  const groups = useMemo(() => groupProxies(elements, activeAxes), [elements, activeAxes]);
  const active = groups.find((group) => group.key === activeKey) ?? null;
  const open_ = countUndecided(groups, decisions);

  // An empty term makes `searchClassCatalog` return the head of 1330 entries
  // alphabetically, which here would be eight classes chosen by nothing. The
  // picker stays quiet until there is something to look for.
  const matches = useMemo(
    () => (active && query.trim() ? searchClassCatalog(catalog, query, 8) : []),
    [catalog, query, active],
  );

  const toggleAxis = (axis: ProxyGroupAxis) => {
    const next = activeAxes.includes(axis)
      ? activeAxes.filter((a) => a !== axis)
      : [...AXIS_ORDER].filter((a) => a === axis || activeAxes.includes(a));
    setAxes(next);
    setActiveKey(null);
  };

  const showGroup = (group: ProxyGroup) => {
    setActiveKey(group.key === activeKey ? null : group.key);
    // The author's own word for the group is the first thing worth searching
    // for, and where they gave one it is usually the answer.
    setQuery(groupSearchTerm(group));
    setKeepWord('');
    if (!activeModelId) return;
    setSelectedEntities(group.members.map((expressId) => ({ modelId: activeModelId, expressId })));
  };

  const decide = (group: ProxyGroup, decision: ProxyDecision) => {
    setDecisions((previous) => new Map(previous).set(group.key, decision));
  };

  /** Write one group's decision into the model. */
  const apply = (group: ProxyGroup) => {
    const decision = decisions.get(group.key) ?? { kind: 'undecided' as const };
    const writes = proxyWrites(group, decision);
    if (writes.length === 0 || !activeModelId) return;

    // The overlay has to exist before anything can be written to it, and the
    // role has to permit writing at all — a silent `null` from `setEntityType`
    // is otherwise indistinguishable from success.
    ensureMutationView(activeModelId);
    const permission = canAuthorOn(activeModelId, writes[0].expressId);
    if (!permission.allowed) {
      toast.error(permission.reason ?? 'Das Modell ist schreibgeschützt.');
      return;
    }

    let written = 0;
    for (const write of writes) {
      const result = setEntityType(
        activeModelId, write.expressId, write.entity, write.predefinedType ?? undefined,
      );
      if (!result) continue;
      if (write.objectType !== null) {
        setAttribute(activeModelId, write.expressId, 'ObjectType', write.objectType);
      }
      written += 1;
    }

    const notice = psetNotice(decision);
    const headline = `${written} von ${writes.length} übernommen`;
    if (written === 0) toast.error(headline);
    else toast.success(notice ? `${headline}. ${notice}` : headline);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl text-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Boxes className="h-4 w-4 text-muted-foreground" />
            Proxy-Triage
          </DialogTitle>
          <DialogDescription className="text-xs leading-tight">
            Elemente ohne Fachklasse, in Gruppen. Eine Gruppe wird einmal
            entschieden und gilt für alle ihre Mitglieder.
          </DialogDescription>
        </DialogHeader>

        {!hasModel && <p className="py-6 text-center text-muted-foreground">Kein Modell geladen.</p>}

        {hasModel && elements.length === 0 && (
          <p className="py-6 text-center text-muted-foreground">
            {alreadyStated > 0
              ? `Nichts offen — alle ${alreadyStated} Proxy-Elemente sind erklärt.`
              : 'Keine Proxy-Elemente — in diesem Modell hat jedes Element eine Fachklasse.'}
          </p>
        )}

        {elements.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-1.5 border-b pb-2">
              <span className="text-muted-foreground">Gruppieren nach</span>
              {AXIS_ORDER.map((axis) => (
                <Button
                  key={axis}
                  size="sm"
                  variant={activeAxes.includes(axis) ? 'default' : 'outline'}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => toggleAxis(axis)}
                >
                  {AXIS_LABELS[axis]}
                </Button>
              ))}
              <span className="ml-auto tabular-nums text-muted-foreground">
                {summariseGroups(groups)} · {open_} offen
                {alreadyStated > 0 && ` · ${alreadyStated} bereits erklärt`}
              </span>
            </div>

            <div className="max-h-[22rem] overflow-y-auto">
              {groups.map((group) => {
                const decision = decisions.get(group.key) ?? { kind: 'undecided' as const };
                const isActive = group.key === activeKey;
                return (
                  <div key={group.key} className="border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => showGroup(group)}
                      className={`flex w-full items-center gap-2 px-1 py-1.5 text-left hover:bg-muted/60 ${
                        isActive ? 'bg-muted/60' : ''
                      }`}
                    >
                      <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{group.label}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                        {group.members.length}
                      </span>
                      {decision.kind !== 'undecided' && (
                        <Check className="h-3 w-3 shrink-0 text-emerald-600" />
                      )}
                    </button>

                    {isActive && (
                      <div className="space-y-1.5 bg-muted/30 px-2 py-2">
                        <p className="text-muted-foreground">{describeDecision(group, decision)}</p>

                        {!catalog && (
                          <p className="text-muted-foreground">
                            Noch kein Objektkatalog abgeglichen — unter Datei → Objektkatalog.
                          </p>
                        )}

                        {catalog && (
                          <div className="relative">
                            <Search className="absolute left-1.5 top-1.5 h-3 w-3 text-muted-foreground" />
                            <Input
                              value={query}
                              onChange={(event) => setQuery(event.target.value)}
                              placeholder="Fachklasse suchen, z. B. Leuchte"
                              className="h-6 pl-6 text-xs"
                            />
                          </div>
                        )}

                        {matches.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => decide(group, {
                              kind: 'reclassify',
                              entity: entry.entity,
                              predefinedType: entry.predefinedType,
                              objectType: entry.objectType,
                            })}
                            className="block w-full truncate rounded-sm px-1.5 py-1 text-left hover:bg-muted"
                            title={entry.definition}
                          >
                            {describeClass(entry)}
                          </button>
                        ))}

                        <div className="flex items-center gap-1.5 pt-1">
                          <Ban className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <Input
                            value={keepWord}
                            onChange={(event) => setKeepWord(event.target.value)}
                            placeholder="Bleibt bewusst Proxy, als …"
                            className="h-6 text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 shrink-0 px-2 text-[11px]"
                            disabled={keepWord.trim().length === 0}
                            onClick={() => decide(group, { kind: 'keep', objectType: keepWord })}
                          >
                            Merken
                          </Button>
                        </div>

                        <Button
                          size="sm"
                          className="h-6 w-full text-[11px]"
                          disabled={decision.kind === 'undecided'}
                          onClick={() => apply(group)}
                        >
                          Auf {group.members.length} Elemente anwenden
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ProxyTriagePanel;
