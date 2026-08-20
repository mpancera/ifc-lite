/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Add Element panel — right-side authoring surface for dropping
 * walls / slabs / beams / columns onto a parsed model. Tool-driven
 * (rendered when `activeTool === 'addElement'`); the actual drop
 * happens on a 3D click handled in `selectionHandlers.ts`.
 *
 * Activated via the Panels menu in the toolbar or the command palette.
 * The tool stays active across drops so the user can place several
 * elements in a row; Esc returns to the select tool.
 */

import { useEffect, useMemo, useState } from 'react';
import { Box, Cog, DoorOpen, Home, Layers, Library, Minus, Search, Siren, Square, SquareDashedBottom, Wand2, X } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  AddElementSpaceSource, AddElementAutoSpaceParams, AddElementInstallationSource,
} from '@/store/slices/addElementSlice';
import type { SensorInStoreParams } from '@ifc-lite/create';
import type { BoundaryMode } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { EntityNode } from '@ifc-lite/query';
import type { AddElementType } from '@/store/slices/addElementSlice';
import { useCatalogEntries, type CatalogEntry } from '@/lib/catalog';
import { TOUR_ANCHORS, tourAnchor } from '@/lib/tours/anchors';
import { CatalogImportControls } from './catalog/CatalogImportControls';
import { dxfSegments, summariseLayers, suggestWallLayers } from '@/lib/plan/dxfSegments';
import { usePlaceBySpace } from '@/hooks/usePlaceBySpace';
import { mountingHeight } from '@/lib/placeBySpace/placeBySpace';

interface ElementOption {
  type: AddElementType;
  label: string;
  Icon: typeof Box;
  /** Short description shown below the type chips. */
  hint: string;
}

/** The three ways to make a room, and what each one needs to work. */
const SPACE_SOURCES: ReadonlyArray<{
  id: AddElementSpaceSource; label: string; hint: string;
}> = [
  {
    id: 'draw', label: 'Draw',
    hint: 'You place the corners. Nothing is assumed about the model — the way to add the room the detectors cannot find.',
  },
  {
    id: 'walls', label: 'From walls',
    hint: "Reads the model's wall axes and finds every enclosed region on the storey. Wants walls that actually meet; the weld tolerance forgives the rest.",
  },
  {
    id: 'plan', label: 'From a plan',
    hint: 'Traces the rooms off an imported DXF. For a model whose walls are missing or unusable, but whose plan is good.',
  },
];

/** The two ways to place an installation element, and what each one is for. */
const INSTALLATION_SOURCES: ReadonlyArray<{
  id: AddElementInstallationSource; label: string; hint: string;
}> = [
  {
    id: 'click', label: 'Click',
    hint: 'You point at the model and drop one device. The way to place the one that belongs somewhere in particular.',
  },
  {
    id: 'space', label: 'By space',
    hint: "Fills the storey's rooms by area — so many m² per device, capped per room. Wants rooms in the model; a room that already has one is left alone.",
  },
];

/** Types the "by space" method applies to — the Installation group. */
const INSTALLATION_TYPES: ReadonlyArray<AddElementType> = ['library', 'sensor'];

const ELEMENT_OPTIONS: ElementOption[] = [
  { type: 'wall', label: 'Wall', Icon: Minus, hint: 'Click Start, then End. Cross-section = Thickness × Height, profile spans the click-to-click axis.' },
  { type: 'slab', label: 'Slab', Icon: Square, hint: 'Rectangle: 2 corner clicks. Polygon: N clicks + Enter to close. Extruded up by Thickness.' },
  { type: 'beam', label: 'Beam', Icon: Layers, hint: 'Click Start, then End. Cross-section (Width × Height) is centred on the beam axis.' },
  { type: 'column', label: 'Column', Icon: Box, hint: 'Single click sets the base centre. Width × Depth cross-section, extruded up by Height.' },
  { type: 'door', label: 'Door', Icon: DoorOpen, hint: 'Single click sets the bottom-centre. Width × Height leaf with a thin frame depth. Free-standing — refine wall hosting via Raw STEP if needed.' },
  { type: 'window', label: 'Window', Icon: SquareDashedBottom, hint: 'Single click sets the sill-centre. Width × Height sash with a thin frame depth.' },
  { type: 'space', label: 'Space', Icon: Home, hint: 'Rectangle: 2 corner clicks. Polygon: N clicks + Enter. Extruded up by Height into a room volume; aggregated to the storey via IfcRelAggregates.' },
  { type: 'roof', label: 'Roof', Icon: Square, hint: 'Same shape as a slab — flat-roof emit with .FLAT_ROOF. PredefinedType. Pitched roofs need IfcCreator.addIfcGableRoof.' },
  { type: 'plate', label: 'Plate', Icon: Square, hint: 'Thin flat plate (steel / gusset). Rectangle or polygon profile, extruded by Thickness.' },
  { type: 'member', label: 'Member', Icon: Cog, hint: 'Generic structural member (brace, post, strut). Click Start, then End. Pick PredefinedType to set role.' },
  { type: 'sensor', label: 'Sensor', Icon: Siren, hint: 'Single click to drop a small MEP device (e.g. a fire detector). Emits IfcSensor — pick PredefinedType below.' },
  { type: 'library', label: 'Library', Icon: Library, hint: 'Pick an installation element from the catalog below, then click in 3D to place it.' },
];

/**
 * How the type list is grouped in the dropdown. Ordered by what a session
 * usually starts from rather than alphabetically: installations first, because
 * that is the work this fork exists for; the structural set below, because a
 * discipline planner rarely draws it.
 */
const ELEMENT_GROUPS: ReadonlyArray<{ label: string; types: AddElementType[] }> = [
  { label: 'Installation', types: ['library', 'sensor'] },
  { label: 'Räume', types: ['space'] },
  { label: 'Bauteile', types: ['wall', 'slab', 'roof', 'plate', 'column', 'beam', 'member'] },
  { label: 'Öffnungen', types: ['door', 'window'] },
];

interface StoreyOption {
  expressId: number;
  label: string;
}

interface AddElementPanelProps {
  onClose: () => void;
}

