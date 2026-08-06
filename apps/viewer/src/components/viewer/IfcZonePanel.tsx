/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Zones — "paint by numbers" for `IfcZone`.
 *
 * Pick a zone (which is to say: pick a colour), switch the brush on, and click
 * rooms in the model. Each click assigns the room to the zone, or takes it back
 * out. A Lens set to "Zone / Group" colours the result live, because the zone's
 * colour is stored on the zone itself (`ZoneDisplay=` in its Description) and
 * the lens asks for it — see `lib/ifcZones/zoneDisplay.ts`.
 *
 * The panel is deliberately thin: everything it does goes through the
 * `ifcZonesSlice` actions, which go through `lib/ifcZones/authoring`, which is
 * where the IFC rules and the tests live.
 *
 * Rooms only. IFC restricts zone membership to spaces, spatial zones and other
 * zones, so clicking a wall does nothing — with a reason shown, rather than
 * silently ignoring the click.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brush, Check, Plus, Trash2, X } from 'lucide-react';
import { LENS_PALETTE } from '@ifc-lite/lens';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { parseIfcZoneKey } from '@/store/slices/ifcZonesSlice';
import { nextZoneColour } from '@/lib/ifcZones/authoring';
import type { ZoneInfo } from '@/lib/ifcZones/membership';

/** Types that may be a zone member. Everything else is refused with a reason. */
const MEMBER_TYPES = new Set(['IfcSpace', 'IfcSpatialZone', 'IfcZone']);

/** A zone with no colour still needs something to show in the swatch. */
const NO_COLOUR = 'transparent';

interface IfcZonePanelProps {
  onClose: () => void;
}

