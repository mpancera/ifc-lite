/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { assignableStoreys } from '@/lib/heights/underlayStack';
import {
  alignmentPairs, alignmentPrompt, isLineComplete,
} from '@/lib/heights/alignmentSession';
import { describeSolvedScale, solveDxfPlacement } from '@ifc-lite/drawing-2d';
import { Eye, EyeOff, Trash2, ChevronDown, ChevronRight, AlertTriangle, Crosshair } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { resolveEffectiveGeoreferenced } from '@/hooks/dxfUnderlayMath';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { drawingModelCenter } from '@/hooks/dxfDrawingBounds';
import { dxfReferenceStatus } from '@/hooks/dxfReferencePlane';
import type { DxfUnderlayState } from '@/store/slices/drawing2DSlice';
function PlacementField({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  step: number;
  onCommit: (value: number) => void;
}): React.ReactElement {
  const inputId = React.useId();
  return (
    <div className="flex flex-col gap-0.5">
      <Label htmlFor={inputId} className="text-2xs text-muted-foreground">{label}</Label>
      <Input
        id={inputId}
        type="number"
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
        onChange={(e) => {
          const n = Number.parseFloat(e.target.value);
          if (Number.isFinite(n)) onCommit(n);
        }}
        className="h-6 text-xs px-1.5"
      />
    </div>
  );
}