export function AddElementPanel({ onClose }: AddElementPanelProps) {
  const { models, ifcDataStore } = useIfc();

  const addElementType = useViewerStore((s) => s.addElementType);
  const setAddElementType = useViewerStore((s) => s.setAddElementType);

  const addElementModelId = useViewerStore((s) => s.addElementModelId);
  const setAddElementModelId = useViewerStore((s) => s.setAddElementModelId);
  const addElementStoreyId = useViewerStore((s) => s.addElementStoreyId);
  const setAddElementStoreyId = useViewerStore((s) => s.setAddElementStoreyId);

  const wallParams = useViewerStore((s) => s.addElementWallParams);
  const setWallParams = useViewerStore((s) => s.setAddElementWallParams);
  const slabParams = useViewerStore((s) => s.addElementSlabParams);
  const setSlabParams = useViewerStore((s) => s.setAddElementSlabParams);
  const beamParams = useViewerStore((s) => s.addElementBeamParams);
  const setBeamParams = useViewerStore((s) => s.setAddElementBeamParams);
  const columnParams = useViewerStore((s) => s.addElementColumnParams);
  const setColumnParams = useViewerStore((s) => s.setAddElementColumnParams);
  const doorParams = useViewerStore((s) => s.addElementDoorParams);
  const setDoorParams = useViewerStore((s) => s.setAddElementDoorParams);
  const windowParams = useViewerStore((s) => s.addElementWindowParams);
  const setWindowParams = useViewerStore((s) => s.setAddElementWindowParams);
  const spaceParams = useViewerStore((s) => s.addElementSpaceParams);
  const setSpaceParams = useViewerStore((s) => s.setAddElementSpaceParams);
  const roofParams = useViewerStore((s) => s.addElementRoofParams);
  const setRoofParams = useViewerStore((s) => s.setAddElementRoofParams);
  const plateParams = useViewerStore((s) => s.addElementPlateParams);
  const setPlateParams = useViewerStore((s) => s.setAddElementPlateParams);
  const memberParams = useViewerStore((s) => s.addElementMemberParams);
  const setMemberParams = useViewerStore((s) => s.setAddElementMemberParams);
  const sensorParams = useViewerStore((s) => s.addElementSensorParams);
  const setSensorParams = useViewerStore((s) => s.setAddElementSensorParams);
  const libraryParams = useViewerStore((s) => s.addElementLibraryParams);
  const setLibraryParams = useViewerStore((s) => s.setAddElementLibraryParams);
  const librarySelection = useViewerStore((s) => s.addElementLibrarySelection);
  const setLibrarySelection = useViewerStore((s) => s.setAddElementLibrarySelection);

  const slabMode = useViewerStore((s) => s.addElementSlabMode);
  const setSlabMode = useViewerStore((s) => s.setAddElementSlabMode);
  const spaceSource = useViewerStore((s) => s.addElementSpaceSource);
  const installationSource = useViewerStore((s) => s.addElementInstallationSource);
  const setInstallationSource = useViewerStore((s) => s.setAddElementInstallationSource);
  const setSpaceSource = useViewerStore((s) => s.setAddElementSpaceSource);
  // The two tools that place from the model rather than from clicks. They
  // share one consequence: the click guidance below is an instruction for a
  // tool the user is not holding.
  const isInstallation = INSTALLATION_TYPES.includes(addElementType);
  const placingBySpace = isInstallation && installationSource === 'space';
  const generatingRooms = addElementType === 'space' && spaceSource !== 'draw';
  const clickPlaced = !generatingRooms && !placingBySpace;
  const pendingPoints = useViewerStore((s) => s.addElementPendingPoints);
  const hoverPoint = useViewerStore((s) => s.addElementHoverPoint);
  const clearPending = useViewerStore((s) => s.clearAddElementPending);

  const activeModelId = useViewerStore((s) => s.activeModelId);

  // Resolve the effective model + its storeys for the selects. When
  // the user hasn't pinned a model the panel auto-tracks the active
  // model; same for storey (auto-tracks first when null).
  const effectiveModelId = addElementModelId ?? activeModelId ?? (models.size > 0 ? models.keys().next().value ?? null : null);

  const modelOptions = useMemo(() => {
    const opts: { id: string; label: string }[] = [];
    for (const [id, model] of models) {
      if (!model.ifcDataStore) continue;
      opts.push({ id, label: model.name || id });
    }
    return opts;
  }, [models]);

  const storeyOptions = useMemo<StoreyOption[]>(() => {
    const dataStore = effectiveModelId
      ? models.get(effectiveModelId)?.ifcDataStore ?? null
      : ifcDataStore;
    if (!dataStore) return [];
    const ids = dataStore.entityIndex.byType.get('IFCBUILDINGSTOREY') ?? [];
    const opts: StoreyOption[] = [];
    for (const expressId of ids) {
      const node = new EntityNode(dataStore, expressId);
      const name = node.name || `Storey #${expressId}`;
      opts.push({ expressId, label: name });
    }
    return opts;
  }, [effectiveModelId, models, ifcDataStore]);

  // Auto-pick the first storey when the user hasn't chosen one or
  // the previous choice no longer exists in the active model. Also
  // reset on model change — storey express ids are model-local, so a
  // Solo shows exactly one storey, so authoring into a different one is a
  // mistake nobody sees until the element turns up on a floor they are not
  // looking at. The panel follows the storey on screen whenever that changes;
  // picking another one by hand still holds until the next solo switch.
  const levelDisplayMode = useViewerStore((s) => s.levelDisplayMode);
  const activeStorey = useViewerStore((s) => s.activeStorey);
  useEffect(() => {
    if (levelDisplayMode !== 'solo' || !activeStorey) return;
    // Storey ids are per model, so a soloed storey of ANOTHER model says
    // nothing about where this panel should author.
    if (effectiveModelId && activeStorey.modelId !== effectiveModelId) return;
    if (!storeyOptions.some((o) => o.expressId === activeStorey.expressId)) return;
    setAddElementStoreyId(activeStorey.expressId);
  }, [
    levelDisplayMode, activeStorey, effectiveModelId, storeyOptions, setAddElementStoreyId,
  ]);

  // colliding numeric id from a different federated model would
  // otherwise be silently reused as the placement target.
  useEffect(() => {
    if (storeyOptions.length === 0) return;
    if (addElementStoreyId === null) return;
    const stillValid = storeyOptions.some((s) => s.expressId === addElementStoreyId);
    if (!stillValid) setAddElementStoreyId(null);
  }, [storeyOptions, addElementStoreyId, setAddElementStoreyId, effectiveModelId]);

  const hasModel = !!effectiveModelId;
  const hasStorey = storeyOptions.length > 0;
  const ready = hasModel && hasStorey;

  const activeOption = ELEMENT_OPTIONS.find((o) => o.type === addElementType) ?? ELEMENT_OPTIONS[0];

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black" {...tourAnchor(TOUR_ANCHORS.addElementPanel)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-emerald-600" />
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">
            Add Element
          </h2>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
              aria-label="Close add element panel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close (Esc)</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {/* Element type chips */}
        <section className="space-y-1.5">
          <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Type
          </Label>
          {/* A dropdown rather than a chip per type: twelve chips cost four rows
              of a panel that also has to show dimensions, storey and (for the
              catalogue) a searchable list. Grouped so the list stays scannable
              — an alphabetical twelve reads as an undifferentiated wall. */}
          <Select value={addElementType} onValueChange={(v) => setAddElementType(v as AddElementType)}>
            <SelectTrigger className="h-8 font-mono text-xs">
              <span className="flex items-center gap-1.5 min-w-0">
                <activeOption.Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{activeOption.label}</span>
              </span>
            </SelectTrigger>
            <SelectContent>
              {ELEMENT_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel className="font-mono text-[10px] uppercase tracking-wider">
                    {group.label}
                  </SelectLabel>
                  {group.types.map((type) => {
                    const option = ELEMENT_OPTIONS.find((o) => o.type === type);
                    if (!option) return null;
                    return (
                      <SelectItem key={type} value={type} className="font-mono text-xs">
                        <span className="flex items-center gap-1.5">
                          <option.Icon className="h-3.5 w-3.5 shrink-0" />
                          {option.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 leading-snug pt-1">
            {/* The type hint describes the click flow, which is only one of the
                three ways to make a room — the source below says the rest. */}
            {generatingRooms
              ? SPACE_SOURCES.find((o) => o.id === spaceSource)?.hint
              : placingBySpace
                ? INSTALLATION_SOURCES.find((o) => o.id === installationSource)?.hint
                : activeOption.hint}
          </p>
        </section>

        {/* Model + storey context */}
        {modelOptions.length > 1 && (
          <section className="space-y-1.5">
            <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Model
            </Label>
            <Select
              value={effectiveModelId ?? undefined}
              onValueChange={(v) => setAddElementModelId(v)}
            >
              <SelectTrigger className="h-8 font-mono text-xs">
                <SelectValue placeholder="Select model…" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map(({ id, label }) => (
                  <SelectItem key={id} value={id} className="font-mono text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>
        )}

        <section className="space-y-1.5">
          <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Storey
          </Label>
          {storeyOptions.length > 0 ? (
            <Select
              value={(addElementStoreyId ?? storeyOptions[0]?.expressId ?? '').toString()}
              onValueChange={(v) => setAddElementStoreyId(Number(v))}
            >
              <SelectTrigger className="h-8 font-mono text-xs">
                <SelectValue placeholder="Pick a storey…" />
              </SelectTrigger>
              <SelectContent>
                {storeyOptions.map(({ expressId, label }) => (
                  <SelectItem key={expressId} value={expressId.toString()} className="font-mono text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
              {hasModel
                ? 'This model has no IfcBuildingStorey — load a model with a spatial hierarchy.'
                : 'Load a model to begin.'}
            </p>
          )}
        </section>

        {/* A room can be made three ways, and they are three tools: drawn by
            hand, found between the model's walls, traced off an imported plan.
            Stacked as three sections they read as one tool with a lot of
            settings — and the two detectors fail differently, so somebody
            whose walls are dirty needs to know which one they are looking at. */}
        {addElementType === 'space' && (
          <section className="space-y-1.5">
            <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Where the room comes from
            </Label>
            <div className="grid grid-cols-3 gap-1">
              {SPACE_SOURCES.map((source) => (
                <ModeChip
                  key={source.id}
                  selected={spaceSource === source.id}
                  onClick={() => setSpaceSource(source.id)}
                >
                  {source.label}
                </ModeChip>
              ))}
            </div>
          </section>
        )}

        {/* An installation goes in one device at a time or one storey at a
            time, and those are two tools rather than one tool with a setting:
            the second needs rooms in the model and places dozens at once. Same
            shape as the room sources above, one floor up. */}
        {isInstallation && (
          <section className="space-y-1.5">
            <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              How the elements are placed
            </Label>
            <div className="grid grid-cols-2 gap-1">
              {INSTALLATION_SOURCES.map((source) => (
                <ModeChip
                  key={source.id}
                  selected={installationSource === source.id}
                  onClick={() => setInstallationSource(source.id)}
                >
                  {source.label}
                </ModeChip>
              ))}
            </div>
          </section>
        )}

        {/* Slab mode toggle — rectangle (2 clicks) vs polygon (N clicks + Enter) */}
        {/* Profile mode toggle — applies to slab, roof, plate, space (anything that supports both rect + polygon) */}
        {(addElementType === 'slab' || addElementType === 'roof' || addElementType === 'plate'
          || (addElementType === 'space' && spaceSource === 'draw')) && (
          <section className="space-y-1.5">
            <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {activeOption.label} profile
            </Label>
            <div className="grid grid-cols-2 gap-1">
              <ModeChip selected={slabMode === 'rectangle'} onClick={() => setSlabMode('rectangle')}>
                Rectangle (2 clicks)
              </ModeChip>
              <ModeChip selected={slabMode === 'polygon'} onClick={() => setSlabMode('polygon')}>
                Polygon (N + Enter)
              </ModeChip>
            </div>
          </section>
        )}

        {/* Library browser — replaces the generic dimensions section for the 'library' type */}
        {addElementType === 'library' && (
          <LibrarySection
            selection={librarySelection}
            onSelect={setLibrarySelection}
            params={libraryParams}
            onParamsChange={setLibraryParams}
          />
        )}

        {/* Type-specific dimensions */}
        {addElementType !== 'library' && (
        <section className="space-y-2 pt-1">
          <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {activeOption.label} dimensions
          </Label>

          {addElementType === 'wall' && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Thickness" suffix="m" value={wallParams.Thickness} min={0.01} onChange={(v) => setWallParams({ Thickness: v })} />
              <NumberField label="Height" suffix="m" value={wallParams.Height} min={0.01} onChange={(v) => setWallParams({ Height: v })} />
            </div>
          )}

          {addElementType === 'slab' && (
            <NumberField label="Thickness" suffix="m" value={slabParams.Thickness} min={0.01} onChange={(v) => setSlabParams({ Thickness: v })} />
          )}

          {addElementType === 'beam' && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Width" suffix="m" value={beamParams.Width} min={0.01} onChange={(v) => setBeamParams({ Width: v })} />
              <NumberField label="Height" suffix="m" value={beamParams.Height} min={0.01} onChange={(v) => setBeamParams({ Height: v })} />
            </div>
          )}

          {addElementType === 'column' && (
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="Width" suffix="m" value={columnParams.Width} min={0.01} onChange={(v) => setColumnParams({ Width: v })} />
              <NumberField label="Depth" suffix="m" value={columnParams.Depth} min={0.01} onChange={(v) => setColumnParams({ Depth: v })} />
              <NumberField label="Height" suffix="m" value={columnParams.Height} min={0.01} onChange={(v) => setColumnParams({ Height: v })} />
            </div>
          )}

          {addElementType === 'door' && (
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="Width" suffix="m" value={doorParams.Width} min={0.01} onChange={(v) => setDoorParams({ Width: v })} />
              <NumberField label="Height" suffix="m" value={doorParams.Height} min={0.01} onChange={(v) => setDoorParams({ Height: v })} />
              <NumberField label="Frame" suffix="m" value={doorParams.FrameThickness} min={0.005} onChange={(v) => setDoorParams({ FrameThickness: v })} />
            </div>
          )}

          {addElementType === 'window' && (
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="Width" suffix="m" value={windowParams.Width} min={0.01} onChange={(v) => setWindowParams({ Width: v })} />
              <NumberField label="Height" suffix="m" value={windowParams.Height} min={0.01} onChange={(v) => setWindowParams({ Height: v })} />
              <NumberField label="Frame" suffix="m" value={windowParams.FrameThickness} min={0.005} onChange={(v) => setWindowParams({ FrameThickness: v })} />
            </div>
          )}

          {addElementType === 'space' && spaceSource === 'draw' && (
            <NumberField label="Height" suffix="m" value={spaceParams.Height} min={0.01} onChange={(v) => setSpaceParams({ Height: v })} />
          )}

          {addElementType === 'roof' && (
            <NumberField label="Thickness" suffix="m" value={roofParams.Thickness} min={0.01} onChange={(v) => setRoofParams({ Thickness: v })} />
          )}

          {addElementType === 'plate' && (
            <NumberField label="Thickness" suffix="m" value={plateParams.Thickness} min={0.001} onChange={(v) => setPlateParams({ Thickness: v })} />
          )}

          {addElementType === 'member' && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Width" suffix="m" value={memberParams.Width} min={0.01} onChange={(v) => setMemberParams({ Width: v })} />
              <NumberField label="Height" suffix="m" value={memberParams.Height} min={0.01} onChange={(v) => setMemberParams({ Height: v })} />
            </div>
          )}

          {addElementType === 'sensor' && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <NumberField label="Width" suffix="m" value={sensorParams.Width} min={0.01} onChange={(v) => setSensorParams({ Width: v })} />
                <NumberField label="Depth" suffix="m" value={sensorParams.Depth} min={0.01} onChange={(v) => setSensorParams({ Depth: v })} />
                <NumberField label="Height" suffix="m" value={sensorParams.Height} min={0.01} onChange={(v) => setSensorParams({ Height: v })} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400" htmlFor="sensor-predefined-type">
                  Type
                </Label>
                <Select
                  value={sensorParams.PredefinedType}
                  onValueChange={(v) => setSensorParams({ PredefinedType: v })}
                >
                  <SelectTrigger id="sensor-predefined-type" className="h-8 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIRESENSOR" className="font-mono text-xs">FIRESENSOR</SelectItem>
                    <SelectItem value="SMOKESENSOR" className="font-mono text-xs">SMOKESENSOR</SelectItem>
                    <SelectItem value="HEATSENSOR" className="font-mono text-xs">HEATSENSOR</SelectItem>
                    <SelectItem value="GASSENSOR" className="font-mono text-xs">GASSENSOR</SelectItem>
                    <SelectItem value="MOVEMENTSENSOR" className="font-mono text-xs">MOVEMENTSENSOR</SelectItem>
                    <SelectItem value="CO2SENSOR" className="font-mono text-xs">CO2SENSOR</SelectItem>
                    <SelectItem value="USERDEFINED" className="font-mono text-xs">USERDEFINED</SelectItem>
                    <SelectItem value="NOTDEFINED" className="font-mono text-xs">NOTDEFINED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </section>
        )}

        {/* Auto Spaces — wall-graph face finder, runs only when the
            current type is 'space' so the panel stays focused. */}
        {addElementType === 'space' && spaceSource === 'walls' && (
          <AutoSpacesSection
            modelId={effectiveModelId}
            storeyId={addElementStoreyId ?? storeyOptions[0]?.expressId ?? null}
          />
        )}

        {/* The same rooms from an imported plan. A sibling rather than a mode
            of the section above: the outlines mean different things (drawn wall
            faces, not wall centrelines) and the two fail in different ways. */}
        {addElementType === 'space' && spaceSource === 'plan' && (
          <RoomsFromDrawingSection
            modelId={effectiveModelId}
            storeyId={addElementStoreyId ?? storeyOptions[0]?.expressId ?? null}
          />
        )}

        {/* One device per room, from the rooms the model already has. Sits
            below the dimensions because it uses them: the box a device is
            drawn as is the same whichever way it was placed. */}
        {placingBySpace && (
          <PlaceBySpaceSection
            type={addElementType === 'sensor' ? 'sensor' : 'library'}
            modelId={effectiveModelId}
            storeyId={addElementStoreyId ?? storeyOptions[0]?.expressId ?? null}
          />
        )}

        {/* Click-state guidance — drives the user through the multi-click flow.
            Silent for the two detectors: "click the first corner" is an
            instruction for a tool the user is not holding. */}
        {clickPlaced && (
        <DropGuidance
          ready={ready}
          type={addElementType}
          slabMode={slabMode}
          pendingCount={pendingPoints.length}
          hoverDistance={pendingPoints.length > 0 && hoverPoint
            ? distance2D(pendingPoints[pendingPoints.length - 1], hoverPoint)
            : null}
          onClearPending={clearPending}
          libraryLabel={librarySelection?.label ?? null}
        />
        )}

        {clickPlaced && (
        <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 leading-snug">
          Snap to vertices, edges, and faces is on by default — toggle with <span className="font-semibold">S</span>.
          Z is fixed to the storey floor; refine via the Raw STEP tab after dropping.
        </p>
        )}
      </div>
    </div>
  );
}

function distance2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

interface ModeChipProps {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ModeChip({ selected, onClick, children }: ModeChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        'h-7 px-2 rounded-sm text-[11px] font-mono uppercase tracking-wide',
        'border transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        selected
          ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600'
          : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-emerald-300 dark:hover:border-emerald-800',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

interface DropGuidanceProps {
  ready: boolean;
  type: AddElementType;
  slabMode: 'rectangle' | 'polygon';
  pendingCount: number;
  hoverDistance: number | null;
  onClearPending: () => void;
  /** Selected catalog entry's label, only meaningful when `type === 'library'`. */
  libraryLabel: string | null;
}

/** Stateful guidance pane — mirrors the multi-click flow so the user always knows what comes next. */
function DropGuidance({ ready, type, slabMode, pendingCount, hoverDistance, onClearPending, libraryLabel }: DropGuidanceProps) {
  if (!ready) {
    return (
      <section className="mt-2 rounded-sm border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
        Authoring is disabled until a model with a building storey is loaded.
      </section>
    );
  }

  let primary: string;
  let secondary: string;
  if (type === 'library') {
    if (libraryLabel) {
      primary = `Click in 3D to drop the ${libraryLabel}.`;
      secondary = 'Keep clicking to place more — Esc to exit.';
    } else {
      primary = 'Pick an element from the library above first.';
      secondary = 'The placement tool activates once you select one.';
    }
  } else if (type === 'column' || type === 'door' || type === 'window' || type === 'sensor') {
    // Single-click placements share the same prompt shape.
    primary = `Click in 3D to drop the ${type}.`;
    secondary = 'Keep clicking to place more — Esc to exit.';
  } else if (type === 'wall' || type === 'beam' || type === 'member') {
    // Two-click axial placements (start → end).
    if (pendingCount === 0) {
      primary = `Click the ${type} start point.`;
      secondary = 'Snap to vertex/edge for precise placement.';
    } else {
      primary = `Click the ${type} end point.`;
      secondary = hoverDistance !== null
        ? `Length so far: ${hoverDistance.toFixed(2)} m — Esc to restart.`
        : 'Esc to restart.';
    }
  } else {
    // slab / roof / plate / space — rectangle (2 clicks) or polygon (N + Enter).
    const polygonable = `${type[0].toUpperCase()}${type.slice(1)}`;
    if (slabMode === 'rectangle') {
      if (pendingCount === 0) {
        primary = `Click the first ${type} corner.`;
        secondary = 'A second click sets the opposite corner.';
      } else {
        primary = 'Click the opposite corner.';
        secondary = 'Esc to restart, or switch to Polygon mode for irregular outlines.';
      }
    } else {
      if (pendingCount === 0) {
        primary = `Click the ${polygonable} polygon's first point.`;
        secondary = 'Need at least 3 points; press Enter to close.';
      } else if (pendingCount < 3) {
        primary = `Click point ${pendingCount + 1} (need at least 3).`;
        secondary = 'Esc to restart.';
      } else {
        primary = `Click point ${pendingCount + 1} or press Enter to close.`;
        secondary = 'Esc to restart the polygon.';
      }
    }
  }

  return (
    <section
      className="mt-2 rounded-sm border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-[11px] font-mono leading-relaxed text-emerald-800 dark:text-emerald-300"
      aria-live="polite"
    >
      <div className="flex items-start gap-2 justify-between">
        <div className="min-w-0">
          <span className="block font-semibold">{primary}</span>
          <span className="block text-[10px] opacity-80 mt-0.5">{secondary}</span>
        </div>
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={onClearPending}
            className="shrink-0 text-[10px] underline-offset-2 hover:underline opacity-80 hover:opacity-100"
            aria-label="Discard pending points"
          >
            Reset
          </button>
        )}
      </div>
    </section>
  );
}

interface NumberFieldProps {
  label: string;
  suffix?: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}

interface RoomsFromDrawingSectionProps {
  modelId: string | null;
  storeyId: number | null;
}

/**
 * Rooms traced from an imported plan instead of from modelled walls.
 *
 * Shares the numeric settings with the wall section above — snap, minimum
 * area, height, naming all mean the same thing whichever the source is — and
 * adds the two things only a drawing needs: which underlay, and which of its
 * layers carry the walls.
 *
 * The layer choice is the whole feature. A plan carries furniture, dimensions,
 * hatching and text, and feeding all of it to the detector yields regions
 * bounded by a dimension line and half a desk. Common naming is offered as a
 * starting tick, never applied silently.
 */
function RoomsFromDrawingSection({ modelId, storeyId }: RoomsFromDrawingSectionProps) {
  const params = useViewerStore((s) => s.addElementAutoSpaceParams);
  const setParams = useViewerStore((s) => s.setAddElementAutoSpaceParams);
  const setPreview = useViewerStore((s) => s.setAddElementAutoSpacePreview);
  const generate = useViewerStore((s) => s.generateSpacesFromDrawing);
  const underlays = useViewerStore((s) => s.dxfUnderlays);

  const [underlayId, setUnderlayId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [minWidth, setMinWidth] = useState(0.35);
  const [busy, setBusy] = useState(false);

  const underlay = underlays.find((u) => u.id === underlayId) ?? underlays[0] ?? null;

  // Re-suggest when the underlay changes, not on every render: a suggestion
  // that keeps reinstating itself would undo the user's own ticks.
  useEffect(() => {
    if (!underlay) return;
    setSelected(suggestWallLayers(underlay));
  }, [underlay?.id]);

  // The store replaces the underlay object on every change, so its identity
  // already covers a moved plan — no second dependency needed.
  const summaries = useMemo(
    () => (underlay ? summariseLayers(underlay) : []),
    [underlay],
  );

  const ready = modelId !== null && storeyId !== null && underlay !== null && selected.length > 0;

  const run = (dryRun: boolean) => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const segments = dxfSegments(underlay!, { layers: selected });
      if (segments.length === 0) {
        toast.info('No lines on the chosen layers. Pick the layers that carry the walls.');
        return;
      }

      const result = generate(modelId!, storeyId!, segments, {
        snapTolerance: params.SnapTolerance,
        minArea: params.MinArea,
        minWidth,
        height: params.Height,
        namePattern: params.NamePattern,
        predefinedType: params.PredefinedType,
        dryRun,
      });
      if ('error' in result) {
        toast.error(result.error);
        return;
      }

      if (dryRun) {
        setPreview({
          storeyExpressId: storeyId!,
          source: 'drawing',
          outlines: result.detected.map((d) => d.outline.map((p) => [p[0], p[1]])),
          regions: result.detected.map((d) => ({ area: d.area })),
          segmentsConsidered: result.segmentsConsidered,
          skippedNarrow: result.skippedNarrow,
        });
        if (result.detected.length === 0) {
          toast.info('No enclosed regions. Check the layer choice or raise the snap tolerance.');
        }
        return;
      }

      setPreview(null);
      const count = result.emitted.length;
      if (count === 0) {
        toast.info('No rooms to generate.');
      } else {
        toast.success(`Generated ${count} room${count === 1 ? '' : 's'} from the plan.`);
      }
    } finally {
      setBusy(false);
    }
  };

  if (underlays.length === 0) {
    return (
      <section className="space-y-2 pt-1">
        <div className="flex items-center gap-1.5">
          <Wand2 className="h-3 w-3 text-sky-600" />
          <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Rooms (from a plan)
          </Label>
        </div>
        <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 leading-snug">
          Import a DXF and align it to the model first — rooms are traced where the
          plan is placed.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2 pt-1">
      <div className="flex items-center gap-1.5">
        <Wand2 className="h-3 w-3 text-sky-600" />
        <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Rooms (from a plan)
        </Label>
      </div>

      {underlays.length > 1 && (
        <Select value={underlay?.id ?? ''} onValueChange={setUnderlayId}>
          <SelectTrigger className="h-8 font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {underlays.map((u) => (
              <SelectItem key={u.id} value={u.id} className="font-mono text-xs">{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="space-y-1">
        <Label className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
          Wall layers
          <span className="text-zinc-400 dark:text-zinc-600 ml-1">
            ({selected.length} of {summaries.length})
          </span>
        </Label>
        {/* Segment and text counts rather than names alone: a wall layer has
            hundreds of segments and almost no text, a label layer the reverse.
            That is what makes the choice decidable at a glance. */}
        <div className="max-h-40 overflow-y-auto rounded-sm border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
          {summaries.map((l) => (
            <label
              key={l.name}
              className="flex items-center gap-1.5 px-1.5 py-1 text-[10px] font-mono cursor-pointer select-none hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <input
                type="checkbox"
                checked={selected.includes(l.name)}
                onChange={(e) => setSelected((prev) => (
                  e.target.checked ? [...prev, l.name] : prev.filter((n) => n !== l.name)
                ))}
                className="h-3 w-3 accent-sky-600"
              />
              <span className={`flex-1 truncate ${l.visible ? '' : 'opacity-50'}`}>
                {l.name}
                {l.suggested && <span className="ml-1 text-sky-600">•</span>}
              </span>
              <span className="text-zinc-400 dark:text-zinc-600 shrink-0">
                {l.segments}
                {l.texts > 0 && ` / ${l.texts}t`}
              </span>
            </label>
          ))}
        </div>
      </div>

      <DetectionSettings params={params} setParams={setParams} showBoundary={false} />

      <NumberField
        label="Min width" suffix="m"
        value={minWidth} min={0}
        onChange={setMinWidth}
      />
      <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 leading-snug">
        A plan draws both faces of a wall, so the gap between them closes too. This
        drops those — they are long, but never wide.
      </p>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button
          variant="outline" size="sm"
          onClick={() => run(true)}
          disabled={!ready || busy}
          className="h-8 text-[11px] font-mono"
        >
          Preview
        </Button>
        <Button
          variant="default" size="sm"
          onClick={() => run(false)}
          disabled={!ready || busy}
          className="h-8 text-[11px] font-mono bg-sky-600 hover:bg-sky-700"
        >
          Generate
        </Button>
      </div>
    </section>
  );
}

/**
 * Place one installation element per room, from the rooms the model has.
 *
 * The counting rule and the spread live in `lib/placeBySpace`; this is the
 * part that talks to the model. It deliberately runs the SAME two actions the
 * click tool runs — one call per device — rather than a batch writer of its
 * own: containment in the room, the shared product Type and membership of the
 * active role's `IfcDistributionSystem` all have to come out identical, and
 * the only way to be sure of that is to take the same path.
 */
interface PlaceBySpaceSectionProps {
  type: 'sensor' | 'library';
  modelId: string | null;
  storeyId: number | null;
}

function PlaceBySpaceSection({ type, modelId, storeyId }: PlaceBySpaceSectionProps) {
  const params = useViewerStore((s) => s.addElementPlaceBySpaceParams);
  const setParams = useViewerStore((s) => s.setAddElementPlaceBySpaceParams);
  const sensorParams = useViewerStore((s) => s.addElementSensorParams);
  const libraryParams = useViewerStore((s) => s.addElementLibraryParams);
  const selection = useViewerStore((s) => s.addElementLibrarySelection);
  const addSensor = useViewerStore((s) => s.addSensor);
  const addLibraryElement = useViewerStore((s) => s.addLibraryElement);
  const [busy, setBusy] = useState(false);

  // A sensor is its own product; a library element is whichever one is picked,
  // and until one is there is nothing to count rooms against.
  const ifcEntity = type === 'sensor' ? 'IfcSensor' : selection?.ifc.entity ?? '';
  const mounting = type === 'sensor' ? 'ceiling' : selection?.mounting ?? 'ceiling';

  const { plan, storeyHeight, ready } = usePlaceBySpace({
    enabled: modelId !== null && storeyId !== null && ifcEntity !== '',
    modelId,
    storeyId,
    ifcEntity,
    params,
  });

  const z = mountingHeight(params.MountingHeight, storeyHeight, mounting);
  const occupied = plan.skipped.filter((skip) => skip.reason === 'occupied').length;
  const tooSmall = plan.skipped.filter((skip) => skip.reason === 'too-small').length;
  const rooms = new Set(plan.placements.map((spot) => spot.spaceId)).size;
  const canRun = ready && !busy && plan.placements.length > 0
    && (type === 'sensor' || selection !== null);

  const run = () => {
    if (!canRun || modelId === null || storeyId === null) return;
    setBusy(true);
    try {
      let placed = 0;
      let failure: string | null = null;
      for (const spot of plan.placements) {
        // Drawing space to the storey's own frame — the same conversion the
        // click path makes (`rendererPointToIfcStoreyLocal`), plus the height.
        const Position: [number, number, number] = [spot.at.x, -spot.at.y, z];
        const result = type === 'sensor'
          ? addSensor(modelId, storeyId, {
            Position,
            Width: sensorParams.Width,
            Depth: sensorParams.Depth,
            Height: sensorParams.Height,
            PredefinedType: sensorParams.PredefinedType as SensorInStoreParams['PredefinedType'],
          })
          : addLibraryElement(modelId, storeyId, {
            IfcEntity: selection!.ifc.entity,
            PredefinedType: selection!.ifc.predefinedType,
            ObjectType: selection!.ifc.objectType,
            Position,
            Width: libraryParams.Width,
            Depth: libraryParams.Depth,
            Height: libraryParams.Height,
            Discipline: selection!.discipline,
            Name: selection!.label,
            CatalogEntryId: selection!.id,
            CatalogEntryTag: selection!.tag,
            TechnicalData: selection!.technicalData,
          });
        if ('error' in result) {
          failure = result.error;
          break;
        }
        placed += 1;
      }
      // Stopping at the first refusal and saying how far it got: the usual
      // cause is a read-only role, and "nothing happened" would send somebody
      // looking at the rooms instead of at the role.
      if (failure !== null) {
        toast.error(placed === 0 ? failure : `Placed ${placed}, then stopped: ${failure}`);
      } else {
        toast.success(`Placed ${placed} in ${rooms} room${rooms === 1 ? '' : 's'}.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 pt-1">
      <div className="flex items-center gap-1.5">
        <Wand2 className="h-3 w-3 text-emerald-600" />
        <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Place by space
        </Label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberField
          label="Coverage" suffix="m² each" value={params.CoverageArea} min={1}
          onChange={(v) => setParams({ CoverageArea: v })}
        />
        <NumberField
          label="Max" suffix="per room" value={params.MaxPerRoom} min={1}
          onChange={(v) => setParams({ MaxPerRoom: Math.round(v) })}
        />
        <NumberField
          label="Min area" suffix="m²" value={params.MinArea} min={0}
          onChange={(v) => setParams({ MinArea: v })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="place-by-space-height" className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
          Height <span className="text-zinc-400 dark:text-zinc-600 ml-1">(m above floor)</span>
        </Label>
        <Input
          id="place-by-space-height"
          type="number"
          step={0.05}
          placeholder={z.toFixed(2)}
          value={params.MountingHeight ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim();
            const next = Number(raw);
            // Empty means "let the storey decide" — the placeholder shows what
            // that works out to, so the automatic answer is never invisible.
            setParams({ MountingHeight: raw === '' || !Number.isFinite(next) ? null : next });
          }}
          className="h-8 font-mono text-xs"
        />
        <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 leading-snug">
          {params.MountingHeight !== null
            ? `Every device on this storey at ${z.toFixed(2)} m.`
            : mounting !== 'ceiling'
              ? `Empty = the catalog's ${mounting} mounting → ${z.toFixed(2)} m.`
              : storeyHeight === null
                ? 'Empty = under the ceiling — but this storey states no height, so devices land on the floor. Type one.'
                : `Empty = under the ceiling of this storey (${storeyHeight.toFixed(2)} m) → ${z.toFixed(2)} m.`}
        </p>
      </div>

      {/* What the run will do, before it does it. 58 elements is not something
          to find out about afterwards. */}
      <div className="rounded-sm border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 space-y-0.5">
        {ifcEntity === '' ? (
          <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
            Pick an element from the library first.
          </p>
        ) : !ready ? (
          <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
            Pick a model and a storey.
          </p>
        ) : (
          <>
            <p className="text-[11px] font-mono text-zinc-700 dark:text-zinc-200">
              {plan.placements.length} in {rooms} of {plan.roomsConsidered} room
              {plan.roomsConsidered === 1 ? '' : 's'}
            </p>
            {occupied > 0 && (
              <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                {occupied} already equipped — left alone
              </p>
            )}
            {tooSmall > 0 && (
              <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                {tooSmall} below {params.MinArea} m² — skipped
              </p>
            )}
            {plan.roomsConsidered === 0 && (
              <p className="text-[10px] font-mono text-amber-600 dark:text-amber-400">
                This storey has no IfcSpace. Draw or detect rooms first.
              </p>
            )}
          </>
        )}
      </div>

      <Button
        variant="default"
        size="sm"
        onClick={run}
        disabled={!canRun}
        className="h-8 w-full text-[11px] font-mono bg-emerald-600 hover:bg-emerald-700"
      >
        {busy ? 'Placing…' : `Place ${plan.placements.length}`}
      </Button>
    </section>
  );
}

interface AutoSpacesSectionProps {
  modelId: string | null;
  storeyId: number | null;
}

/**
 * Compact "Auto Spaces" pane: wires the per-storey wall-graph face
 * finder to the viewer slice. Preview button runs detection without
 * emitting; Generate commits each candidate as an IfcSpace.
 */
/**
 * The settings both detectors share, in one place.
 *
 * They ARE one set of settings — the same store fields drive the wall detector
 * and the plan tracer — so rendering them in one of the two sections and not
 * the other left the plan path running on numbers it never showed. `Boundary`
 * is the exception: a plan already draws the room face, so there is nothing to
 * offset and the generator has no such option.
 */
function DetectionSettings({ params, setParams, showBoundary }: {
  params: AddElementAutoSpaceParams;
  setParams: (p: Partial<AddElementAutoSpaceParams>) => void;
  showBoundary: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Weld" suffix="m"
          value={params.SnapTolerance} min={0.001}
          onChange={(v) => setParams({ SnapTolerance: v })}
        />
        <NumberField
          label="Min area" suffix="m²"
          value={params.MinArea} min={0}
          onChange={(v) => setParams({ MinArea: v })}
        />
        <NumberField
          label="Height" suffix="m"
          value={params.Height} min={0.01}
          onChange={(v) => setParams({ Height: v })}
        />
        {showBoundary && (
        <div className="space-y-1">
          <Label className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400" htmlFor="auto-space-boundary">
            Boundary
          </Label>
          <Select
            value={params.BoundaryMode}
            onValueChange={(v) => setParams({ BoundaryMode: v as BoundaryMode })}
          >
            <SelectTrigger id="auto-space-boundary" className="h-8 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inner" className="font-mono text-xs">INNER (room face)</SelectItem>
              <SelectItem value="center" className="font-mono text-xs">CENTER (wall axis)</SelectItem>
              <SelectItem value="outer" className="font-mono text-xs">OUTER (far face)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        )}
        <div className="space-y-1">
          <Label className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400" htmlFor="auto-space-type">
            Type
          </Label>
          <Select
            value={params.PredefinedType}
            onValueChange={(v) => setParams({ PredefinedType: v })}
          >
            <SelectTrigger id="auto-space-type" className="h-8 font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="INTERNAL" className="font-mono text-xs">INTERNAL</SelectItem>
              <SelectItem value="EXTERNAL" className="font-mono text-xs">EXTERNAL</SelectItem>
              <SelectItem value="SPACE" className="font-mono text-xs">SPACE</SelectItem>
              <SelectItem value="PARKING" className="font-mono text-xs">PARKING</SelectItem>
              <SelectItem value="GFA" className="font-mono text-xs">GFA</SelectItem>
              <SelectItem value="USERDEFINED" className="font-mono text-xs">USERDEFINED</SelectItem>
              <SelectItem value="NOTDEFINED" className="font-mono text-xs">NOTDEFINED</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="auto-space-name" className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
          Name pattern <span className="text-zinc-400 dark:text-zinc-600 ml-1">({'{n}'} = index)</span>
        </Label>
        <Input
          id="auto-space-name"
          type="text"
          value={params.NamePattern}
          onChange={(e) => setParams({ NamePattern: e.target.value })}
          className="h-8 font-mono text-xs"
        />
      </div>

    </>
  );
}

function AutoSpacesSection({ modelId, storeyId }: AutoSpacesSectionProps) {
  const params = useViewerStore((s) => s.addElementAutoSpaceParams);
  const setParams = useViewerStore((s) => s.setAddElementAutoSpaceParams);
  const preview = useViewerStore((s) => s.addElementAutoSpacePreview);
  const setPreview = useViewerStore((s) => s.setAddElementAutoSpacePreview);
  const generate = useViewerStore((s) => s.generateSpacesFromWalls);
  const [busy, setBusy] = useState(false);

  const ready = modelId !== null && storeyId !== null;

  const [debugLogging, setDebugLogging] = useState(false);

  const runPreview = () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const result = generate(modelId!, storeyId!, {
        snapTolerance: params.SnapTolerance,
        minArea: params.MinArea,
        height: params.Height,
        namePattern: params.NamePattern,
        predefinedType: params.PredefinedType,
        boundaryMode: params.BoundaryMode,
        dryRun: true,
        debug: debugLogging,
      });
      if ('error' in result) {
        toast.error(result.error);
        setPreview(null);
        return;
      }
      const skipReasons: Record<string, number> = {};
      for (const s of result.wallsSkipped) {
        skipReasons[s.reason] = (skipReasons[s.reason] ?? 0) + 1;
      }
      setPreview({
        storeyExpressId: storeyId!,
        source: 'walls',
        outlines: result.detected.map((d) => d.outline.map((p) => [p[0], p[1]])),
        regions: result.detected.map((d) => ({ area: d.area })),
        wallsConsidered: result.wallsConsidered,
        wallsContributing: result.wallsContributing,
        diagnostics: {
          vertices: result.detectionStats.vertices,
          edgesAfterSplit: result.detectionStats.segmentsAfterSplit,
          facesTotal: result.detectionStats.faces,
          outerFacesDropped: result.detectionStats.outerFacesDropped,
          belowMinAreaDropped: result.detectionStats.belowMinAreaDropped,
          largestArea: result.detectionStats.largestArea,
          skipReasons,
        },
      });
      if (result.detected.length === 0) {
        toast.info('No enclosed regions detected. Check wall geometry or snap tolerance.');
      }
    } finally {
      setBusy(false);
    }
  };

  const runCommit = () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const result = generate(modelId!, storeyId!, {
        snapTolerance: params.SnapTolerance,
        minArea: params.MinArea,
        height: params.Height,
        namePattern: params.NamePattern,
        predefinedType: params.PredefinedType,
        boundaryMode: params.BoundaryMode,
        debug: debugLogging,
      });
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      setPreview(null);
      const count = result.emitted.length;
      if (count === 0) {
        toast.info('No enclosed regions to generate.');
      } else {
        toast.success(`Generated ${count} IfcSpace${count === 1 ? '' : 's'}.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 pt-1">
      <div className="flex items-center gap-1.5">
        <Wand2 className="h-3 w-3 text-emerald-600" />
        <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Auto Spaces (from walls)
        </Label>
      </div>

      <DetectionSettings params={params} setParams={setParams} showBoundary />

      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={runPreview}
          disabled={!ready || busy}
          className="h-8 text-[11px] font-mono"
        >
          Preview
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={runCommit}
          disabled={!ready || busy}
          className="h-8 text-[11px] font-mono bg-emerald-600 hover:bg-emerald-700"
        >
          Generate
        </Button>
      </div>

      <label className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={debugLogging}
          onChange={(e) => setDebugLogging(e.target.checked)}
          className="h-3 w-3 accent-emerald-600"
        />
        Verbose console logging (open devtools)
      </label>

      {preview && (
        <div className="rounded-sm border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 px-2 py-1.5 text-[10px] font-mono text-emerald-800 dark:text-emerald-300 leading-snug">
          <div>
            {preview.regions.length} region{preview.regions.length === 1 ? '' : 's'} detected
            {/* The two sources fail differently — too few walls contributing, or
                too few segments on the chosen layers — so the summary names the
                one being looked at rather than showing "0/0 walls" for a plan. */}
            {preview.source === 'drawing'
              ? <>{' · '}{preview.segmentsConsidered ?? 0} segments</>
              : <>{' · '}{preview.wallsContributing ?? 0}/{preview.wallsConsidered ?? 0} walls</>}
            {preview.skippedNarrow ? `${' · '}${preview.skippedNarrow} too narrow` : null}
          </div>
          {preview.regions.length > 0 && (
            <div className="opacity-80">
              Total area: {preview.regions.reduce((sum, r) => sum + r.area, 0).toFixed(1)} m²
            </div>
          )}
          {preview.diagnostics && (
            <div className="opacity-80 mt-1">
              graph: {preview.diagnostics.vertices}v / {preview.diagnostics.edgesAfterSplit}e / {preview.diagnostics.facesTotal}f
              {' · '}dropped {preview.diagnostics.outerFacesDropped} outer + {preview.diagnostics.belowMinAreaDropped} small
            </div>
          )}
          {preview.diagnostics && Object.keys(preview.diagnostics.skipReasons).length > 0 && (
            <div className="opacity-80">
              skipped walls:{' '}
              {Object.entries(preview.diagnostics.skipReasons)
                .map(([reason, count]) => `${count}× ${reason}`)
                .join(', ')}
            </div>
          )}
          {preview.regions.length === 0 && (preview.wallsContributing ?? 0) > 0 && (
            <div className="mt-1 text-amber-700 dark:text-amber-400">
              Walls extracted but no enclosed regions formed — check that walls actually meet at corners (try a larger Snap value).
            </div>
          )}
          {preview.wallsContributing === 0 && (preview.wallsConsidered ?? 0) > 0 && (
            <div className="mt-1 text-amber-700 dark:text-amber-400">
              No wall axes could be extracted. Toggle &quot;Verbose console logging&quot; for per-wall diagnostics.
            </div>
          )}
          {/* The drawing equivalent: lines were found, nothing closed. Almost
              always a layer that carries only part of the walls, or corners
              left open by a gap wider than the snap tolerance. */}
          {preview.source === 'drawing' && preview.regions.length === 0
            && (preview.segmentsConsidered ?? 0) > 0 && (
            <div className="mt-1 text-amber-700 dark:text-amber-400">
              Lines found but nothing closed — add the layers carrying the rest of the walls, or raise Snap.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const DISCIPLINE_FILTERS: Array<{ value: 'all' | CatalogEntry['discipline']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'fire', label: 'Fire' },
  { value: 'security', label: 'Security' },
  { value: 'intrusion', label: 'Intrusion' },
  { value: 'other', label: 'Other' },
];

interface LibrarySectionProps {
  selection: CatalogEntry | null;
  onSelect: (entry: CatalogEntry | null) => void;
  params: { Width: number; Depth: number; Height: number };
  onParamsChange: (p: Partial<{ Width: number; Depth: number; Height: number }>) => void;
}

/**
 * Searchable/filterable catalog browser — the F3 "Element Library"
 * surface. Replaces one fixed type-chip per element (the earlier Sensor
 * POC's approach) with a single data-driven list fed by whatever
 * `CatalogProvider` is active (`useCatalogEntries`, generic local seed
 * data today).
 */
function LibrarySection({ selection, onSelect, params, onParamsChange }: LibrarySectionProps) {
  const { entries, source, refresh } = useCatalogEntries();
  const [search, setSearch] = useState('');
  const [discipline, setDiscipline] = useState<'all' | CatalogEntry['discipline']>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (discipline !== 'all' && e.discipline !== discipline) return false;
      if (!q) return true;
      return e.label.toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
    });
  }, [entries, search, discipline]);

  return (
    <section className="space-y-2 pt-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Element Library
        </Label>
        <span className="text-[9px] font-mono uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          {source === 'file-import' ? 'Firmenbibliothek' : 'Example data'}
        </span>
      </div>

      <CatalogImportControls source={source} onImported={refresh} />

      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400" />
        <Input
          type="text"
          placeholder="Search elements…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 pl-7 font-mono text-xs"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {DISCIPLINE_FILTERS.map(({ value, label }) => (
          <ModeChip key={value} selected={discipline === value} onClick={() => setDiscipline(value)}>
            {label}
          </ModeChip>
        ))}
      </div>

      <div className="max-h-48 overflow-y-auto rounded-sm border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900">
        {filtered.length === 0 && (
          <p className="p-3 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
            {entries.length === 0 ? 'Loading catalog…' : 'No elements match this search.'}
          </p>
        )}
        {filtered.map((entry) => {
          const active = selection?.id === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry)}
              aria-pressed={active}
              className={[
                'w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors',
                active
                  ? 'bg-emerald-50 dark:bg-emerald-950/40'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-900',
              ].join(' ')}
            >
              <DisciplineDot discipline={entry.discipline} />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-mono text-zinc-900 dark:text-zinc-100 truncate">
                  {entry.label}
                </span>
                <span className="block text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                  {entry.category} · {entry.ifc.entity}
                  {entry.ifc.predefinedType ? `.${entry.ifc.predefinedType}` : ''}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {selection && (
        <div className="rounded-sm border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-2 space-y-2">
          <div className="text-[10px] font-mono text-emerald-800 dark:text-emerald-300">
            Selected: <span className="font-semibold">{selection.label}</span>
            {selection.description && (
              <span className="block text-zinc-500 dark:text-zinc-400 mt-0.5">{selection.description}</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Width" suffix="m" value={params.Width} min={0.01} onChange={(v) => onParamsChange({ Width: v })} />
            <NumberField label="Depth" suffix="m" value={params.Depth} min={0.01} onChange={(v) => onParamsChange({ Depth: v })} />
            <NumberField label="Height" suffix="m" value={params.Height} min={0.01} onChange={(v) => onParamsChange({ Height: v })} />
          </div>
        </div>
      )}
    </section>
  );
}

function DisciplineDot({ discipline }: { discipline: CatalogEntry['discipline'] }) {
  const color = {
    fire: 'bg-red-500',
    security: 'bg-blue-500',
    intrusion: 'bg-amber-500',
    other: 'bg-zinc-400',
  }[discipline];
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${color}`} aria-hidden="true" />;
}

function NumberField({ label, suffix, value, min, onChange }: NumberFieldProps) {
  const id = `add-elem-${label.toLowerCase()}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
        {label}
        {suffix && <span className="text-zinc-400 dark:text-zinc-600 ml-1">({suffix})</span>}
      </Label>
      <Input
        id={id}
        type="number"
        step={0.05}
        min={min}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next) && next >= min) onChange(next);
        }}
        className="h-8 font-mono text-xs"
      />
    </div>
  );
}
