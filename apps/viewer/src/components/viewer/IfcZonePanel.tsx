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
import { Brush, Check, MousePointerSquareDashed, Palette, Pencil, Plus, Trash2, X } from 'lucide-react';
import { LENS_PALETTE } from '@ifc-lite/lens';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { parseIfcZoneKey } from '@/store/slices/ifcZonesSlice';
import { ZONE_PAINT_LENS_ID } from '@/store/slices/lensSlice';
import { nextZoneColour } from '@/lib/ifcZones/authoring';
import { DEFAULT_THEME_ID, ZONE_THEMES, themeOfZone } from '@/lib/ifcZones/themes';
import {
  ZONE_MEMBER_TYPES, describeZoneTargets, eligibleZoneMembers,
} from '@/lib/ifcZones/selectionTargets';
import type { ZoneInfo } from '@/lib/ifcZones/membership';
import { stringToEntityRef } from '@/store/types';

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
  const activeLensId = useViewerStore((s) => s.activeLensId);
  const activateZoneLens = useViewerStore((s) => s.activateZoneLens);
  const deactivateZoneLens = useViewerStore((s) => s.deactivateZoneLens);

  const createIfcZone = useViewerStore((s) => s.createIfcZone);
  const renameIfcZone = useViewerStore((s) => s.renameIfcZone);
  const setIfcZoneColour = useViewerStore((s) => s.setIfcZoneColour);
  const deleteIfcZone = useViewerStore((s) => s.deleteIfcZone);
  const paintIfcZone = useViewerStore((s) => s.paintIfcZone);

  const selectedEntity = useViewerStore((s) => s.selectedEntity);
  // There are two multi-selection channels and they are NOT the same store
  // field: Ctrl+click in the viewport fills `selectedEntitiesSet`, while the
  // hierarchy's range-select fills `selectedEntities`. Reading only one would
  // report "nothing selected" for half the ways a user picks rooms.
  const selectedEntitiesSet = useViewerStore((s) => s.selectedEntitiesSet);
  const selectedEntities = useViewerStore((s) => s.selectedEntities);
  const setIfcZoneDescription = useViewerStore((s) => s.setIfcZoneDescription);
  const setIfcZoneObjectType = useViewerStore((s) => s.setIfcZoneObjectType);

  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  // The theme the next new zone gets. Kept for the whole session because
  // zones are made in runs — six trigger zones, then four compartments — and
  // re-picking the same theme each time is the kind of friction that makes
  // people leave it wrong.
  const [newThemeId, setNewThemeId] = useState<string>(DEFAULT_THEME_ID);

  const zones = useMemo(
    () => (activeModelId ? ifcZonesOf(activeModelId) : []),
    // `mutationVersion` is the dependency that matters — `ifcZonesOf` reads the
    // overlay, which the version tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeModelId, ifcZonesOf, mutationVersion],
  );

  /**
   * Everything currently selected, from whichever channel has it, deduplicated.
   *
   * A plain single click reaches neither multi-select field, so the primary
   * selection is the last fallback.
   */
  const selectedRefs = useMemo(() => {
    const byKey = new Map<string, { modelId: string; expressId: number }>();
    for (const key of selectedEntitiesSet) byKey.set(key, stringToEntityRef(key));
    for (const ref of selectedEntities) byKey.set(`${ref.modelId}:${ref.expressId}`, ref);
    if (byKey.size === 0 && selectedEntity) {
      byKey.set(`${selectedEntity.modelId}:${selectedEntity.expressId}`, selectedEntity);
    }
    return [...byKey.values()];
  }, [selectedEntities, selectedEntitiesSet, selectedEntity]);

  const selectionCount = selectedRefs.length;

  const active = parseIfcZoneKey(activeIfcZoneKey);
  const activeZone = active && active.modelId === activeModelId
    ? zones.find((z) => z.expressId === active.zoneId) ?? null
    : null;

  /**
   * Whether the rooms are currently coloured by zone.
   *
   * Painting without it is painting blind: the panel says a room joined, and
   * nothing on the drawing changes. Kept as its own lens rather than the
   * "colour by column" one so switching it on does not replace the zone panel
   * with the lens panel.
   */
  const colouring = activeLensId === ZONE_PAINT_LENS_ID;
  /**
   * Which kind of zone to colour: the open zone's theme, else the theme the
   * next new zone would get. A room sits in one fire compartment AND one
   * trigger zone, so colouring by "any zone" would give a legend with more
   * entries than the picture can show.
   */
  const colourTheme = themeOfZone(activeZone?.objectType ?? null)?.id ?? newThemeId;

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
    if (type && !ZONE_MEMBER_TYPES.has(type)) {
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

  /**
   * Assign (or unassign) the whole current multi-selection in one go.
   *
   * The everyday alternative to the brush: rubber-band or Ctrl+click a floor's
   * worth of rooms, then commit them all as one stroke — one undo entry, one
   * relationship rewrite. Non-rooms in the selection are reported, not dropped
   * in silence.
   */
  const applySelection = (mode: 'add' | 'remove') => {
    if (!activeModelId || !activeZone) return;

    if (selectedRefs.length === 0) {
      setNote('Nichts ausgewählt.');
      return;
    }

    const targets = eligibleZoneMembers(selectedRefs, activeModelId, typeOf);
    const result = targets.eligible.length > 0
      ? paintIfcZone(activeModelId, activeZone.expressId, targets.eligible, mode)
      : null;

    setNote(describeZoneTargets(
      targets,
      result ? { added: result.added.length, removed: result.removed.length } : null,
    ) ?? 'Nichts geändert.');
  };

  // Following the open zone's theme: switching from a trigger zone to a fire
  // compartment must recolour, or the picture describes the previous question.
  useEffect(() => {
    if (colouring) activateZoneLens(colourTheme);
    // `colouring` deliberately absent: this re-aims an ACTIVE lens, it does
    // not switch one on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colourTheme]);

  const handleCreate = () => {
    if (!activeModelId) return;
    const colour = nextZoneColour(zones, [...LENS_PALETTE]);
    // The theme is mandatory but never guessed: a new zone starts at
    // "Nicht definiert" and the author picks. A wrong theme mixes zones that
    // must stay apart, which is worse than an unclassified one.
    const theme = ZONE_THEMES.find((t) => t.id === newThemeId) ?? ZONE_THEMES[ZONE_THEMES.length - 1];
    const zoneId = createIfcZone(activeModelId, {
      name: `Zone ${zones.length + 1}`,
      colour,
      objectType: theme.zoneObjectType,
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
        <select
          value={newThemeId}
          onChange={(e) => setNewThemeId(e.target.value)}
          aria-label="Thema der neuen Zone"
          title="Thema — landet in IfcZone.ObjectType"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 text-[11px]"
        >
          {ZONE_THEMES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <Button
          variant={colouring ? 'default' : 'outline'}
          size="sm"
          className="h-7"
          title="Räume nach ihrer Zone einfärben — an, solange gemalt wird"
          onClick={() => (colouring ? deactivateZoneLens() : activateZoneLens(colourTheme))}
        >
          <Palette className="mr-1 h-3.5 w-3.5" />
          Einfärben
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

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MousePointerSquareDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          Auswahl: {selectionCount === 0 ? 'keine' : selectionCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={!activeZone || selectionCount === 0}
          onClick={() => applySelection('add')}
        >
          Zuweisen
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={!activeZone || selectionCount === 0}
          onClick={() => applySelection('remove')}
        >
          Entfernen
        </Button>
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
                          if (e.key === 'Escape') {
                            // Esc is the app-wide "put the tool away" key, and
                            // it closed the whole panel mid-rename. Cancelling
                            // the edit is what Esc means in a text field.
                            e.stopPropagation();
                            setRenaming(null);
                          }
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
                    {/* Double-click renames too, and did before this button.
                        It is not discoverable: a single click selects, so
                        anybody who tries the obvious thing concludes the name
                        is fixed once given. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      title="Zone umbenennen"
                      onClick={() => setRenaming(zone.expressId)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
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
                    <div className="mt-2 space-y-2 pl-6">
                      <div className="flex flex-wrap gap-1">
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
                      {/* The theme is what keeps zones of different kinds apart.
                          Shown on the open zone rather than in every row: it
                          changes rarely, and the row is already dense. */}
                      <select
                        value={themeOfZone(zone.objectType)?.id ?? ''}
                        onChange={(e) => {
                          const next = ZONE_THEMES.find((th) => th.id === e.target.value);
                          if (!activeModelId || !next) return;
                          setIfcZoneObjectType(activeModelId, zone.expressId, next.zoneObjectType);
                        }}
                        aria-label="Thema"
                        className="h-6 w-full rounded-md border border-border bg-background px-1.5 text-[11px]"
                      >
                        {/* A zone authored elsewhere may carry a convention we
                            do not know. Show it rather than silently
                            re-labelling it as something we recognise. */}
                        {themeOfZone(zone.objectType) === null && (
                          <option value="">
                            {zone.objectType ? `${zone.objectType} (fremd)` : 'ohne Thema'}
                          </option>
                        )}
                        {ZONE_THEMES.map((th) => (
                          <option key={th.id} value={th.id}>{th.label}</option>
                        ))}
                      </select>
                      {/* Plain text only — the colour rides along in the same
                          IFC attribute, but the author never sees the token.
                          Keyed by the current text so an outside change (undo)
                          re-seeds the field instead of holding a stale value. */}
                      <Input
                        key={`${zone.expressId}:${zone.description}`}
                        defaultValue={zone.description}
                        placeholder="Beschrieb (optional)"
                        className="h-6 w-full text-[11px]"
                        onBlur={(e) => {
                          if (!activeModelId) return;
                          if (e.target.value === zone.description) return;
                          setIfcZoneDescription(activeModelId, zone.expressId, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') {
                            e.currentTarget.value = zone.description;
                            e.currentTarget.blur();
                          }
                        }}
                      />
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
