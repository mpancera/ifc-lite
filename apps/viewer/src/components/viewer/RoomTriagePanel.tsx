/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Clean Rooms — walking a model's spaces one at a time.
 *
 * # One at a time, unlike the other two Clean panels
 * Clean Proxy and Clean Classes decide GROUPS, because a class is a statement
 * about a kind of thing and a thousand elements share it. A room number is the
 * opposite: it belongs to exactly one room, and the only way to know which is
 * to look at that room. So this panel is a queue, not a grouping — one space
 * shown in the model, two fields, and a key that says "übernehmen und weiter".
 *
 * # Ghosting, not isolating
 * An isolated room is a box floating in nothing, and nobody can tell which
 * room it is. Ghosting keeps the walls around it, which is exactly the
 * information that answers the panel's question.
 *
 * # Discarding is a first-class answer
 * Rooms derived from wall axes include things that are not rooms — a shaft, a
 * cavity between two wall leaves. Making the author name those anyway would be
 * the panel lying about what it found, so "Verwerfen" deletes the space and
 * moves on. It goes through the normal undo stack like any other edit.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { DoorOpen, Check, Trash2, X, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRoomTriage } from '@/hooks/useRoomTriage';
import {
  checkRooms, sortFindings, summariseRooms, nextOpen, isSettled, ISSUE_LABELS,
  type RoomFinding, type RoomSummary,
} from '@/lib/roomTriage/roomChecks';
import { formatRoomArea } from '@/lib/plan/roomLabels';
import { toGlobalIdFromModels } from '@/store/globalId';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';

export interface RoomTriagePanelProps {
  onClose: () => void;
}

const ALL_STOREYS = '__all__';

/**
 * What the list shows. "Erledigt" is not decoration: deciding a room means
 * looking at the ones around it, and those are usually the finished ones — a
 * queue that can only show its own open items hides exactly the context the
 * decision needs.
 */
type StatusFilter = 'open' | 'settled' | 'all';

const STATUS_FILTERS: ReadonlyArray<{
  id: StatusFilter;
  label: string;
  count: (summary: RoomSummary) => number;
}> = [
  { id: 'open', label: 'Offen', count: (s) => s.open },
  { id: 'settled', label: 'Erledigt', count: (s) => s.settled },
  { id: 'all', label: 'Alle', count: (s) => s.total },
];

