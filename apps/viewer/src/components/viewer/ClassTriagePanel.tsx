/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Working through elements whose class says too little, by group.
 *
 * The sibling of `ProxyTriagePanel`, deliberately shaped the same way: the
 * same grouping module, the same decide-once-per-group rule, the same
 * select-before-you-decide. Two things differ, and both matter.
 *
 * # The candidates are narrowed to what the class can become
 * A proxy could be anything, so its picker searches all 1330 Fachklassen. An
 * `IfcFlowSegment` can only become one of its own subtypes — pipe, duct,
 * cable, cable carrier. Offering the whole catalogue here would invite a wrong
 * answer where the right list is four items long, so the list is those four
 * and the search only narrows it further.
 *
 * # "Nur die Klasse" is the deliberate answer
 * Marc, 2026-08-15: "Über eine 'bewusste' Aktion kann der User auch nur die
 * 'Klasse' angeben." A Zwischenklasse has no `PredefinedType` to fill in, so
 * stating the class IS all there is to state — and saying so on purpose is a
 * decision, not a gap. Recorded the same way a deliberate proxy is: the class
 * stays, and `ObjectType` carries the author's own word.
 *
 * An ABSTRACT class cannot be kept. `IfcElement` is not something an element
 * may legally be, so "leave it as it is" is not on offer there — the row says
 * so instead of presenting a button that would write an invalid file.
 */

import React, { useMemo, useState } from 'react';
import { Blocks, Check, Search, Eye, Ban, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useClassTriage } from '@/hooks/useClassTriage';
import {
  groupProxies, suggestAxes, summariseGroups, AXIS_ORDER, AXIS_LABELS,
  type ProxyGroup, type ProxyGroupAxis,
} from '@/lib/proxyTriage/proxyGroups';
import {
  proxyWrites, describeDecision, psetNotice, countUndecided,
  type ProxyDecision,
} from '@/lib/proxyTriage/proxyDecisions';
import {
  candidateSubclasses, genericClassKind, GENERIC_CLASS_LABELS,
} from '@/lib/classTriage/genericClasses';
import { useClassCatalog } from '@/lib/classCatalog/useClassCatalog';
import { describeClass, type ClassCatalogEntry } from '@/lib/classCatalog/classCatalog';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';

/** The class axis is not optional here — see `suggestAxes`. */
const REQUIRED_AXES: readonly ProxyGroupAxis[] = ['class'];

export interface ClassTriagePanelProps {
  trigger: React.ReactNode;
}

