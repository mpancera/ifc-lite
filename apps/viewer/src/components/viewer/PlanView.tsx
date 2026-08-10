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

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Loader2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { GraphicOverrideEngine, type Drawing2D } from '@ifc-lite/drawing-2d';
import type { GeometryResult } from '@ifc-lite/geometry';
import { Drawing2DCanvas } from './Drawing2DCanvas';
import { useDrawingGeneration } from '@/hooks/useDrawingGeneration';
import { useViewControls } from '@/hooks/useViewControls';
import { useCombinedVisibilityIds } from '@/hooks/useCombinedVisibilityIds';
import { planStoreys, defaultPlanStorey, planCut, type PlanStorey } from '@/lib/plan/planCut';
import { pickInPlan, planScreenToDrawing } from '@/lib/plan/planPick';
import { toGlobalIdFromModels } from '@/store/globalId';
import { resolveEntityRef } from '@/store/resolveEntityRef';

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

/**
 * Display options for a plan, fixed rather than exposed.
 *
 * A plan is a cut, so the symbolic representations that stand in FOR a cut are
 * off; hidden lines are off because a plan shows what is below the cut through
 * the projection, not through dashed occlusion; the construction projection is
 * on because it is what puts the floor under the cut and is most of the reason
 * the result reads as a drawing. `show3DOverlay` is off: this surface is not
 * decorating the 3D scene.
 */
const PLAN_DISPLAY_OPTIONS = {
  showHiddenLines: false,
  useSymbolicRepresentations: false,
  show3DOverlay: false,
  scale: 100,
  showConstructionProjection: true,
} as const;

/** The plan is always a horizontal cut. */
const PLAN_AXIS = 'down' as const;

