/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Clean Proxy — working through a model's `IfcBuildingElementProxy` elements.
 *
 * # A list of groups, never a list of elements
 * "Eine mühselige Krankheit vieler Modellautoren" (Marc, 2026-08-13) — and the
 * models that have this have it in the thousands. So the list shows GROUPS: a
 * class is chosen once and every member takes it. The element count is on the
 * row so it is obvious how much one decision is worth.
 *
 * # A panel, because deciding means looking
 * This was a dialog and had to stop being one: a dialog covers the viewport,
 * so the model — the only thing that can actually answer "what are these 529
 * elements" — was behind the window asking the question. Clicking a group now
 * ISOLATES its members, so the viewport shows those and nothing else.
 *
 * # The class comes from the catalogue
 * Free text would put a new spelling of `IfcLightFixture` in the file every
 * time. The picker searches the synced Fachklassen list, so what lands in the
 * model is an entity and a PredefinedType that exist.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Boxes, Check, Search, Eye, Ban, X, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useProxyTriage } from '@/hooks/useProxyTriage';
import {
  groupProxies, suggestAxes, summariseGroups, groupSearchTerm, AXIS_ORDER, AXIS_LABELS,
  type ProxyGroup, type ProxyGroupAxis,
} from '@/lib/proxyTriage/proxyGroups';
import {
  proxyWrites, describeDecision, psetNotice, countUndecided, PROXY_ENTITY,
  type ProxyDecision,
} from '@/lib/proxyTriage/proxyDecisions';
import { useClassCatalog } from '@/lib/classCatalog/useClassCatalog';
import { searchClassCatalog, describeClass } from '@/lib/classCatalog/classCatalog';
import { TriageGroupLabel } from '@/components/viewer/TriageGroupLabel';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';

export interface ProxyTriagePanelProps {
  onClose: () => void;
}

export function ProxyTriagePanel({ onClose }: ProxyTriagePanelProps): React.ReactElement {
  // Showing the already-explained ones again is a VIEW change, not a write:
  // nothing is un-said until a new decision is applied over it, so switching
  // it off puts the model back exactly as it was.
  const [includeStated, setIncludeStated] = useState(false);
  const { elements, hasModel, alreadyStated } = useProxyTriage(true, includeStated);
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
  const setIsolatedEntities = useViewerStore((state) => state.setIsolatedEntities);

  // Isolation belongs to this panel while it is open. Closing it must give the
  // model back whole — an isolated model with no panel explaining why reads as
  // a broken viewer.
  useEffect(() => () => { useViewerStore.getState().setIsolatedEntities(null); }, []);

  const suggested = useMemo(() => suggestAxes(elements), [elements]);
  const activeAxes = axes ?? suggested;
  const groups = useMemo(() => groupProxies(elements, activeAxes), [elements, activeAxes]);
  const active = groups.find((group) => group.key === activeKey) ?? null;
  const stillOpen = countUndecided(groups, decisions);

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
    const opening = group.key !== activeKey;
    setActiveKey(opening ? group.key : null);
    setQuery(opening ? groupSearchTerm(group) : '');
    setKeepWord('');
    if (!activeModelId) return;
    // Selected AND isolated: selection drives the inspector, isolation is what
    // makes the group actually visible among ten thousand other elements.
    setSelectedEntities(opening
      ? group.members.map((expressId) => ({ modelId: activeModelId, expressId }))
      : []);
    setIsolatedEntities(opening ? new Set(group.members) : null);
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
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <Boxes className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Clean Proxy</span>
        <Button size="sm" variant="ghost" className="ml-auto h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!hasModel && <p className="p-4 text-center text-muted-foreground">Kein Modell geladen.</p>}

      {hasModel && (
        <ScrollArea className="flex-1">
          <p className="px-2 py-1.5 leading-tight text-muted-foreground">
            Elemente ohne Fachklasse, in Gruppen. Eine Gruppe wird einmal
            entschieden und gilt für alle ihre Mitglieder.
          </p>

          {elements.length === 0 && (
            <p className="p-4 text-center text-muted-foreground">
              {alreadyStated > 0
                ? `Nichts offen — alle ${alreadyStated} Proxy-Elemente sind erklärt.`
                : 'Keine Proxy-Elemente — in diesem Modell hat jedes Element eine Fachklasse.'}
            </p>
          )}

          {(elements.length > 0 || alreadyStated > 0) && (
            <>
              <div className="flex flex-wrap items-center gap-1.5 border-b px-2 pb-2">
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
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1 tabular-nums text-muted-foreground">
                <span>{summariseGroups(groups)} · {stillOpen} offen</span>
                {alreadyStated > 0 && (
                  // Clickable, because an explanation somebody wants back is
                  // otherwise a dead end: the count told them the elements
                  // exist and gave them no way to reach them.
                  <Button
                    size="sm"
                    variant={includeStated ? 'default' : 'ghost'}
                    className="ml-auto h-5 px-1.5 text-[11px]"
                    onClick={() => { setIncludeStated(!includeStated); setActiveKey(null); }}
                  >
                    <Undo2 className="mr-1 h-3 w-3" />
                    {includeStated
                      ? `${alreadyStated} erklärte wieder ausblenden`
                      : `${alreadyStated} bereits erklärt — zurückholen`}
                  </Button>
                )}
              </div>

              <div>
                {groups.map((group) => {
                  const decision = decisions.get(group.key) ?? { kind: 'undecided' as const };
                  const isActive = group.key === activeKey;
                  return (
                    <div key={group.key} className="border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() => showGroup(group)}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/60 ${
                          isActive ? 'bg-muted/60' : ''
                        }`}
                      >
                        <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <TriageGroupLabel group={group} axes={activeAxes} />
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
                                placeholder="nach IFC-Entität oder Fachklasse suchen…"
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

                          {/* The second field is not a note — what is typed
                              here is WRITTEN INTO THE MODEL as ObjectType. The
                              label above it says so, because "Bleibt bewusst
                              Proxy, als …" alone left it unclear what the text
                              was for (Marc, 2026-08-15). */}
                          <div className="pt-1">
                            <p className="mb-1 leading-tight text-muted-foreground">
                              Oder bewusst Proxy lassen: Ihr eigenes Wort dafür wird als
                              <span className="font-medium"> ObjectType </span>
                              ins Modell geschrieben, die Klasse bleibt {PROXY_ENTITY}.
                            </p>
                            <div className="flex items-center gap-1.5">
                              <Ban className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <Input
                                value={keepWord}
                                onChange={(event) => setKeepWord(event.target.value)}
                                placeholder="z. B. Kabelkanal"
                                className="h-6 text-xs"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 shrink-0 px-2 text-[11px]"
                                disabled={keepWord.trim().length === 0}
                                onClick={() => decide(group, {
                                  kind: 'keep',
                                  entity: PROXY_ENTITY,
                                  predefinedType: 'USERDEFINED',
                                  objectType: keepWord,
                                })}
                              >
                                Merken
                              </Button>
                            </div>
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
        </ScrollArea>
      )}
    </div>
  );
}

export default ProxyTriagePanel;