export function IfcZonePanel({ onClose }: IfcZonePanelProps) {
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const models = useViewerStore((s) => s.models);
  // Every zone write bumps this; without it the list would show the state the
  // panel opened with.
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const ifcZonesOf = useViewerStore((s) => s.ifcZonesOf);

  const activeIfcZoneKey = useViewerStore((s) => s.activeIfcZoneKey);
  const setActiveIfcZone = useViewerStore((s) => s.setActiveIfcZone);
  const brushActive = useViewerStore((s) => s.ifcZoneBrushActive);
  const setBrushActive = useViewerStore((s) => s.setIfcZoneBrushActive);

  const createIfcZone = useViewerStore((s) => s.createIfcZone);
  const renameIfcZone = useViewerStore((s) => s.renameIfcZone);
  const setIfcZoneColour = useViewerStore((s) => s.setIfcZoneColour);
  const deleteIfcZone = useViewerStore((s) => s.deleteIfcZone);
  const paintIfcZone = useViewerStore((s) => s.paintIfcZone);

  const selectedEntity = useViewerStore((s) => s.selectedEntity);

  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);

  const zones = useMemo(
    () => (activeModelId ? ifcZonesOf(activeModelId) : []),
    // `mutationVersion` is the dependency that matters — `ifcZonesOf` reads the
    // overlay, which the version tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeModelId, ifcZonesOf, mutationVersion],
  );

  const active = parseIfcZoneKey(activeIfcZoneKey);
  const activeZone = active && active.modelId === activeModelId
    ? zones.find((z) => z.expressId === active.zoneId) ?? null
    : null;

  const typeOf = useCallback((modelId: string, expressId: number): string | null => {
    const store = models.get(modelId)?.ifcDataStore;
    return store?.entities?.getTypeName?.(expressId) ?? null;
  }, [models]);

  /**
   * The brush: every room the user selects joins (or leaves) the active zone.
   *
   * Driven by selection rather than by its own click handler, so it inherits
   * picking, federation and the existing highlight for free. The guard against
   * re-firing on the same room matters because selection state also updates for
   * reasons that are not a fresh click (a re-render, a camera move).
   */
  const lastPainted = useRef<string | null>(null);
  useEffect(() => {
    if (!brushActive || !activeZone || !activeModelId) {
      lastPainted.current = null;
      return;
    }
    if (!selectedEntity) return;

    const key = `${selectedEntity.modelId}:${selectedEntity.expressId}`;
    if (lastPainted.current === key) return;
    lastPainted.current = key;

    if (selectedEntity.modelId !== activeModelId) {
      setNote('Diese Zone gehört zu einem anderen Modell.');
      return;
    }

    const type = typeOf(selectedEntity.modelId, selectedEntity.expressId);
    if (type && !MEMBER_TYPES.has(type)) {
      setNote(`${type} kann nicht Mitglied einer Zone sein — IFC lässt nur Räume zu.`);
      return;
    }

    const result = paintIfcZone(
      activeModelId, activeZone.expressId, [selectedEntity.expressId], 'toggle',
    );
    if (!result) {
      setNote('Nichts geändert — fehlt die Berechtigung zum Schreiben?');
      return;
    }
    setNote(result.added.length > 0 ? 'Raum zugewiesen' : 'Raum entfernt');
  }, [activeModelId, activeZone, brushActive, paintIfcZone, selectedEntity, typeOf]);

  const handleCreate = () => {
    if (!activeModelId) return;
    const colour = nextZoneColour(zones, [...LENS_PALETTE]);
    const zoneId = createIfcZone(activeModelId, {
      name: `Zone ${zones.length + 1}`,
      colour,
      objectType: 'TriggerZone',
    });
    if (zoneId === null) {
      setNote('Zone konnte nicht angelegt werden — prüfe die Fachrolle.');
      return;
    }
    setActiveIfcZone(activeModelId, zoneId);
    setRenaming(zoneId);
    setNote(null);
  };

  const handleDelete = (zone: ZoneInfo) => {
    if (!activeModelId) return;
    deleteIfcZone(activeModelId, zone.expressId);
    setNote(`„${zone.name}" gelöscht — die Räume bleiben unverändert.`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Brush className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-[13px] font-medium">Zonen</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="sm" className="h-7" onClick={handleCreate} disabled={!activeModelId}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Neue Zone
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={brushActive ? 'default' : 'outline'}
              size="sm"
              className="h-7"
              disabled={!activeZone}
              onClick={() => setBrushActive(!brushActive)}
            >
              <Brush className="mr-1 h-3.5 w-3.5" />
              Pinsel
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {activeZone
              ? 'Räume im Modell anklicken — ein Klick weist zu, der nächste nimmt wieder heraus'
              : 'Zuerst eine Zone wählen'}
          </TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1">
        {zones.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            Noch keine Zone.
            <br />
            Eine Zone gruppiert Räume — ohne eigene Geometrie.
          </p>
        ) : (
          <ul className="divide-y">
            {zones.map((zone) => {
              const isActive = activeZone?.expressId === zone.expressId;
              return (
                <li
                  key={zone.expressId}
                  className={`px-3 py-2 ${isActive ? 'bg-accent/60' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      title="Zone wählen"
                      onClick={() => activeModelId && setActiveIfcZone(activeModelId, zone.expressId)}
                      className="h-4 w-4 shrink-0 rounded-sm border"
                      style={{ background: zone.colour ?? NO_COLOUR }}
                    />
                    {renaming === zone.expressId ? (
                      <Input
                        autoFocus
                        defaultValue={zone.name}
                        className="h-6 flex-1 text-[12px]"
                        onBlur={(e) => {
                          if (activeModelId) renameIfcZone(activeModelId, zone.expressId, e.target.value);
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => activeModelId && setActiveIfcZone(activeModelId, zone.expressId)}
                        onDoubleClick={() => setRenaming(zone.expressId)}
                        className="flex-1 truncate text-left text-[12px]"
                        title="Doppelklick zum Umbenennen"
                      >
                        {zone.name || <span className="text-muted-foreground">ohne Namen</span>}
                      </button>
                    )}
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {zone.memberIds.length}
                    </span>
                    {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      title="Zone löschen"
                      onClick={() => handleDelete(zone)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {isActive && (
                    <div className="mt-2 flex flex-wrap gap-1 pl-6">
                      {LENS_PALETTE.map((colour) => (
                        <button
                          key={colour}
                          type="button"
                          title={colour}
                          onClick={() => activeModelId && setIfcZoneColour(activeModelId, zone.expressId, colour)}
                          className={`h-4 w-4 rounded-sm border ${
                            zone.colour === colour ? 'ring-2 ring-offset-1 ring-foreground/50' : ''
                          }`}
                          style={{ background: colour }}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      <div className="border-t px-3 py-2">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {note ?? 'Die Farbe steht in IfcZone.Description und übersteht den Export. '
            + 'Eine Lens auf „Zone / Group" zeigt sie im Modell.'}
        </p>
      </div>
    </div>
  );
}