export function PlanView({
  mergedGeometry,
  computedIsolatedIds,
  modelIdToIndex,
}: PlanViewProps): React.ReactElement | null {
  const viewMode = useViewerStore((s) => s.viewMode);
  const planStoreyId = useViewerStore((s) => s.planStoreyId);
  const setPlanStorey = useViewerStore((s) => s.setPlanStorey);
  const planCutHeight = useViewerStore((s) => s.planCutHeight);
  const models = useViewerStore((s) => s.models);
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

  // ── The storeys this model can be cut at ────────────────────────────────
  // Single-model only: `elementToStorey` keys are LOCAL express ids, so on a
  // federation they would collide with another model's mesh ids and derive
  // floors for the wrong building. Federated plan mode is its own problem.
  const storeys = useMemo((): PlanStorey[] => {
    const single = models.size === 1 ? [...models.values()][0]?.ifcDataStore : null;
    const dataStore = (single ?? (models.size === 0 ? ifcDataStore : null)) as
      | { spatialHierarchy?: { elementToStorey: Map<number, number>; storeyElevations: Map<number, number>; byStorey: Map<number, number[]> }; entities?: { getName(id: number): string | undefined } }
      | null
      | undefined;
    const sh = dataStore?.spatialHierarchy;
    if (!sh || !geometryResult?.meshes) return [];

    const names = new Map<number, string>();
    for (const storeyId of sh.byStorey.keys()) {
      const name = dataStore?.entities?.getName(storeyId);
      if (name) names.set(storeyId, name);
    }
    return planStoreys(geometryResult.meshes, {
      names,
      elevations: sh.storeyElevations,
      elementToStorey: sh.elementToStorey,
    });
  }, [models, ifcDataStore, geometryResult]);

  // The chosen storey, or the default. Resolving rather than writing state on
  // mount keeps this render-pure; the picker writes the choice when made.
  const storey = useMemo(() => {
    if (planStoreyId !== null) {
      const chosen = storeys.find((s) => String(s.expressId) === planStoreyId);
      if (chosen) return chosen;
      // A stale id (model swapped) falls through to the default rather than
      // showing nothing, which would look like a model with no storeys.
    }
    return defaultPlanStorey(storeys);
  }, [planStoreyId, storeys]);

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

  useDrawingGeneration({
    geometryResult,
    ifcDataStore,
    sectionPlane,
    displayOptions: PLAN_DISPLAY_OPTIONS,
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
  });

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
    const point = planScreenToDrawing(clientX - rect.left, clientY - rect.top, viewTransform);
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
  }, [drawing, viewTransform, indexToModelId]);

  // ── Pan and click ───────────────────────────────────────────────────────
  // Right button pans, matching the 2D Section panel: the left button stays
  // free to pick, which is what this mode is for.
  const panRef = useRef<{ x: number; y: number } | null>(null);
  // A left press is only a click if the cursor barely moved — otherwise it was
  // a drag, and selecting at the release point would be a surprise.
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) panRef.current = { x: e.clientX, y: e.clientY };
    if (e.button === 0) pressRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const from = panRef.current;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    panRef.current = { x: e.clientX, y: e.clientY };
    setViewTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, [setViewTransform]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    panRef.current = null;
    const press = pressRef.current;
    pressRef.current = null;
    if (e.button !== 0 || !press) return;
    if (Math.abs(e.clientX - press.x) > CLICK_SLOP_PX) return;
    if (Math.abs(e.clientY - press.y) > CLICK_SLOP_PX) return;
    selectAt(e.clientX, e.clientY, e.ctrlKey || e.metaKey);
  }, [selectAt]);

  const handleMouseLeave = useCallback(() => {
    panRef.current = null;
    pressRef.current = null;
  }, []);

  const overrideEngine = useMemo(() => new GraphicOverrideEngine([]), []);
  const emptyColorMap = useMemo(() => new Map<number, [number, number, number, number]>(), []);

  if (!active) return null;

  const hasDrawing =
    drawing !== null &&
    (drawing.cutPolygons.length > 0 || (drawing.lines?.length ?? 0) > 0);

  return (
    <div
      className="absolute inset-0 z-30 bg-white dark:bg-zinc-950 cursor-default"
      data-plan-view
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      // The right button pans, so its menu would fire on every pan.
      onContextMenu={(e) => e.preventDefault()}
    >
      {hasDrawing && drawing && (
        <Drawing2DCanvas
          drawing={drawing}
          transform={viewTransform}
          showHiddenLines={PLAN_DISPLAY_OPTIONS.showHiddenLines}
          overrideEngine={overrideEngine}
          overridesEnabled={false}
          entityColorMap={emptyColorMap}
          useIfcMaterials={false}
          sectionAxis={PLAN_AXIS}
          isPinned
          cachedSheetTransformRef={cachedSheetTransformRef}
        />
      )}

      {/* Controls along the top edge, where #50 asks for them. */}
      <div className="absolute top-2 left-2 right-2 flex items-center gap-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-md border bg-background/90 backdrop-blur-sm px-2 py-1 shadow-sm">
          <span className="text-[10px] text-muted-foreground">Geschoss</span>
          <select
            className="h-6 rounded-sm border bg-transparent px-1 text-[11px]"
            value={storey ? String(storey.expressId) : ''}
            disabled={storeys.length === 0}
            onChange={(e) => setPlanStorey(e.target.value || null)}
          >
            {storeys.length === 0 && <option value="">— keine Geschosse —</option>}
            {storeys.map((s) => (
              <option key={s.expressId} value={String(s.expressId)}>
                {s.name}
                {s.elevation !== null ? ` · ${s.elevation.toFixed(3)} m` : ''}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground pl-1">Schnitt</span>
          <span className="text-[11px] tabular-nums">{planCutHeight.toFixed(2)} m</span>
        </div>

        <div className="pointer-events-auto ml-auto flex items-center gap-0.5 rounded-md border bg-background/90 backdrop-blur-sm px-1 py-0.5 shadow-sm">
          <span className="px-1 text-[10px] text-muted-foreground tabular-nums">
            {Math.round(viewTransform.scale * 100)}%
          </span>
          <Button variant="ghost" size="icon-sm" onClick={zoomOut} title="Verkleinern">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={zoomIn} title="Vergrössern">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={fitToView} title="Einpassen">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

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
