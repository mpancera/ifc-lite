/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Plan mode — a floor plan you work on, not a camera looking down.
 *
 * # Why this reuses the 2D drawing renderer
 * The open question in #50 was whether plan mode should reuse
 * `Drawing2DCanvas` or teach the 3D renderer to draw flat. Reuse, for three
 * reasons that are properties of the pipeline rather than preferences:
 *
 * 1. **Orthographic and orbit-locked come for free.** There is no camera. A
 *    canvas has no projection to foreshorten and no orbit to lock out, so the
 *    failure mode the mode exists to avoid cannot occur here by construction.
 * 2. **Picking follows the cut, not depth.** The drawing contains only what the
 *    cut produced, and every line and polygon in it already carries the
 *    `entityId` it came from. So a hit test on the drawing hits what is on this
 *    floor. In the 3D renderer the slab overhead is nearest the eye, and every
 *    pick would have to be talked out of it.
 * 3. **The drawing look already exists.** Heavy cut edges, light projection,
 *    dashed hidden lines, hatched cut faces, no shading — that is what this
 *    renderer draws. The 2D drafting palette is deliberately single-sourced
 *    (root AGENTS.md), and a second flat renderer would fork it.
 *
 * This is also why the 2D Section tool stays: it owns the same renderer for a
 * different question ("what does a section here look like"), and plan mode
 * borrows the renderer without touching its state.
 *
 * # What plan mode does NOT touch
 * It never writes `sectionPlane`. The cut is derived here and handed to the
 * generation hook as a parameter, so leaving plan mode does not leave the model
 * sliced open, and the 2D Section panel keeps whatever cut the user set there.
 * The drawing lives in local state for the same reason.
 */

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { GraphicOverrideEngine, type Drawing2D } from '@ifc-lite/drawing-2d';
import type { AnnotationGeometry } from '@ifc-lite/create';
import { toast } from '@/components/ui/toast';
import type { GeometryResult } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { Drawing2DCanvas } from './Drawing2DCanvas';
import { PlanLabels } from './PlanLabels';
import { PlanOpeningSymbols } from './PlanOpeningSymbols';
import { PlanNorthArrow } from './PlanNorthArrow';
import { PlanScaleBar } from './PlanScaleBar';
import { PlanToolbar } from './PlanToolbar';
import { DrawingSettingsPanel } from './DrawingSettingsPanel';
import { DxfUnderlayPanel } from './DxfUnderlayPanel';
import { TextAnnotationEditor } from './TextAnnotationEditor';
import { useDrawingGeneration } from '@/hooks/useDrawingGeneration';
import { useViewControls } from '@/hooks/useViewControls';
import { useMeasure2D } from '@/hooks/useMeasure2D';
import { useAnnotation2D } from '@/hooks/useAnnotation2D';
import { useDrawingExport } from '@/hooks/useDrawingExport';
import { useSymbolicAnnotationsForDrawing } from '@/hooks/useSymbolicAnnotations';
import { useDxfUnderlaysForDrawing, dxfWorldShift, dxfUnderlayDrawingBounds } from '@/hooks/useDxfUnderlay';
import { useCombinedVisibilityIds } from '@/hooks/useCombinedVisibilityIds';
import { usePlanRoomLabels } from '@/hooks/usePlanRoomLabels';
import { roomPlanLabel } from '@/lib/plan/roomLabels';
import { usePlanOpeningSymbols } from '@/hooks/usePlanOpeningSymbols';
import { useLensColorKeys } from '@/hooks/useLensColorKeys';
import { useModelOrigins } from '@/hooks/useModelOrigins';
import { planStoreys, defaultPlanStorey, planCut, type PlanStorey } from '@/lib/plan/planCut';
import {
  rotationToDirection, normalizeAngle, bearingToAngle, angleToBearing, normalizeBearing,
  RAD_TO_DEG, DEG_TO_RAD,
} from '@/lib/plan/planRotation';
import { pickInPlan, planScreenToDrawing, planPointToRenderer, planPointToStoreyLocal } from '@/lib/plan/planPick';
import { handleAddElementDrop } from './selectionHandlers';
import { toGlobalIdFromModels, fromGlobalIdFromModels } from '@/store/globalId';
import { resolveEntityRef } from '@/store/resolveEntityRef';
import { applyLevelDisplayMode } from '@/store/levelDisplay';
import type { LevelDisplayMode } from '@/store/slices/levelDisplaySlice';
import type { EntityRef } from '@/store/types';

interface PlanViewProps {
  mergedGeometry?: GeometryResult | null;
  computedIsolatedIds?: Set<number> | null;
  /** Model id → the `modelIndex` the drawing pipeline stamps on its geometry. */
  modelIdToIndex?: Map<string, number>;
}

/**
 * Grab radius for a click, in SCREEN pixels.
 *
 * Converted to drawing units against the live zoom so it stays the same size
 * under the cursor whether the plan is at 1:20 or 1:500 — a tolerance fixed in
 * metres would be unusably fat zoomed out and unhittable zoomed in.
 */
const PICK_TOLERANCE_PX = 6;

/** How far the cursor may travel between press and release and still count as a
 *  click rather than the start of a pan. */
const CLICK_SLOP_PX = 4;

/** The plan is always a horizontal cut. */
const PLAN_AXIS = 'down' as const;

/**
 * IFC annotations get a tight view-depth slab so dimension chains from the
 * storey above do not stack onto this floor. Same convention and same constant
 * the 2D Section panel uses.
 */
const ANNOTATION_VIEW_DEPTH = 1.2;

/** The scan layer is deliberately not offered on a plan yet; the export still
 *  wants the shape. Module-level so it keeps a stable identity. */
const EMPTY_SCAN_SECTION = { points: [] as const };