export function UnderlayCard({
  state,
  onCenterOnModel,
  planViewActive,
  georeferenceAvailable,
  sectionPlane,
}: {
  state: DxfUnderlayState;
  onCenterOnModel: (id: string) => void;
  planViewActive: boolean;
  georeferenceAvailable: boolean;
  sectionPlane?: SectionPlaneConfig;
}): React.ReactElement {
  const { t } = useTranslation();
  useViewerStore(s => s.models);
  useViewerStore(s => s.geometryResult);
  useViewerStore(s => s.modelPlacement);
  const viewer = useViewerStore.getState();
  const planeReference = !!state.referenceFrame;
  const status = sectionPlane ? dxfReferenceStatus(state, viewer, sectionPlane) : 'edge-on';
  const modelDrawing = useViewerStore(s => s.drawing2D);
  const hasModelExtent = drawingModelCenter(modelDrawing) !== null;
  const canCenter = hasModelExtent && (planeReference ? status === 'ready' : planViewActive);
  const removeDxfUnderlay = useViewerStore((s) => s.removeDxfUnderlay);
  const setDxfUnderlayVisible = useViewerStore((s) => s.setDxfUnderlayVisible);
  const setDxfUnderlayVisible3D = useViewerStore((s) => s.setDxfUnderlayVisible3D);
  const setDxfUnderlayOpacity = useViewerStore((s) => s.setDxfUnderlayOpacity);
  const setDxfUnderlayStorey = useViewerStore((s) => s.setDxfUnderlayStorey);
  const heightSystem = useViewerStore((s) => s.heightSystem);
  const storeyOptions = useMemo(() => assignableStoreys(heightSystem), [heightSystem]);
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const deriveHeights = useViewerStore((s) => s.deriveHeightSystemFrom);
  const startManualHeights = useViewerStore((s) => s.startManualHeightSystem);
  const toggleDxfUnderlayLayer = useViewerStore((s) => s.toggleDxfUnderlayLayer);
  const updateDxfUnderlayPlacement = useViewerStore((s) => s.updateDxfUnderlayPlacement);
  const setDxfUnderlayGeoreferenced = useViewerStore((s) => s.setDxfUnderlayGeoreferenced);

  const [layersOpen, setLayersOpen] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);

  const session = useViewerStore((s) => s.dxfAlignment);
  const startDxfAlignment = useViewerStore((s) => s.startDxfAlignment);
  const editDxfAlignmentLine = useViewerStore((s) => s.editDxfAlignmentLine);
  const cancelDxfAlignment = useViewerStore((s) => s.cancelDxfAlignment);
  const setAlignmentLockScale = useViewerStore((s) => s.setDxfAlignmentLockScale);
  const aligning = session?.underlayId === state.id;

  /**
   * Solve and apply, then say what the scale turned out to be.
   *
   * The scale is reported rather than only applied: a DXF carries no reliable
   * unit, so a factor of 1000 is the answer to a question the file could not
   * answer — and a factor silently absorbed is a fact nobody learns.
   */
  const applyAlignment = () => {
    const pairs = session ? alignmentPairs(session) : null;
    if (!pairs || !session) return;

    const result = solveDxfPlacement(pairs[0], pairs[1],
      session.lockScale ? { lockScale: state.placement.scale } : {});
    if (!result.ok) {
      toast.error(result.reason === 'coincident-source'
        ? 'Die zwei Punkte auf dem Plan liegen aufeinander.'
        : 'Die zwei Punkte im Modell liegen aufeinander.');
      return;
    }

    updateDxfUnderlayPlacement(state.id, result.placement);
    cancelDxfAlignment();

    const unit = describeSolvedScale(1 / result.scale);
    toast.success(unit
      ? `Ausgerichtet. Massstab ${result.scale.toPrecision(4)} — die Zeichnung war offenbar in ${unit}.`
      : `Ausgerichtet. Massstab ${result.scale.toPrecision(4)}, Drehung ${result.rotationDeg.toFixed(2)}°.`);
  };

  const { underlay, placement } = state;
  const pathCount = underlay.layers.reduce((n, l) => n + l.paths.length + l.fills.length, 0);
  const textCount = underlay.layers.reduce((n, l) => n + l.texts.length, 0);

  return (
    <div className="border rounded-md p-2 space-y-2 bg-muted/20">
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="flex items-center">
          <IconButton
            label={t(state.visible ? 'drawingUnderlay.dxf.hide2DTitle' : 'drawingUnderlay.dxf.show2DTitle')}
            size="icon-sm"
            onClick={() => setDxfUnderlayVisible(state.id, !state.visible)}
          >
            {state.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </IconButton>
          <span className="text-2xs leading-none text-muted-foreground -ml-1">{t('drawingUnderlay.dxf.badge2D')}</span>
        </div>
        <div className="flex items-center">
          <IconButton
            label={t(state.visible3D ? 'drawingUnderlay.dxf.hide3DTitle' : 'drawingUnderlay.dxf.show3DTitle')}
            size="icon-sm"
            onClick={() => setDxfUnderlayVisible3D(state.id, !state.visible3D)}
          >
            {state.visible3D ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </IconButton>
          <span className="text-2xs leading-none text-muted-foreground -ml-1">3D</span>
        </div>
        <span className="text-xs font-medium truncate flex-1" title={state.name}>{state.name}</span>
        <IconButton
          label={t(!hasModelExtent ? 'drawingUnderlay.dxf.centerOnModelEmptyTitle'
            : canCenter ? 'drawingUnderlay.dxf.centerOnModelTitle' : 'drawingUnderlay.dxf.centerOnModelDisabledTitle')}
          size="icon-sm"
          onClick={() => onCenterOnModel(state.id)}
          disabled={!canCenter}
        >
          <Crosshair className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label={t('drawingUnderlay.dxf.removeUnderlayTitle')}
          size="icon-sm"
          onClick={() => removeDxfUnderlay(state.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      <div className="text-2xs text-muted-foreground px-1">
        {t('drawingUnderlay.dxf.summaryLine', { layers: underlay.layers.length, paths: pathCount, texts: textCount })}
      </div>

      {planeReference && status !== 'ready' && <p className="px-1 text-2xs text-amber-700 dark:text-amber-400">
        {t(status === 'frame-mismatch' ? 'appearance.referenceLibrary.wrongFrameNotice' : 'drawingUnderlay.reference.edgeOn')}
      </p>}
      {!planeReference && !planViewActive && <p className="px-1 text-2xs text-muted-foreground">{t('drawingUnderlay.dxf.notPlanViewHint')}</p>}

      {underlay.warnings.length > 0 && (
        <div className="flex items-start gap-1 text-2xs text-amber-600 dark:text-amber-500 px-1">
          <AlertTriangle className="h-3 w-3 mt-px shrink-0" />
          <span>{underlay.warnings[0]}{underlay.warnings.length > 1 ? t('drawingUnderlay.dxf.moreWarningsSuffix', { count: underlay.warnings.length - 1 }) : ''}</span>
        </div>
      )}

      {/* Skipped entity types (parser-computed `underlay.skipped`, a
          type→count map — distinct from `warnings`, a message list, so it
          gets its own line rather than being concatenated with warnings
          above). This is the only place a user can learn that part of the
          DXF did not import: `ingestDxfFile` only logs `skipped` to the
          console, and only when the underlay has ZERO drawable entities —
          the common case of "most of it imported, N entities of type X
          did not" was previously silent. */}
      {Object.keys(underlay.skipped).length > 0 && (
        <div className="flex items-start gap-1 text-2xs text-amber-600 dark:text-amber-500 px-1">
          <AlertTriangle className="h-3 w-3 mt-px shrink-0" />
          <span>
            {t('drawingUnderlay.dxf.notImportedLabel')} {Object.entries(underlay.skipped)
              .map(([type, count]) => `${count}× ${type}`)
              .join(', ')}
          </span>
        </div>
      )}

      {/* Which storey this plan is. The step that turns a pile of drawings
          into a building: assigned plans sit at their storey's elevation and
          stack, unassigned ones lie at zero on top of each other. */}
      <div className="flex items-center gap-2 px-1">
        <Label className="w-12 text-[10px] text-muted-foreground">Geschoss</Label>
        <select
          className="h-6 flex-1 rounded-sm border bg-transparent px-1 text-[11px]"
          value={state.storeyId ?? ''}
          onChange={(e) => setDxfUnderlayStorey(state.id, e.target.value || undefined)}
        >
          <option value="">— nicht zugeordnet —</option>
          {storeyOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.elevation.toFixed(3)} m
            </option>
          ))}
        </select>
      </div>
      {state.storeyId !== undefined && !storeyOptions.some((s) => s.id === state.storeyId) && (
        // A broken assignment is shown, not silently treated as unassigned:
        // the two mean different things, and only this one is a mistake.
        <div className="flex items-start gap-1 px-1 text-[10px] text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>Das zugeordnete Geschoss gibt es nicht mehr — bitte neu zuordnen.</span>
        </div>
      )}
      {storeyOptions.length === 0 && (
        // A dead end otherwise: the list is empty and the hint sends somebody
        // to another panel to do a thing they can just as well do here. Which
        // of the two offers appears depends on whether there is a model to
        // read levels FROM — the two are different acts, not two buttons for
        // the same one.
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-muted-foreground">Noch keine Geschosse.</span>
          {activeModelId ? (
            <Button
              variant="outline" size="sm" className="h-5 px-1.5 text-[10px]"
              onClick={() => {
                if (!deriveHeights(activeModelId)) {
                  toast.error('Aus diesem Modell liessen sich keine Geschosse lesen.');
                }
              }}
            >
              Aus Modell ableiten
            </Button>
          ) : (
            <Button
              variant="outline" size="sm" className="h-5 px-1.5 text-[10px]"
              onClick={() => startManualHeights()}
            >
              Von Hand festlegen
            </Button>
          )}
        </div>
      )}

      {/* Opacity — PR #2114 review: the slider only affects the 2D drawing
          panel. The 3D viewport's line pipeline (`Section2DOverlayRenderer`)
          shares one un-blended `linePipeline`/uniform colour across the
          grid, alignment, annotation and DXF line overlays; giving each DXF
          underlay its own alpha would mean splitting the merged 3D DXF
          line buffer (`useDxfUnderlays3DLines`) into a per-underlay draw
          call and adding blend state to that shared pipeline — out of
          scope here, so `useDxfUnderlays3DLines`'s `opacity > 0` check
          stays a binary gate. The title below and the "(2D)" suffix make
          that explicit rather than leaving the control silently no-op in
          3D. */}
      <div className="flex items-center gap-2 px-1">
        <Label className="text-2xs text-muted-foreground w-12" title={t('drawingUnderlay.dxf.opacityHint')}>
          {t('drawingUnderlay.dxf.opacityLabel')}
        </Label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={state.opacity}
          onChange={(e) => setDxfUnderlayOpacity(state.id, Number.parseFloat(e.target.value))}
          className="flex-1 h-1.5 accent-primary"
          title={t('drawingUnderlay.dxf.opacityHint')}
        />
        <span className="text-2xs text-muted-foreground w-8 text-right">{Math.round(state.opacity * 100)}%</span>
      </div>

      {/* Georeference alignment (issue #1929) — mirrors the .laz/.las
          "Align to model georeference" toggle (issue #1804), but per-DXF
          since each imported file may or may not be in map/CRS
          coordinates. Tri-state (PR #1965 review): a freshly-imported
          entry starts in "auto" (`state.georeferenced === undefined`) and
          the checkbox shows the EFFECTIVE resolved state — following
          `georeferenceAvailable` — until the user clicks it, at which
          point it becomes an explicit true/false that no longer moves on
          its own. */}
      {!planeReference && (() => {
        const isAuto = state.georeferenced === undefined;
        const effectiveChecked = resolveEffectiveGeoreferenced(state, georeferenceAvailable);
        return (
          <label
            className="flex items-center justify-between gap-2 cursor-pointer px-1"
            title={
              isAuto
                ? t('drawingUnderlay.dxf.georefAutoHint', { state: t(effectiveChecked ? 'drawingUnderlay.dxf.onState' : 'drawingUnderlay.dxf.offState') })
                : t('drawingUnderlay.dxf.georefManualHint')
            }
          >
            <span className="text-2xs text-muted-foreground">
              {t('drawingUnderlay.dxf.georefToggleLabel')}{isAuto ? t('drawingUnderlay.dxf.georefAutoSuffix') : ''}
            </span>
            <input
              type="checkbox"
              checked={effectiveChecked}
              onChange={(e) => setDxfUnderlayGeoreferenced(state.id, e.target.checked)}
              className="accent-primary"
            />
          </label>
        );
      })()}

      {/* DXF layers */}
      <Collapsible open={layersOpen} onOpenChange={setLayersOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1 text-xs font-medium w-full px-1 py-0.5 hover:text-primary">
            {layersOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {t('drawingUnderlay.dxf.layersSectionLabel')}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-0.5 pl-2 max-h-48 overflow-y-auto">
            {underlay.layers.map((layer) => {
              const layerVisible = state.layerVisibility[layer.name] ?? layer.visible;
              return (
                <button
                  key={layer.name}
                  onClick={() => toggleDxfUnderlayLayer(state.id, layer.name)}
                  className="flex items-center gap-1.5 w-full px-1 py-0.5 rounded hover:bg-muted text-left"
                  title={t(layerVisible ? 'drawingUnderlay.dxf.hideLayerTitle' : 'drawingUnderlay.dxf.showLayerTitle', { name: layer.name })}
                >
                  {layerVisible ? (
                    <Eye className="h-3 w-3 shrink-0" />
                  ) : (
                    <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className="w-2.5 h-2.5 rounded-sm border shrink-0"
                    style={{ backgroundColor: layer.color }}
                  />
                  <span className={`text-2xs truncate ${layerVisible ? '' : 'text-muted-foreground'}`}>
                    {layer.name}
                  </span>
                  <span className="text-2xs text-muted-foreground ml-auto shrink-0">
                    {layer.paths.length + layer.fills.length + layer.texts.length}
                  </span>
                </button>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {/* Placement */}
      <Collapsible open={placementOpen} onOpenChange={setPlacementOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1 text-xs font-medium w-full px-1 py-0.5 hover:text-primary">
            {placementOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {t('drawingUnderlay.dxf.placementSectionLabel')}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-2 gap-1.5 pl-2 pr-1 pt-1">
            <PlacementField
              label={t(planeReference ? 'drawingUnderlay.dxf.offsetU' : 'drawingUnderlay.dxf.offsetX')}
              value={placement.offsetX}
              step={0.1}
              onCommit={(v) => updateDxfUnderlayPlacement(state.id, { offsetX: v })}
            />
            {/* Drawing-space +y points south on a plan; show north-positive. */}
            <PlacementField
              label={t(planeReference ? 'drawingUnderlay.dxf.offsetV' : 'drawingUnderlay.dxf.offsetY')}
              value={planeReference ? placement.offsetY : -placement.offsetY}
              step={0.1}
              onCommit={(v) => updateDxfUnderlayPlacement(state.id, { offsetY: planeReference ? v : -v })}
            />
            <PlacementField
              label="Rotation (°)"
              value={placement.rotationDeg}
              step={1}
              onCommit={(v) => updateDxfUnderlayPlacement(state.id, { rotationDeg: v })}
            />
            <PlacementField
              label="Scale"
              value={placement.scale}
              step={0.1}
              onCommit={(v) => {
                if (v > 0) updateDxfUnderlayPlacement(state.id, { scale: v });
              }}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Two-point alignment. Typing offset, rotation and scale is trial and
          error, because the three interact; naming two features settles all
          three at once. */}
      {aligning ? (
        <div className="rounded-sm border border-primary/50 bg-primary/5 px-2 py-1.5">
          <p className="text-[11px]">{alignmentPrompt(session!)}</p>
          {/* Each line can be re-drawn on its own. The reference is usually
              right first time and the fitting line is the one that needs
              nudging; redoing both to fix one end was the worst part of the
              earlier four-point version. */}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Button
              variant={session!.editing === 'reference' ? 'default' : 'outline'}
              size="sm" className="h-5 px-1.5 text-[10px]"
              onClick={() => editDxfAlignmentLine('reference')}
            >
              Referenzlinie bearbeiten
            </Button>
            <Button
              variant={session!.editing === 'fit' ? 'default' : 'outline'}
              size="sm" className="h-5 px-1.5 text-[10px]"
              onClick={() => editDxfAlignmentLine('fit')}
            >
              Passlinie bearbeiten
            </Button>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className={isLineComplete(session!.reference) ? 'text-blue-700' : ''}>
              ● Referenz {isLineComplete(session!.reference) ? 'gesetzt' : 'offen'}
            </span>
            <span className={isLineComplete(session!.fit) ? 'text-orange-700' : ''}>
              ┄ Passlinie {isLineComplete(session!.fit) ? 'gesetzt' : 'offen'}
            </span>
          </div>
          <label className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              checked={session!.lockScale}
              onChange={(e) => setAlignmentLockScale(e.target.checked)}
            />
            Massstab beibehalten
          </label>
          <div className="mt-1 flex items-center gap-1">
            <Button
              variant="outline" size="sm" className="h-5 px-1.5 text-[10px]"
              disabled={alignmentPairs(session!) === null}
              onClick={applyAlignment}
            >
              Übernehmen
            </Button>
            <Button
              variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]"
              onClick={cancelDxfAlignment}
            >
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline" size="sm" className="h-6 w-full text-[11px]"
          onClick={() => startDxfAlignment(state.id)}
        >
          <Crosshair className="mr-1 h-3 w-3" />
          Über Referenz- und Passlinie ausrichten
        </Button>
      )}
    </div>
  );
}