export function ClassTriagePanel({ trigger }: ClassTriagePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { elements, hasModel, alreadyStated } = useClassTriage(open);
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

  const suggested = useMemo(() => suggestAxes(elements, REQUIRED_AXES), [elements]);
  const activeAxes = axes ?? suggested;
  const groups = useMemo(() => groupProxies(elements, activeAxes), [elements, activeAxes]);
  const active = groups.find((group) => group.key === activeKey) ?? null;
  const stillOpen = countUndecided(groups, decisions);

  /** The class every member of a group is on — the first axis value. */
  const classOf = (group: ProxyGroup): string => group.values[activeAxes.indexOf('class')] ?? '';

  /**
   * What the active group may become: its own subclasses, as the catalogue
   * describes them, filtered by whatever has been typed.
   *
   * Falls back to the bare entity names where the catalogue has no entry (or
   * has not been synced), so the picker still works without it — a narrowed
   * list of real IFC classes is useful even with no labels on them.
   */
  const candidates = useMemo(() => {
    if (!active) return { entries: [] as ClassCatalogEntry[], bare: [] as string[] };
    const allowed = new Set(candidateSubclasses(classOf(active)));
    const term = query.trim().toLowerCase();
    const matches = (text: string) => !term || text.toLowerCase().includes(term);

    const entries = (catalog?.entries ?? []).filter(
      (entry) => allowed.has(entry.entity) && (matches(entry.label) || matches(entry.id)),
    );
    const covered = new Set(entries.map((entry) => entry.entity));
    const bare = [...allowed].filter((name) => !covered.has(name) && matches(name)).sort();
    return { entries: entries.slice(0, 40), bare: bare.slice(0, 40) };
  }, [active, activeAxes, catalog, query]);

  const toggleAxis = (axis: ProxyGroupAxis) => {
    if (REQUIRED_AXES.includes(axis)) return;
    const next = activeAxes.includes(axis)
      ? activeAxes.filter((a) => a !== axis)
      : [...AXIS_ORDER].filter((a) => a === axis || activeAxes.includes(a));
    setAxes(next);
    setActiveKey(null);
  };

  const showGroup = (group: ProxyGroup) => {
    setActiveKey(group.key === activeKey ? null : group.key);
    // No prefill, unlike the proxy triage. There the catalogue is 1330 entries
    // and a search term is the only way in; here the candidates are the class's
    // own subtypes — four of them under IfcFlowSegment — so the whole list fits
    // on screen and typing only narrows it. Prefilling with what the author
    // wrote ("Sicherheitsleuchten") matched no IFC class name and hid the four.
    setQuery('');
    setKeepWord('');
    if (!activeModelId) return;
    setSelectedEntities(group.members.map((expressId) => ({ modelId: activeModelId, expressId })));
  };

  const decide = (group: ProxyGroup, decision: ProxyDecision) => {
    setDecisions((previous) => new Map(previous).set(group.key, decision));
  };

  const apply = (group: ProxyGroup) => {
    const decision = decisions.get(group.key) ?? { kind: 'undecided' as const };
    const writes = proxyWrites(group, decision);
    if (writes.length === 0 || !activeModelId) return;

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
      // A "keep" writes no new class, so `setEntityType` returning null is the
      // normal case there — what matters is that the ObjectType lands.
      const kept = decision.kind === 'keep';
      if (!result && !kept) continue;
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
            <Blocks className="h-4 w-4 text-muted-foreground" />
            Zwischenklassen und abstrakte Klassen
          </DialogTitle>
          <DialogDescription className="text-xs leading-tight">
            Elemente auf einer Klasse, die noch keine Fachklasse ist — etwa
            IfcFlowSegment statt IfcPipeSegment. Eine Gruppe wird einmal
            entschieden und gilt für alle ihre Mitglieder.
          </DialogDescription>
        </DialogHeader>

        {!hasModel && <p className="py-6 text-center text-muted-foreground">Kein Modell geladen.</p>}

        {hasModel && elements.length === 0 && (
          <p className="py-6 text-center text-muted-foreground">
            {alreadyStated > 0
              ? `Nichts offen — alle ${alreadyStated} Elemente auf einer Zwischenklasse sind erklärt.`
              : 'Nichts zu tun — jedes Element sitzt auf einer echten Fachklasse.'}
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
                  disabled={REQUIRED_AXES.includes(axis)}
                  title={REQUIRED_AXES.includes(axis)
                    ? 'Die Klasse muss die Gruppe bestimmen — eine Gruppe wird als Ganzes umgeschrieben.'
                    : undefined}
                  onClick={() => toggleAxis(axis)}
                >
                  {AXIS_LABELS[axis]}
                </Button>
              ))}
              <span className="ml-auto tabular-nums text-muted-foreground">
                {summariseGroups(groups)} · {stillOpen} offen
                {alreadyStated > 0 && ` · ${alreadyStated} bereits erklärt`}
              </span>
            </div>

            <div className="max-h-[22rem] overflow-y-auto">
              {groups.map((group) => {
                const decision = decisions.get(group.key) ?? { kind: 'undecided' as const };
                const isActive = group.key === activeKey;
                const entity = classOf(group);
                const kind = genericClassKind(entity);
                const isAbstract = kind === 'abstract';
                return (
                  <div key={group.key} className="border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => showGroup(group)}
                      className={`flex w-full items-center gap-2 px-1 py-1.5 text-left hover:bg-muted/60 ${
                        isActive ? 'bg-muted/60' : ''
                      }`}
                    >
                      {isAbstract
                        ? <TriangleAlert className="h-3 w-3 shrink-0 text-red-600" />
                        : <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="truncate">{group.label}</span>
                      {kind && (
                        <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
                          {GENERIC_CLASS_LABELS[kind]}
                        </span>
                      )}
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

                        <div className="relative">
                          <Search className="absolute left-1.5 top-1.5 h-3 w-3 text-muted-foreground" />
                          <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={`Fachklasse unter ${entity} suchen`}
                            className="h-6 pl-6 text-xs"
                          />
                        </div>

                        {candidates.entries.length === 0 && candidates.bare.length === 0 && (
                          <p className="text-muted-foreground">
                            Keine passende Unterklasse gefunden.
                          </p>
                        )}

                        {candidates.entries.map((entry) => (
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

                        {candidates.bare.map((name) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => decide(group, {
                              kind: 'reclassify', entity: name,
                              predefinedType: null, objectType: null,
                            })}
                            className="block w-full truncate rounded-sm px-1.5 py-1 text-left text-muted-foreground hover:bg-muted"
                          >
                            {name}
                          </button>
                        ))}

                        {isAbstract ? (
                          <p className="flex items-start gap-1.5 pt-1 leading-tight text-muted-foreground">
                            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-red-600" />
                            {entity} ist abstrakt — kein Element darf diese Klasse tragen.
                            Hier hilft nur eine echte Fachklasse.
                          </p>
                        ) : (
                          <div className="flex items-center gap-1.5 pt-1">
                            <Ban className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <Input
                              value={keepWord}
                              onChange={(event) => setKeepWord(event.target.value)}
                              placeholder={`Bewusst nur ${entity}, als …`}
                              className="h-6 text-xs"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 shrink-0 px-2 text-[11px]"
                              disabled={keepWord.trim().length === 0}
                              onClick={() => decide(group, {
                                kind: 'keep',
                                entity,
                                // A Zwischenklasse has no PredefinedType to set.
                                predefinedType: null,
                                objectType: keepWord,
                              })}
                            >
                              Merken
                            </Button>
                          </div>
                        )}

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

export default ClassTriagePanel;