export function PlanView({
  mergedGeometry,
  computedIsolatedIds,
  modelIdToIndex,
}: PlanViewProps): React.ReactElement | null {
  const viewMode = useViewerStore((s) => s.viewMode);
  // Which storey the plan shows is `activeStorey` — the same field the
  // hierarchy, the storey tabs, the command palette and Solo drive. Reading it
  // rather than keeping a `planStoreyId` beside it is what makes a storey click
  // in the hierarchy move the plan too.
  const activeStorey = useViewerStore((s) => s.activeStorey);
  const planCutHeight = useViewerStore((s) => s.planCutHeight);
  const setPlanCutHeight = useViewerStore((s) => s.setPlanCutHeight);
  const planRotation = useViewerStore((s) => s.planRotation);
  const setPlanRotation = useViewerStore((s) => s.setPlanRotation);
  const planRotationPicking = useViewerStore((s) => s.planRotationPicking);
  const setPlanRotationPicking = useViewerStore((s) => s.setPlanRotationPicking);
  const planShowRoomLabels = useViewerStore((s) => s.planShowRoomLabels);
  const setPlanShowRoomLabels = useViewerStore((s) => s.setPlanShowRoomLabels);
  const planShowOpeningSymbols = useViewerStore((s) => s.planShowOpeningSymbols);
  const setPlanShowOpeningSymbols = useViewerStore((s) => s.setPlanShowOpeningSymbols);
  const models = useViewerStore((s) => s.models);
  const activeTool = useViewerStore((s) => s.activeTool);
  const addElementPendingPoints = useViewerStore((s) => s.addElementPendingPoints);
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const selectedEntityIds = useViewerStore((s) => s.selectedEntityIds);

  // Drawing preferences are SHARED with the 2D Section tool: they describe how
  // a drawing should look, not which drawing this is, and the settings panel
  // and underlay list they drive are single instances. Regenerating the other
  // surface costs nothing while its panel is closed, which is the normal case.
  const displayOptions = useViewerStore((s) => s.drawing2DDisplayOptions);
  const updateDisplayOptions = useViewerStore((s) => s.updateDrawing2DDisplayOptions);
  const activePresetId = useViewerStore((s) => s.activePresetId);
  const overridesEnabled = useViewerStore((s) => s.overridesEnabled);
  const getActiveOverrideRules = useViewerStore((s) => s.getActiveOverrideRules);
  const customOverrideRules = useViewerStore((s) => s.customOverrideRules);
  const dxfUnderlays = useViewerStore((s) => s.dxfUnderlays);

  // Annotation + measure state, all of it already in the store and already
  // shaped for these hooks.
  const annotation2DActiveTool = useViewerStore((s) => s.annotation2DActiveTool);
  const setAnnotation2DActiveTool = useViewerStore((s) => s.setAnnotation2DActiveTool);
  const measure2DStart = useViewerStore((s) => s.measure2DStart);
  const measure2DCurrent = useViewerStore((s) => s.measure2DCurrent);
  const setMeasure2DStart = useViewerStore((s) => s.setMeasure2DStart);
  const setMeasure2DCurrent = useViewerStore((s) => s.setMeasure2DCurrent);
  const setMeasure2DShiftLocked = useViewerStore((s) => s.setMeasure2DShiftLocked);
  const measure2DShiftLocked = useViewerStore((s) => s.measure2DShiftLocked);
  const measure2DLockedAxis = useViewerStore((s) => s.measure2DLockedAxis);
  const measure2DResults = useViewerStore((s) => s.measure2DResults);
  const completeMeasure2D = useViewerStore((s) => s.completeMeasure2D);
  const cancelMeasure2D = useViewerStore((s) => s.cancelMeasure2D);
  const clearMeasure2DResults = useViewerStore((s) => s.clearMeasure2DResults);
  const measure2DSnapPoint = useViewerStore((s) => s.measure2DSnapPoint);
  const setMeasure2DSnapPoint = useViewerStore((s) => s.setMeasure2DSnapPoint);
  const polygonArea2DPoints = useViewerStore((s) => s.polygonArea2DPoints);
  const polygonArea2DResults = useViewerStore((s) => s.polygonArea2DResults);
  const addPolygonArea2DPoint = useViewerStore((s) => s.addPolygonArea2DPoint);
  const completePolygonArea2D = useViewerStore((s) => s.completePolygonArea2D);
  const cancelPolygonArea2D = useViewerStore((s) => s.cancelPolygonArea2D);
  const textAnnotations2D = useViewerStore((s) => s.textAnnotations2D);
  const addTextAnnotation2D = useViewerStore((s) => s.addTextAnnotation2D);
  const updateTextAnnotation2D = useViewerStore((s) => s.updateTextAnnotation2D);
  const removeTextAnnotation2D = useViewerStore((s) => s.removeTextAnnotation2D);
  const textAnnotation2DEditing = useViewerStore((s) => s.textAnnotation2DEditing);
  const setTextAnnotation2DEditing = useViewerStore((s) => s.setTextAnnotation2DEditing);
  const cloudAnnotation2DPoints = useViewerStore((s) => s.cloudAnnotation2DPoints);
  const cloudAnnotations2D = useViewerStore((s) => s.cloudAnnotations2D);
  const addCloudAnnotation2DPoint = useViewerStore((s) => s.addCloudAnnotation2DPoint);
  const completeCloudAnnotation2D = useViewerStore((s) => s.completeCloudAnnotation2D);
  const cancelCloudAnnotation2D = useViewerStore((s) => s.cancelCloudAnnotation2D);
  const selectedAnnotation2D = useViewerStore((s) => s.selectedAnnotation2D);
  const setSelectedAnnotation2D = useViewerStore((s) => s.setSelectedAnnotation2D);
  const deleteSelectedAnnotation2D = useViewerStore((s) => s.deleteSelectedAnnotation2D);
  const moveAnnotation2D = useViewerStore((s) => s.moveAnnotation2D);
  const setAnnotation2DCursorPos = useViewerStore((s) => s.setAnnotation2DCursorPos);
  const annotation2DCursorPos = useViewerStore((s) => s.annotation2DCursorPos);
  const clearAllAnnotations2D = useViewerStore((s) => s.clearAllAnnotations2D);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dxfPanelOpen, setDxfPanelOpen] = useState(false);
  const { geometryResult: legacyGeometryResult, ifcDataStore } = useIfc();
  const geometryResult = mergedGeometry ?? legacyGeometryResult;

  const active = viewMode === '2d';

  // Drawing state is LOCAL, not the shared `drawing2D` slice: writing there
  // would replace whatever the 2D Section panel is showing the moment plan mode
  // opens, and both are supposed to survive each other.
  const [drawing, setDrawing] = useState<Drawing2D | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [progressPhase, setProgressPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setDrawingProgress = useCallback((p: number, phase: string) => {
    setProgress(p);
    setProgressPhase(phase);
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const cachedSheetTransformRef = useRef<{
    translateX: number; translateY: number; scaleFactor: number;
  } | null>(null);

  const { combinedHiddenIds, combinedIsolatedIds } = useCombinedVisibilityIds();
  const lensColorKeys = useLensColorKeys(modelIdToIndex);

  // Adopt this project's saved rotation when the plan opens. A working state,
  // not model content: nothing is written into the IFC.
  const restorePlanRotationForProject = useViewerStore((s) => s.restorePlanRotationForProject);
  useEffect(() => {
    if (active) restorePlanRotationForProject();
  }, [active, restorePlanRotationForProject]);

  // Where each model says its IFC (0,0,0) is. Same derivation the 3D
  // basepoint markers use — a plan that disagreed with the 3D view about the
  // origin would make the diagnostic itself untrustworthy.
  const showModelBasepoints = useViewerStore((s) => s.showModelBasepoints);
  const modelOrigins = useModelOrigins(active && showModelBasepoints);

  // ── The storeys this model can be cut at ────────────────────────────────
  // Single-model only: `elementToStorey` keys are LOCAL express ids, so on a
  // federation they would collide with another model's mesh ids and derive
  // floors for the wrong building. Federated plan mode is its own problem.
  const { storeys, storeyModelId, storeyDataStore } = useMemo((): {
    storeys: PlanStorey[];
    /** Which model the storeys belong to, for the isolation ref. */
    storeyModelId: string | null;
    /** That model's store, for anything else that has to read the model. */
    storeyDataStore: IfcDataStore | null;
  } => {
    const singleEntry = models.size === 1 ? [...models.entries()][0] : null;
    const modelId = singleEntry ? singleEntry[0] : models.size === 0 ? 'legacy' : null;
    const dataStore = (singleEntry?.[1]?.ifcDataStore ?? (models.size === 0 ? ifcDataStore : null)) as
      | IfcDataStore
      | null
      | undefined;
    const sh = dataStore?.spatialHierarchy;
    if (!sh || !geometryResult?.meshes || modelId === null) {
      return { storeys: [], storeyModelId: null, storeyDataStore: null };
    }

    const names = new Map<number, string>();
    for (const storeyId of sh.byStorey.keys()) {
      const name = dataStore?.entities?.getName(storeyId);
      if (name) names.set(storeyId, name);
    }
    return {
      storeys: planStoreys(geometryResult.meshes, {
        names,
        elevations: sh.storeyElevations,
        elementToStorey: sh.elementToStorey,
      }),
      storeyModelId: modelId,
      storeyDataStore: dataStore ?? null,
    };
  }, [models, ifcDataStore, geometryResult]);

  // The storey in scope app-wide, or the default. An `activeStorey` that this
  // model has no geometry for — a stale ref after a model swap, or a storey
  // with no members — falls through to the default rather than showing
  // nothing, which would look like a model with no storeys at all.
  const storey = useMemo(() => {
    if (activeStorey) {
      const chosen = storeys.find((s) => s.expressId === activeStorey.expressId);
      if (chosen) return chosen;
    }
    return defaultPlanStorey(storeys);
  }, [activeStorey, storeys]);

  // ── The rooms on this floor ─────────────────────────────────────────────
  // Derived whenever the plan is open, not only when the labels are switched
  // on: the toolbar says how many rooms this storey has, and a count that
  // appeared only once you had already asked to see them would be useless.
  const roomLabels = usePlanRoomLabels({
    enabled: active,
    geometryResult,
    dataStore: storeyDataStore,
    modelId: storeyModelId,
    storeyId: storey?.expressId ?? null,
  });

  // Derived door swings and window sashes, for models that carry no plan
  // representation of their own. Same reason as the room count above for
  // deriving them whenever the plan is open: the toolbar reports how many
  // openings could be given a symbol at all.
  const { symbols: openingSymbols, doorLabels, assumedLinings } = usePlanOpeningSymbols({
    enabled: active,
    geometryResult,
    dataStore: storeyDataStore,
    storeyId: storey?.expressId ?? null,
    // The drawing carries the one measurement no model source gets right: how
    // thick the host wall is where a door goes through it.
    drawing,
  });

  // Room and door text are one layer: they are the same thing on a drawing,
  // and one switch is what somebody reaching for "turn the writing off" means.
  const planLabels = useMemo(
    () => [...roomLabels.map(roomPlanLabel), ...doorLabels],
    [roomLabels, doorLabels],
  );

  // ── Solo ────────────────────────────────────────────────────────────────
  // "The storey is solo, as if isolated in 3D" (#50) — and it IS the 3D one,
  // through `applyLevelDisplayMode`, which the viewer requires as the single
  // transition for storey isolation. Plan mode adding a second isolation
  // channel is exactly what left models stuck isolated before.
  //
  // The previous mode is restored on the way out. Plan mode is a mode, not an
  // edit: switching to a plan and back should leave the building looking the
  // way it did, not silently isolated to whichever floor was last drawn.
  const soloBackupRef = useRef<{ mode: LevelDisplayMode } | null>(null);
  useEffect(() => {
    if (!active || !storey || !storeyModelId) return;

    const state = useViewerStore.getState();
    if (soloBackupRef.current === null) {
      soloBackupRef.current = { mode: state.levelDisplayMode };
    }
    applyLevelDisplayMode('solo', { modelId: storeyModelId, expressId: storey.expressId });
  }, [active, storey, storeyModelId]);

  useEffect(() => {
    if (active) return;
    const backup = soloBackupRef.current;
    if (!backup) return;
    soloBackupRef.current = null;
    // The MODE is restored; the storey deliberately is not. Paging to the third
    // floor in the plan and switching to 3D should land on the third floor —
    // that is navigation the user just did, not state the plan borrowed.
    // Passing no ref lets the transition keep whichever storey is current.
    applyLevelDisplayMode(backup.mode);
  }, [active]);

  // ── The cut ─────────────────────────────────────────────────────────────
  const bounds = geometryResult?.coordinateInfo?.shiftedBounds;
  const cut = useMemo(() => {
    if (!storey || !bounds) return null;
    // `y` is the vertical axis in the render frame — the same one `AXIS_MAP`
    // maps the 'down' section axis onto, so the percentage below is measured
    // against exactly the extent the generator divides by.
    return planCut(storey.floorLevel, planCutHeight, bounds.min.y, bounds.max.y);
  }, [storey, planCutHeight, bounds]);

  // The generation hook takes the same shape the section slider produces. Plan
  // mode synthesises it instead of reading the store, so the model's real
  // section plane is untouched.
  const sectionPlane = useMemo(
    () => ({
      axis: PLAN_AXIS,
      position: cut?.ok ? cut.percent : 0,
      flipped: false,
    }),
    [cut],
  );

  // Generation runs only while the mode is on AND there is a usable cut:
  // generating at a fallback height would draw a plan of somewhere else.
  const generationActive = active && cut?.ok === true;

  const { doRegenerate, isRegenerating } = useDrawingGeneration({
    geometryResult,
    ifcDataStore,
    sectionPlane,
    displayOptions,
    combinedHiddenIds,
    combinedIsolatedIds,
    computedIsolatedIds,
    models,
    panelVisible: generationActive,
    drawing,
    setDrawing,
    setDrawingStatus: setStatus,
    setDrawingProgress,
    setDrawingError: setError,
  });

  // Fit ONCE, when the plan opens — never again on a storey change.
  //
  // Paging through floors is how a plan is read, and a set of drawings is
  // compared by looking at the same corner on each sheet. Refitting on every
  // switch throws away the zoom and the position the user just set, which is a
  // worse failure than the rare case it was guarding against (a storey whose
  // footprint sits outside the previous one, leaving the view apparently
  // empty). "Fit to view" is one click away when that happens.
  const hasFittedRef = useRef(false);

  const { viewTransform, setViewTransform, zoomIn, zoomOut, fitToView } = useViewControls({
    drawing,
    sectionPlane,
    containerRef,
    panelVisible: active,
    status,
    sheetEnabled: false,
    activeSheet: null,
    isPinned: true,
    cachedSheetTransformRef,
    rotation: planRotation,
  });

  // The transform the canvas paints with, and the one every screen-to-drawing
  // conversion below inverts. Built once so the two can never disagree.
  const planTransform = useMemo(
    () => ({ ...viewTransform, rotation: planRotation }),
    [viewTransform, planRotation],
  );

  // ── Selecting ───────────────────────────────────────────────────────────
  // The drawing carries LOCAL express ids plus the model they came from; the
  // store selects on GLOBAL ids. This inverts the map the drawing pipeline was
  // given, so the two agree even under federation.
  const indexToModelId = useMemo(() => {
    const out = new Map<number, string>();
    for (const [modelId, index] of modelIdToIndex ?? []) out.set(index, modelId);
    return out;
  }, [modelIdToIndex]);

  const selectAt = useCallback((clientX: number, clientY: number, additive: boolean) => {
    const container = containerRef.current;
    if (!container || !drawing) return;
    const rect = container.getBoundingClientRect();
    const point = planScreenToDrawing(clientX - rect.left, clientY - rect.top, planTransform);
    const hit = pickInPlan(drawing, point, PICK_TOLERANCE_PX / viewTransform.scale);

    const state = useViewerStore.getState();
    if (!hit) {
      // Clicking empty paper clears, exactly as clicking empty space does in 3D.
      if (!additive) {
        useViewerStore.setState({ selectedEntitiesSet: new Set(), selectedEntityIds: new Set() });
        state.setSelectedEntityId(null);
        state.setSelectedEntity(null);
      }
      return;
    }

    // Single model keeps the identity mapping the registry documents; a
    // federated drawing resolves through the index it was stamped with.
    const modelId =
      indexToModelId.get(hit.modelIndex) ??
      (state.models.size === 1 ? [...state.models.keys()][0] : null);
    const globalId = modelId
      ? toGlobalIdFromModels(state.models, modelId, hit.entityId)
      : hit.entityId;

    if (additive) {
      state.toggleEntitySelection(resolveEntityRef(globalId));
      state.toggleSelection(globalId);
      return;
    }

    // Both channels, per the viewer's selection contract: the global-id set
    // drives the renderer highlight, the EntityRef drives property lookup.
    // Writing only one leaves the plan and the panels disagreeing.
    useViewerStore.setState({ selectedEntitiesSet: new Set(), selectedEntityIds: new Set() });
    state.setSelectedEntityId(globalId);
    state.setSelectedEntity(resolveEntityRef(globalId));
  }, [drawing, planTransform, indexToModelId]);

  // ── The overlays the toolbar switches on ────────────────────────────────
  const overrideEngine = useMemo(
    () => new GraphicOverrideEngine(getActiveOverrideRules()),
    [getActiveOverrideRules, activePresetId, customOverrideRules, overridesEnabled],
  );

  const entityColorMap = useMemo(() => {
    const map = new Map<number, [number, number, number, number]>();
    for (const mesh of geometryResult?.meshes ?? []) {
      if (mesh.expressId && mesh.color) map.set(mesh.expressId, mesh.color);
    }
    return map;
  }, [geometryResult]);

  const ifcAnnotationData = useSymbolicAnnotationsForDrawing({
    enabled: displayOptions.showIfcAnnotations && status === 'ready' && active,
    axis: PLAN_AXIS,
    sectionPosWorld: cut?.ok ? cut.worldY : 0,
    viewDepth: ANNOTATION_VIEW_DEPTH,
    flipped: false,
    // Annotations with no resolvable storey land on the cut rather than at the
    // model's mid-height: on a plan the cut IS the reference elevation.
    fallbackY: cut?.ok ? cut.worldY : 0,
  });

  const dxfUnderlayData = useDxfUnderlaysForDrawing({
    enabled: status === 'ready' && active,
    sectionAxis: PLAN_AXIS,
    isCustomPlane: false,
    flipped: false,
    coordinateInfo: geometryResult?.coordinateInfo,
  });

  // ── Measuring and annotating ────────────────────────────────────────────
  // Both hooks take every dependency as a parameter, so the plan drives the
  // same measure and annotation tools the 2D Section panel does rather than
  // growing its own. Their results live in the store, so a distance measured
  // on the plan is the same object the section panel and the export see.
  const measureHandlers = useMeasure2D({
    drawing, viewTransform: planTransform, setViewTransform, sectionAxis: PLAN_AXIS, containerRef,
    measure2DMode: annotation2DActiveTool === 'measure',
    measure2DStart, measure2DCurrent, measure2DShiftLocked, measure2DLockedAxis,
    setMeasure2DStart, setMeasure2DCurrent, setMeasure2DShiftLocked, setMeasure2DSnapPoint,
    cancelMeasure2D, completeMeasure2D,
  });

  const annotationHandlers = useAnnotation2D({
    drawing, viewTransform: planTransform, sectionAxis: PLAN_AXIS, containerRef,
    activeTool: annotation2DActiveTool, setActiveTool: setAnnotation2DActiveTool,
    polygonArea2DPoints, addPolygonArea2DPoint, completePolygonArea2D, cancelPolygonArea2D,
    textAnnotations2D, addTextAnnotation2D, setTextAnnotation2DEditing,
    cloudAnnotation2DPoints, cloudAnnotations2D, addCloudAnnotation2DPoint,
    completeCloudAnnotation2D, cancelCloudAnnotation2D,
    measure2DResults, polygonArea2DResults,
    selectedAnnotation2D, setSelectedAnnotation2D, deleteSelectedAnnotation2D,
    moveAnnotation2D, setAnnotation2DCursorPos, setMeasure2DSnapPoint,
  });

  // Centre an underlay on the generated drawing. Same derivation the 2D Section
  // panel uses, minus the flip cases a plan cannot be in.
  const updateDxfUnderlayPlacement = useViewerStore((s) => s.updateDxfUnderlayPlacement);
  const centerDxfUnderlay = useCallback((id: string) => {
    const entry = dxfUnderlays.find((u) => u.id === id);
    if (!entry || !drawing) return;
    const bounds = dxfUnderlayDrawingBounds(entry, dxfWorldShift(geometryResult?.coordinateInfo), false);
    if (!bounds) return;
    const modelCx = (drawing.bounds.min.x + drawing.bounds.max.x) / 2;
    const modelCy = (drawing.bounds.min.y + drawing.bounds.max.y) / 2;
    const underlayCx = (bounds.min.x + bounds.max.x) / 2;
    const underlayCy = (bounds.min.y + bounds.max.y) / 2;
    updateDxfUnderlayPlacement(id, { offsetX: modelCx - underlayCx, offsetY: modelCy - underlayCy });
  }, [dxfUnderlays, drawing, geometryResult, updateDxfUnderlayPlacement]);

  // ── Commit a mark to the model ──────────────────────────────────────────
  // The mark STAYS. Committing adds an IfcAnnotation carrying the same
  // geometry; it does not move the mark into the model and take it off the
  // screen. Keeping both is the point — the same note is often wanted as a
  // working scribble first and as a deliverable later, and having to decide up
  // front is what makes markup tools annoying.
  const addAnnotation = useViewerStore((s) => s.addAnnotation);
  const commitSelectedAnnotation = useCallback(() => {
    const sel = selectedAnnotation2D;
    if (!sel || !storey || !storeyModelId) return;

    const asLocal = (p: { x: number; y: number }) => planPointToStoreyLocal(p);
    let geometry: AnnotationGeometry | null = null;
    let name = 'Annotation';

    if (sel.type === 'measure') {
      const m = measure2DResults.find((r) => r.id === sel.id);
      if (m) {
        geometry = { kind: 'polyline', points: [asLocal(m.start), asLocal(m.end)] };
        name = `Mass ${m.distance.toFixed(3)} m`;
      }
    } else if (sel.type === 'polygon') {
      const a = polygonArea2DResults.find((r) => r.id === sel.id);
      if (a && a.points.length >= 3) {
        geometry = { kind: 'polyline', points: a.points.map(asLocal), closed: true };
        name = `Fläche ${a.area.toFixed(2)} m²`;
      }
    } else if (sel.type === 'cloud') {
      const c = cloudAnnotations2D.find((r) => r.id === sel.id);
      if (c && c.points.length >= 2) {
        // Stored as two opposite corners; a rectangle is what the mark means.
        const [p1, p2] = c.points;
        geometry = {
          kind: 'polyline',
          points: [asLocal(p1), asLocal({ x: p2.x, y: p1.y }), asLocal(p2), asLocal({ x: p1.x, y: p2.y })],
          closed: true,
        };
        name = c.label ? `Revision ${c.label}` : 'Revision';
      }
    } else if (sel.type === 'text') {
      const t = textAnnotations2D.find((r) => r.id === sel.id);
      if (t && t.text.trim()) {
        const local = asLocal(t.position);
        // The box is stored in SCREEN pixels; convert through the live zoom so
        // the committed extent is a real size in metres rather than a number
        // that means something only at the zoom it happened to be typed at.
        const heightM = t.fontSize / viewTransform.scale;
        geometry = {
          kind: 'text',
          text: t.text,
          position: [local[0], local[1]],
          width: Math.max(heightM * t.text.length * 0.6, heightM),
          height: heightM,
        };
        name = t.text.slice(0, 60);
      }
    }

    if (!geometry) {
      toast.error('Diese Markierung lässt sich nicht übernehmen.');
      return;
    }

    const result = addAnnotation(storeyModelId, storey.expressId, { geometry, Name: name });
    if ('error' in result) toast.error(`Übernahme fehlgeschlagen: ${result.error}`);
    else toast.success(`Als IfcAnnotation #${result.expressId} übernommen — Markierung bleibt`);
  }, [selectedAnnotation2D, storey, storeyModelId, measure2DResults, polygonArea2DResults,
      cloudAnnotations2D, textAnnotations2D, viewTransform.scale, addAnnotation]);

  const { handleExportSVG, handleExportDXF, handlePrint } = useDrawingExport({
    drawing, displayOptions, sectionPlane, activePresetId,
    entityColorMap, overridesEnabled, overrideEngine,
    measure2DResults, polygonArea2DResults, textAnnotations2D, cloudAnnotations2D,
    // Only what is on screen gets exported: switching the labels off is a
    // statement about the drawing, not about the viewport.
    planLabels: planShowRoomLabels ? planLabels : undefined,
    openingSymbols: planShowOpeningSymbols ? openingSymbols : undefined,
    // A plan is not a sheet. Laying one out on paper is the 2D Section tool's
    // job and stays there, so the export writes the drawing itself.
    sheetEnabled: false, activeSheet: null,
    dxfUnderlays: dxfUnderlayData,
    ifcDataStore, coordinateInfo: geometryResult?.coordinateInfo,
    scanSection: EMPTY_SCAN_SECTION,
    viewRotation: planRotation,
  });

  // Fit when the first drawing of this plan session arrives, and then leave the
  // view alone. Re-armed on the way out so reopening the plan frames it again.
  useEffect(() => {
    if (!active) { hasFittedRef.current = false; return; }
    if (hasFittedRef.current || !drawing || status !== 'ready') return;
    hasFittedRef.current = true;
    fitToView();
  }, [active, drawing, status, fitToView]);

  // ── Turning the plan ────────────────────────────────────────────────────
  // One line, not two. The underlay alignment needs a second line because it
  // solves scale AND rotation AND translation between two different drawings;
  // here there is a single drawing and a single unknown, so the second line
  // would carry one number — and that number is almost always "horizontal".
  // Drawing one line along a wall and letting it snap to the axis it is
  // ALREADY nearer tidies the gesture up instead of overruling it.
  // Click, preview, click — the same rhythm as the underlay alignment, and for
  // the same reason: you see the snapped landing point BEFORE committing it, so
  // you know you set it down where you meant to. A press-drag-release gesture
  // hides that, and on a long wall the two ends are far apart.
  const [rotationStart, setRotationStart] = useState<Point2D | null>(null);
  const [rotationCursor, setRotationCursor] = useState<Point2D | null>(null);
  /** The finished reference line, waiting for its target direction. */
  const [rotationLine, setRotationLine] = useState<{ from: Point2D; to: Point2D } | null>(null);

  /** Snap to model geometry, exactly as the measure tool and the underlay
   *  alignment do — the reference line is only as good as its endpoints. */
  const snapPoint = useCallback((p: Point2D): Point2D => {
    return measureHandlers.findSnapPoint(p) ?? p;
  }, [measureHandlers]);

  /**
   * Lay the finished line onto `targetDeg`.
   *
   * Asked rather than assumed. The nearest axis is offered as the default, but
   * a long edge is very often meant to go the OTHER quarter turn, and silently
   * picking one of the two is the kind of guess that costs more time than the
   * question does.
   */
  const applyRotationTo = useCallback((targetBearingDeg: number) => {
    const line = rotationLine;
    if (!line) return;
    // A BEARING, not a maths angle: 0° is up and it grows clockwise, which is
    // how a direction on a plan is given. The two differ by a quarter turn,
    // and confusing them lays the line ninety degrees from where it was asked
    // to go — which reads as a bug but is a vocabulary mistake.
    const delta = rotationToDirection(line.from, line.to, bearingToAngle(targetBearingDeg * DEG_TO_RAD));
    if (delta === null) {
      toast.error('Zu kurze Linie — bitte entlang einem Bauteil ziehen.');
      return;
    }
    setRotationLine(null);
    setPlanRotationPicking(false);
    setPlanRotation(normalizeAngle(planRotation + delta));
    // "FitToAll danach": turning about the project origin can swing the
    // building well outside the viewport, and a correct plan you cannot see
    // reads exactly like a broken one.
    setTimeout(fitToView, 0);
  }, [rotationLine, planRotation, setPlanRotation, setPlanRotationPicking, fitToView]);

  /** Where the drawn line currently points, in degrees — the readout the
   *  target choice is made against. */
  const rotationLineDeg = useMemo(() => {
    if (!rotationLine) return null;
    const dx = rotationLine.to.x - rotationLine.from.x;
    const dy = rotationLine.to.y - rotationLine.from.y;
    if (Math.hypot(dx, dy) < 1e-9) return null;
    // Reported in the same vocabulary the answer is given in, so the two
    // numbers on screen can be compared without converting between them.
    const onScreen = Math.atan2(dy, dx) + planRotation;
    return normalizeBearing(angleToBearing(onScreen)) * RAD_TO_DEG;
  }, [rotationLine, planRotation]);

  // ── Pan and click ───────────────────────────────────────────────────────
  // Right button pans, matching the 2D Section panel: the left button stays
  // free to pick, which is what this mode is for.
  const panRef = useRef<{ x: number; y: number } | null>(null);
  // A left press is only a click if the cursor barely moved — otherwise it was
  // a drag, and selecting at the release point would be a surprise.
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  // An annotation tool owns the click outright while it is armed: measuring or
  // drawing a cloud is a different gesture from selecting, and letting a
  // selection through underneath would make the result depend on what the
  // cursor happened to be over.
  const annotating = annotation2DActiveTool !== 'none';

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) { panRef.current = { x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 0) return;

    // An armed rotation takes the click outright: while it is running the only
    // meaningful thing to do on the canvas is draw the reference line, and
    // letting a selection through would make the result depend on what the
    // cursor happened to be over.
    if (planRotationPicking) {
      const container = containerRef.current;
      if (!container) return;
      // A line already drawn is waiting for its target angle; ignore clicks on
      // the canvas until that is answered, or the answer would be discarded by
      // the act of reaching for it.
      if (rotationLine) return;
      const rect = container.getBoundingClientRect();
      const p = snapPoint(planScreenToDrawing(e.clientX - rect.left, e.clientY - rect.top, planTransform));
      if (!rotationStart) {
        setRotationStart(p);
        setRotationCursor(p);
      } else {
        setRotationLine({ from: rotationStart, to: p });
        setRotationStart(null);
        setRotationCursor(null);
      }
      return;
    }

    if (annotating) {
      if (annotation2DActiveTool === 'measure') measureHandlers.handleMouseDown(e);
      else annotationHandlers.handleMouseDown(e);
      return;
    }
    // With no tool armed, an existing annotation can still be grabbed and
    // dragged; only if the click misses one does it become a model selection.
    if (annotationHandlers.handleMouseDown(e)) return;
    pressRef.current = { x: e.clientX, y: e.clientY };
  }, [annotating, annotation2DActiveTool, measureHandlers, annotationHandlers, planRotationPicking, planTransform, rotationStart, rotationLine, snapPoint]);

  // Where the cursor is, in drawing units — only tracked while placing, since
  // that is the only thing that needs to redraw on every mouse move.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const from = panRef.current;
    if (from) {
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      panRef.current = { x: e.clientX, y: e.clientY };
      setViewTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      return;
    }
    if (planRotationPicking && !rotationLine) {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // Snapped BEFORE it is shown, so the preview is the point that will
      // actually be taken — the whole reason this is click-preview-click.
      setRotationCursor(snapPoint(planScreenToDrawing(e.clientX - rect.left, e.clientY - rect.top, planTransform)));
      return;
    }
    if (annotationHandlers.isDraggingRef.current) {
      annotationHandlers.handleMouseMove(e);
      return;
    }
    if (annotating) {
      if (annotation2DActiveTool === 'measure') measureHandlers.handleMouseMove(e);
      else annotationHandlers.handleMouseMove(e);
      return;
    }
    if (activeTool !== 'addElement') return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setCursor(planScreenToDrawing(e.clientX - rect.left, e.clientY - rect.top, planTransform));
  }, [setViewTransform, activeTool, planTransform, annotating, annotation2DActiveTool,
      measureHandlers, annotationHandlers, planRotationPicking, rotationLine, snapPoint]);

  // ── Placing ─────────────────────────────────────────────────────────────
  // Straight into the SAME state machine 3D clicks drive, which is why every
  // element type — including the two-click wall and the N-click slab polygon —
  // works here without plan mode knowing any of them exist. It also means a
  // wall started in 3D can be finished in the plan: the pending points live in
  // the store, not in either surface.
  //
  // The storey is overridden to the one being DRAWN rather than the AddElement
  // panel's selector: you are looking at a plan of this floor, so a click
  // belongs to this floor. The same override the smart-placement path uses.
  const placeAt = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container || !storey || !storeyModelId || !cut?.ok) return;
    const rect = container.getBoundingClientRect();
    const point = planScreenToDrawing(clientX - rect.left, clientY - rect.top, planTransform);
    void handleAddElementDrop(
      planPointToRenderer(point, cut.worldY),
      { modelId: storeyModelId, storeyId: storey.expressId },
    );
  }, [storey, storeyModelId, cut, planTransform]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    panRef.current = null;
    // The rotation gesture is click-to-click, so a release does nothing.
    if (planRotationPicking) return;
    if (annotating || annotationHandlers.isDraggingRef.current) {
      if (annotation2DActiveTool === 'measure') measureHandlers.handleMouseUp();
      else annotationHandlers.handleMouseUp(e);
      return;
    }
    const press = pressRef.current;
    pressRef.current = null;
    if (e.button !== 0 || !press) return;
    if (Math.abs(e.clientX - press.x) > CLICK_SLOP_PX) return;
    if (Math.abs(e.clientY - press.y) > CLICK_SLOP_PX) return;
    if (activeTool === 'addElement') {
      placeAt(e.clientX, e.clientY);
      return;
    }
    selectAt(e.clientX, e.clientY, e.ctrlKey || e.metaKey);
  }, [activeTool, placeAt, selectAt, annotating, annotation2DActiveTool,
      measureHandlers, annotationHandlers, planRotationPicking]);

  const handleMouseLeave = useCallback(() => {
    panRef.current = null;
    pressRef.current = null;
    setCursor(null);
    measureHandlers.handleMouseLeave();
  }, [measureHandlers]);

  // ── Placement preview ───────────────────────────────────────────────────
  // Pending points live in the store in the RENDERER frame, so they come back
  // through the same mapping placement went out through — one rule, one place.
  // Without this a two-click wall is invisible until it exists, and the first
  // click looks like it did nothing.
  const placementPreview = useMemo(() => {
    if (activeTool !== 'addElement' || addElementPendingPoints.length === 0) return null;
    const toScreen = (p: { x: number; y: number }) => ({
      x: p.x * viewTransform.scale + viewTransform.x,
      y: p.y * viewTransform.scale + viewTransform.y,
    });
    const placed = addElementPendingPoints.map((p) => toScreen({ x: p.x, y: p.z }));
    return { placed, band: cursor ? toScreen(cursor) : null };
  }, [activeTool, addElementPendingPoints, viewTransform, cursor]);

  // ── Selection, as the canvas wants it ───────────────────────────────────
  // The store selects on GLOBAL ids; the drawing carries local ids plus the
  // model index. This is the same translation the pick does, run backwards, so
  // clicking an element and seeing it light up are the same statement.
  const selectedEntityKeys = useMemo(() => {
    const globalIds = new Set<number>(selectedEntityIds);
    if (selectedEntityId !== null) globalIds.add(selectedEntityId);
    if (globalIds.size === 0) return undefined;

    const keys = new Set<string>();
    for (const globalId of globalIds) {
      const local = fromGlobalIdFromModels(models, globalId);
      if (local) {
        const index = modelIdToIndex?.get(local.modelId) ?? 0;
        keys.add(`${index}:${local.expressId}`);
      } else {
        // Single-model fallback: global id IS the express id, model index 0.
        keys.add(`0:${globalId}`);
      }
    }
    return keys;
  }, [selectedEntityIds, selectedEntityId, models, modelIdToIndex]);

  const hasAnnotations = measure2DResults.length > 0 || polygonArea2DResults.length > 0
    || textAnnotations2D.length > 0 || cloudAnnotations2D.length > 0;

  // A crosshair whenever the task is putting a point exactly somewhere — a
  // pointer promises the wrong gesture. A text tool gets the text cursor.
  const cursorClass =
    activeTool === 'addElement' ? 'cursor-crosshair'
      : annotation2DActiveTool === 'text' ? 'cursor-text'
        : annotation2DActiveTool !== 'none' ? 'cursor-crosshair'
          : selectedAnnotation2D ? 'cursor-move'
            : 'cursor-default';

  if (!active) return null;

  const hasDrawing =
    drawing !== null &&
    (drawing.cutPolygons.length > 0 || (drawing.lines?.length ?? 0) > 0);

  return (
    <div
      className={`absolute inset-0 z-30 bg-white dark:bg-zinc-950 ${cursorClass}`}
      data-plan-view
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={annotationHandlers.handleDoubleClick}
      // The right button pans, so its menu would fire on every pan.
      onContextMenu={(e) => e.preventDefault()}
    >
      {hasDrawing && drawing && (
        <Drawing2DCanvas
          drawing={drawing}
          transform={planTransform}
          showHiddenLines={displayOptions.showHiddenLines}
          overrideEngine={overrideEngine}
          overridesEnabled={overridesEnabled}
          entityColorMap={entityColorMap}
          useIfcMaterials={activePresetId === 'preset-3d-colors'}
          sectionAxis={PLAN_AXIS}
          isPinned
          cachedSheetTransformRef={cachedSheetTransformRef}
          selectedEntityKeys={selectedEntityKeys}
          lensColorKeys={lensColorKeys}
          measureMode={annotation2DActiveTool === 'measure'}
          measureStart={measure2DStart}
          measureCurrent={measure2DCurrent}
          measureResults={measure2DResults}
          measureSnapPoint={measure2DSnapPoint}
          annotation2DActiveTool={annotation2DActiveTool}
          annotation2DCursorPos={annotation2DCursorPos}
          polygonAreaPoints={polygonArea2DPoints}
          polygonAreaResults={polygonArea2DResults}
          textAnnotations={textAnnotations2D}
          textAnnotationEditing={textAnnotation2DEditing}
          cloudAnnotationPoints={cloudAnnotation2DPoints}
          cloudAnnotations={cloudAnnotations2D}
          selectedAnnotation={selectedAnnotation2D}
          ifcAnnotationLines={ifcAnnotationData.lines}
          ifcAnnotationTexts={ifcAnnotationData.texts}
          ifcAnnotationFills={ifcAnnotationData.fills}
          dxfUnderlays={dxfUnderlayData}
        />
      )}

      {/* Door swings and window sashes go UNDER the room labels: both belong
          to the drawing, but a name is read and an arc is looked at, so where
          they collide the text should win. */}
      {planShowOpeningSymbols && (
        <PlanOpeningSymbols symbols={openingSymbols} transform={planTransform} />
      )}

      {/* Room names and areas. Above the drawing and below the tools, which is
          where a reader expects to find them: part of the plan, not part of
          the application. */}
      {planShowRoomLabels && <PlanLabels labels={planLabels} transform={planTransform} />}

      {/* Points already placed, and the rubber band to the cursor. Drawn over
          the canvas rather than into it: it changes on every mouse move, and
          the drawing underneath does not. */}
      {placementPreview && (
        <svg className="absolute inset-0 h-full w-full pointer-events-none" data-plan-placement>
          {placementPreview.band && placementPreview.placed.length > 0 && (
            <line
              x1={placementPreview.placed[placementPreview.placed.length - 1].x}
              y1={placementPreview.placed[placementPreview.placed.length - 1].y}
              x2={placementPreview.band.x}
              y2={placementPreview.band.y}
              stroke="currentColor"
              className="text-sky-500"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}
          {placementPreview.placed.length > 1 && (
            <polyline
              points={placementPreview.placed.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              className="text-sky-500"
              strokeWidth={1}
            />
          )}
          {placementPreview.placed.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={3} className="fill-sky-500" />
          ))}
        </svg>
      )}

      {/* The reference line: the placed point, the snapped preview, and once
          it is finished, the question of where it should go. */}
      {(planRotationPicking && (rotationStart || rotationCursor || rotationLine)) && (() => {
        const toScreen = (p: Point2D) => {
          const sx = p.x * viewTransform.scale;
          const sy = p.y * viewTransform.scale;
          const c = Math.cos(planRotation);
          const sn = Math.sin(planRotation);
          return { x: sx * c - sy * sn + viewTransform.x, y: sx * sn + sy * c + viewTransform.y };
        };
        // Before the FIRST click there is no line yet — only the snap the first
        // point would take. Showing it then is the whole point: you place the
        // start knowing what it caught, instead of finding out afterwards.
        const from = rotationLine ? rotationLine.from : rotationStart;
        const to = rotationLine ? rotationLine.to : rotationCursor;
        const a = from ? toScreen(from) : null;
        const b = to ? toScreen(to) : null;
        return (
          <svg className="absolute inset-0 h-full w-full pointer-events-none">
            {a && b && (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-sky-500"
                    strokeWidth={1.5} strokeDasharray={rotationLine ? undefined : '5 3'} />
            )}
            {a && <circle cx={a.x} cy={a.y} r={3.5} className="fill-sky-500" />}
            {/* The snap marker: a square, so it is distinguishable from the
                placed point at a glance and you can see WHAT it caught. */}
            {b && !rotationLine && (
              <rect x={b.x - 4} y={b.y - 4} width={8} height={8}
                    className="fill-none stroke-sky-500" strokeWidth={1.5} />
            )}
          </svg>
        );
      })()}

      {/* Where should this line go? Asked, not assumed — a long edge is very
          often meant to go the other quarter turn, and guessing costs more
          time than the question does. */}
      {rotationLine && (
        <div className="absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-md border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            Ausrichtlinie liegt bei {rotationLineDeg !== null ? rotationLineDeg.toFixed(2) : '—'}° — wohin damit?
            <span className="ml-1 opacity-70">(0° = oben, im Uhrzeigersinn)</span>
          </div>
          <div className="flex items-center gap-1">
            {[0, 90, 180, 270].map((deg) => (
              <Button key={deg} variant="outline" size="sm" className="h-7 px-2 text-[11px]"
                      onClick={() => applyRotationTo(deg)}>
                {deg}°
              </Button>
            ))}
            <input
              type="number" step={0.5} placeholder="frei"
              className="h-7 w-16 rounded-sm border bg-transparent px-1 text-[11px] tabular-nums"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const v = Number.parseFloat((e.target as HTMLInputElement).value);
                if (Number.isFinite(v)) applyRotationTo(v);
              }}
              title="Zielrichtung in Grad, mit Enter bestätigen"
            />
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]"
                    onClick={() => { setRotationLine(null); setPlanRotationPicking(false); }}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {/* Model origins. The 3D view draws a triad here; a plan has no third
          axis to show, so it gets the two it does have — the cross reads as
          "this is a point AND these are its directions", which is the whole
          reason to look at it. Viewer x/z map straight onto the drawing's
          x/y, the same mapping picking and placing use. */}
      {modelOrigins.length > 0 && (
        <svg className="absolute inset-0 h-full w-full pointer-events-none" data-plan-origins>
          {modelOrigins.map((o) => {
            const sx = o.viewer.x * viewTransform.scale;
            const sy = o.viewer.z * viewTransform.scale;
            const c = Math.cos(planRotation);
            const sn = Math.sin(planRotation);
            const x = sx * c - sy * sn + viewTransform.x;
            const y = sx * sn + sy * c + viewTransform.y;
            // The axes turn with the plan; the LABEL does not, so it stays
            // readable — same rule the rest of the text follows.
            const ax = 18 * c, ay = 18 * sn;      // +X on screen
            const bx = -18 * sn, by = 18 * c;     // +Z on screen
            return (
              <g key={o.modelId}>
                <line x1={x} y1={y} x2={x + ax} y2={y + ay} stroke="#dc2626" strokeWidth={1.5} />
                <line x1={x} y1={y} x2={x + bx} y2={y + by} stroke="#2563eb" strokeWidth={1.5} />
                <circle cx={x} cy={y} r={3} fill="#ffffff" stroke="#111827" strokeWidth={1.5} />
                <text x={x + 6} y={y - 6} className="fill-zinc-700 text-[10px]">{o.modelName}</text>
              </g>
            );
          })}
        </svg>
      )}

      {/* North, and the tool that sets it — in the ViewCube's corner. The
          building has a cube there because it can be turned in three axes; a
          plan has one angle, so it gets the one thing that shows it. */}
      <PlanNorthArrow
        rotation={planRotation}
        picking={planRotationPicking}
        onTogglePicking={() => {
          // Always start from a clean gesture: a half-drawn line left over
          // from last time would make the next click finish somebody else's
          // line.
          setRotationStart(null);
          setRotationCursor(null);
          setRotationLine(null);
          setPlanRotationPicking(!planRotationPicking);
        }}
        onSetRotationDeg={(deg) => {
          setPlanRotation(normalizeAngle(deg * DEG_TO_RAD));
          setTimeout(fitToView, 0);
        }}
      />

      {/* How long a metre is, where the building keeps the same answer. */}
      <PlanScaleBar pixelsPerMetre={viewTransform.scale} />

      {/* Tools along the top edge, where #50 asks for them. The strip brings
          its own positioning now, so that the building's strip can be given
          the same one. */}
      <PlanToolbar
          displayOptions={displayOptions}
          onToggleSymbolic={() => {
            // Clearing the drawing makes the switch visible immediately: the
            // two representations differ enough that keeping the old one on
            // screen during the rebuild reads as the toggle not working.
            setDrawing(null);
            setStatus('idle');
            updateDisplayOptions({ useSymbolicRepresentations: !displayOptions.useSymbolicRepresentations });
          }}
          onToggleIfcAnnotations={() => updateDisplayOptions({ showIfcAnnotations: !displayOptions.showIfcAnnotations })}
          onToggleConstructionProjection={() => updateDisplayOptions({ showConstructionProjection: !displayOptions.showConstructionProjection })}
          showRoomLabels={planShowRoomLabels}
          onToggleRoomLabels={() => setPlanShowRoomLabels(!planShowRoomLabels)}
          roomCount={planLabels.length}
          showOpeningSymbols={planShowOpeningSymbols}
          onToggleOpeningSymbols={() => setPlanShowOpeningSymbols(!planShowOpeningSymbols)}
          openingCount={openingSymbols.length}
          assumedLinings={assumedLinings}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((v) => !v)}
          dxfOpen={dxfPanelOpen}
          onToggleDxf={() => setDxfPanelOpen((v) => !v)}
          activeTool={annotation2DActiveTool}
          onSetTool={setAnnotation2DActiveTool}
          hasAnnotations={hasAnnotations}
          canCommitAnnotation={selectedAnnotation2D !== null}
          onCommitAnnotation={commitSelectedAnnotation}
          onClearAnnotations={() => { clearAllAnnotations2D(); clearMeasure2DResults(); }}
          zoomPercent={viewTransform.scale * 100}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFitToView={fitToView}
          onExportSVG={handleExportSVG}
          onExportDXF={handleExportDXF}
          onPrint={handlePrint}
          onRegenerate={() => void doRegenerate()}
          busy={isRegenerating || status === 'generating'}
        >
          {/* Which floor, and where it is cut — the two things that make this a
              plan rather than a section, so they sit inside the strip. */}
          <span className="pl-1 text-[10px] text-muted-foreground">Geschoss</span>
          <select
            className="h-6 rounded-sm border bg-transparent px-1 text-[11px]"
            value={storey ? String(storey.expressId) : ''}
            disabled={storeys.length === 0}
            onChange={(e) => {
              // Through the same transition every other storey entry point
              // uses, so the hierarchy, the storey tabs and the plan can never
              // disagree about which floor is in scope.
              const expressId = Number.parseInt(e.target.value, 10);
              if (storeyModelId && Number.isFinite(expressId)) {
                applyLevelDisplayMode('solo', { modelId: storeyModelId, expressId });
              }
            }}
          >
            {storeys.length === 0 && <option value="">— keine Geschosse —</option>}
            {storeys.map((s) => (
              <option key={s.expressId} value={String(s.expressId)}>
                {s.name}
                {s.elevation !== null ? ` · ${s.elevation.toFixed(3)} m` : ''}
              </option>
            ))}
          </select>
          <span className="pl-1 text-[10px] text-muted-foreground">Schnitt</span>
          <input
            type="number"
            step={0.05}
            min={0}
            value={planCutHeight}
            onChange={(e) => {
              const v = Number.parseFloat(e.target.value);
              if (Number.isFinite(v)) setPlanCutHeight(v);
            }}
            className="h-6 w-16 rounded-sm border bg-transparent px-1 text-[11px] tabular-nums"
            title="Schnitthöhe über Geschossboden, in Metern"
          />
          <span className="text-[10px] text-muted-foreground">m</span>
      </PlanToolbar>

      {/* Both panels are `h-full` and bring no positioning of their own, so
          they need a sized, positioned host or they collapse to nothing. */}
      {settingsOpen && (
        <div className="absolute top-0 right-0 bottom-0 w-72 z-50 shadow-xl">
          <DrawingSettingsPanel onClose={() => setSettingsOpen(false)} />
        </div>
      )}
      {dxfPanelOpen && (
        <div className="absolute top-0 right-0 bottom-0 w-80 z-50 shadow-xl">
          <DxfUnderlayPanel
            onClose={() => setDxfPanelOpen(false)}
            onCenterOnModel={centerDxfUnderlay}
            // A plan IS the cardinal plan view the underlays are for, always.
            planViewActive
          />
        </div>
      )}

      {/* Text editor for a box being typed into, positioned over its anchor.
          A plan is the 'down' axis, where both screen axes take the same
          positive scale — no flips. */}
      {textAnnotation2DEditing && (() => {
        const editing = textAnnotations2D.find((a) => a.id === textAnnotation2DEditing);
        if (!editing) return null;
        return (
          <TextAnnotationEditor
            annotation={editing}
            screenX={editing.position.x * viewTransform.scale + viewTransform.x}
            screenY={editing.position.y * viewTransform.scale + viewTransform.y}
            onConfirm={(id, text) => {
              updateTextAnnotation2D(id, { text });
              setTextAnnotation2DEditing(null);
            }}
            onCancel={(id) => {
              // An empty box was just created and never filled in; keeping it
              // would leave an invisible thing to click on.
              const a = textAnnotations2D.find((t) => t.id === id);
              if (a && !a.text.trim()) removeTextAnnotation2D(id);
              setTextAnnotation2DEditing(null);
            }}
          />
        );
      })()}

      {status === 'generating' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 pointer-events-none">
          <Loader2 className="h-8 w-8 animate-spin mb-3 text-primary" />
          <div className="text-sm font-medium">{progressPhase}</div>
          <div className="text-xs text-muted-foreground mt-1">{Math.round(progress)}%</div>
        </div>
      )}

      {/* Every reason there is nothing to show is NAMED. A blank white plan is
          indistinguishable from a broken one, and each of these is fixed by a
          different action. */}
      {status !== 'generating' && !hasDrawing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="max-w-sm text-center text-sm text-muted-foreground px-6">
            {status === 'error'
              ? `Der Grundriss liess sich nicht erzeugen: ${error ?? 'unbekannter Grund'}`
              : storeys.length === 0
                ? models.size > 1
                  ? 'Der Grundriss zeigt vorerst ein Modell auf einmal.'
                  : 'Aus diesem Modell liessen sich keine Geschosse mit Geometrie lesen.'
                : cut && !cut.ok
                  ? cut.reason === 'above-model'
                    ? `Der Schnitt bei ${planCutHeight.toFixed(2)} m über «${storey?.name}» liegt über dem Modell.`
                    : cut.reason === 'below-model'
                      ? `Der Schnitt bei ${planCutHeight.toFixed(2)} m über «${storey?.name}» liegt unter dem Modell.`
                      : 'Dieses Modell hat keine räumliche Ausdehnung.'
                  : `Auf «${storey?.name}» liegt auf Schnitthöhe nichts.`}
          </div>
        </div>
      )}
    </div>
  );
}

export default PlanView;