export function RoomTriagePanel({ onClose }: RoomTriagePanelProps): React.ReactElement {
  const [status, setStatus] = useState<StatusFilter>('open');
  const [storeyFilter, setStoreyFilter] = useState<string>(ALL_STOREYS);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [description, setDescription] = useState('');

  const { records, modelId, hasModel } = useRoomTriage(true);

  const models = useViewerStore((state) => state.models);
  const ensureMutationView = useViewerStore((state) => state.ensureMutationView);
  const setAttribute = useViewerStore((state) => state.setAttribute);
  const removeEntity = useViewerStore((state) => state.removeEntity);
  const canAuthorOn = useViewerStore((state) => state.canAuthorOn);
  const setSelectedEntity = useViewerStore((state) => state.setSelectedEntity);
  const setSelectedEntityId = useViewerStore((state) => state.setSelectedEntityId);
  const setGhostExceptEntities = useViewerStore((state) => state.setGhostExceptEntities);

  // The ghosting belongs to this panel while it is open; closing it has to
  // give the model back whole.
  useEffect(() => () => { useViewerStore.getState().setGhostExceptEntities(null); }, []);

  const findings = useMemo(() => sortFindings(checkRooms(records)), [records]);
  const summary = useMemo(() => summariseRooms(findings), [findings]);

  const storeys = useMemo(() => {
    const seen = new Map<number, string>();
    for (const finding of findings) seen.set(finding.record.storeyId, finding.record.storeyName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [findings]);

  const shown = useMemo(() => findings.filter((finding) => {
    // The room being worked on stays visible whatever the filter says —
    // answering it must not make it vanish mid-edit.
    const settled = isSettled(finding);
    const kept = finding.record.key === activeKey
      || status === 'all'
      || (status === 'open' ? !settled : settled);
    if (!kept) return false;
    if (storeyFilter !== ALL_STOREYS && String(finding.record.storeyId) !== storeyFilter) {
      return false;
    }
    return true;
  }), [findings, status, storeyFilter, activeKey]);

  /** Show one room in the model and load its values into the fields. */
  const open = (finding: RoomFinding | null) => {
    if (!finding) {
      setActiveKey(null);
      setGhostExceptEntities(null);
      return;
    }
    const { record } = finding;
    setActiveKey(record.key);
    setNumber(record.number);
    setDescription(record.description);
    if (!modelId) return;
    setSelectedEntity({ modelId, expressId: record.expressId });
    // Highlight rides the global-id channel; the EntityRef above only feeds
    // the property lookup (apps/viewer/AGENTS.md).
    setSelectedEntityId(toGlobalIdFromModels(models, modelId, record.expressId));
    setGhostExceptEntities(new Set([record.expressId]));
  };

  const toggle = (finding: RoomFinding) => {
    open(finding.record.key === activeKey ? null : finding);
  };

  /** Both fields of one room, in one edit. Returns false when nothing landed. */
  const commit = (finding: RoomFinding): boolean => {
    if (!modelId) return false;
    ensureMutationView(modelId);
    const permission = canAuthorOn(modelId, finding.record.expressId);
    if (!permission.allowed) {
      toast.error(permission.reason ?? 'Das Modell ist schreibgeschützt.');
      return false;
    }
    const wroteNumber = number.trim() === finding.record.number.trim()
      || !!setAttribute(modelId, finding.record.expressId, 'Name', number.trim());
    const wroteName = description.trim() === finding.record.description.trim()
      || !!setAttribute(modelId, finding.record.expressId, 'LongName', description.trim());
    if (!wroteNumber || !wroteName) {
      toast.error('Der Raum liess sich nicht schreiben.');
      return false;
    }
    return true;
  };

  const applyAndAdvance = (finding: RoomFinding) => {
    if (!commit(finding)) return;
    open(nextOpen(findings, finding.record.key));
  };

  const discard = (finding: RoomFinding) => {
    if (!modelId) return;
    ensureMutationView(modelId);
    if (!removeEntity(modelId, finding.record.expressId)) {
      toast.error('Der Raum liess sich nicht entfernen.');
      return;
    }
    toast.success(`Raum verworfen — mit Strg+Z zurückholbar.`);
    open(nextOpen(findings, finding.record.key));
  };

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <DoorOpen className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Clean Rooms</span>
        <Button size="sm" variant="ghost" className="ml-auto h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!hasModel && <p className="p-4 text-center text-muted-foreground">Kein Modell geladen.</p>}

      {hasModel && findings.length === 0 && (
        <p className="p-4 text-center text-muted-foreground">
          Keine Räume im Modell. Räume lassen sich im Author-Reiter aus den Wänden erzeugen.
        </p>
      )}

      {hasModel && findings.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
            {STATUS_FILTERS.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant={status === option.id ? 'default' : 'outline'}
                className="h-6 px-2 text-[11px]"
                onClick={() => setStatus(option.id)}
              >
                {option.label} {option.count(summary)}
              </Button>
            ))}
            {storeys.length > 1 && (
              <>
                <Button
                  size="sm"
                  variant={storeyFilter === ALL_STOREYS ? 'default' : 'outline'}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setStoreyFilter(ALL_STOREYS)}
                >
                  Alle
                </Button>
                {storeys.map((storey) => (
                  <Button
                    key={storey.id}
                    size="sm"
                    variant={storeyFilter === String(storey.id) ? 'default' : 'outline'}
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setStoreyFilter(String(storey.id))}
                  >
                    {storey.name}
                  </Button>
                ))}
              </>
            )}
          </div>

          <div className="border-b px-2 py-1 tabular-nums text-muted-foreground">
            {summary.open} von {summary.total} offen
            {summary.derived > 0 && ` · ${summary.derived} aus der Wanderkennung`}
          </div>

          <ScrollArea className="flex-1">
            {shown.length === 0 && (
              <p className="p-4 text-center text-muted-foreground">
                Nichts offen — jeder Raum hat Nummer, Bezeichnung und Fläche.
              </p>
            )}

            {shown.map((finding) => {
              const { record } = finding;
              const active = record.key === activeKey;
              return (
                <div key={record.key} className="border-b last:border-b-0">
                  <button
                    type="button"
                    className={`flex w-full items-baseline gap-2 px-2 py-1.5 text-left hover:bg-accent ${
                      active ? 'bg-accent' : ''
                    }`}
                    onClick={() => toggle(finding)}
                  >
                    <span className="w-10 shrink-0 text-muted-foreground">{record.storeyName}</span>
                    <span className="w-12 shrink-0 font-medium tabular-nums">
                      {record.number || '—'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{record.description || '—'}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {record.area === null ? '' : formatRoomArea(record.area)}
                    </span>
                    {isSettled(finding)
                      ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      : <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                  </button>

                  {active && (
                    <div className="space-y-2 border-t bg-muted/30 px-2 py-2">
                      {finding.issues.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {finding.issues.map((issue) => (
                            <span
                              key={issue}
                              className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-400"
                            >
                              {ISSUE_LABELS[issue]}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <label className="w-20 shrink-0 text-muted-foreground" htmlFor="room-number">
                          Nummer
                        </label>
                        <Input
                          id="room-number"
                          value={number}
                          className="h-7"
                          onChange={(event) => setNumber(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') applyAndAdvance(finding);
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="w-20 shrink-0 text-muted-foreground" htmlFor="room-name">
                          Bezeichnung
                        </label>
                        <Input
                          id="room-name"
                          value={description}
                          className="h-7"
                          onChange={(event) => setDescription(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') applyAndAdvance(finding);
                          }}
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => applyAndAdvance(finding)}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Übernehmen und weiter
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => discard(finding)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Verwerfen
                        </Button>
                      </div>
                      <p className="leading-tight text-muted-foreground">
                        Enter übernimmt und springt zum nächsten offenen Raum.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </ScrollArea>
        </>
      )}
    </div>
  );
}

export default RoomTriagePanel;
