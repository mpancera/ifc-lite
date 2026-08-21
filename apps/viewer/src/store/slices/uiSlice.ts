/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * UI state slice
 */

import type { StateCreator } from 'zustand';
import {
  HIERARCHY_MODE_STORAGE_KEY,
  TOOLBAR_STYLE_STORAGE_KEY,
  RIBBON_COLLAPSED_STORAGE_KEY,
  RIBBON_CONTEXTUAL_TABS_STORAGE_KEY,
  UI_DEFAULTS,
  type RibbonTabId,
  type ToolbarStyle,
} from '../constants.js';
import {
  createGeometryLoadSettings,
  geometryLoadSettingsInitialState,
  type GeometryLoadSettingsActions,
  type GeometryLoadSettingsState,
} from './geometryLoadSettings.js';
import type { ContactShadingQuality, SeparationLinesQuality } from '@ifc-lite/renderer';
import type { FederatedModel } from '../types.js';
import type { GeometryResult } from '@ifc-lite/geometry';
import type { CesiumPlacementDraft } from './cesiumSlice.js';

export type ThemeMode = 'light' | 'dark' | 'colorful';
export type { GeometryReloadReason } from './geometryLoadSettings.js';

export type HierarchyMode = 'spatial' | 'type' | 'ifc-type' | 'material' | 'groups';

function getInitialHierarchyMode(): HierarchyMode {
  if (typeof window === 'undefined') return 'spatial';
  try {
    const stored = localStorage.getItem(HIERARCHY_MODE_STORAGE_KEY);
    if (stored === 'spatial' || stored === 'type' || stored === 'ifc-type' || stored === 'material' || stored === 'groups') {
      return stored;
    }
  } catch (err) {
    console.warn('[hierarchy-mode] storage unavailable; using spatial', err);
  }
  return 'spatial';
}

/**
 * One-shot target for "jump to a property and edit it" flows (issue #1107).
 * Armed when a property is added from the bSDD card, consumed by the
 * Properties panel once the user arrives on the Properties tab — it scrolls
 * the row into view, highlights it and enters edit mode, then clears itself.
 * Identified by the same (raw) modelId + expressId the selection carries, so
 * a stale focus left over from a different entity is simply never matched.
 */
export interface PropertyFocusTarget {
  modelId: string;
  entityId: number;
  psetName: string;
  propName: string;
}

/**
 * Tools that require edit mode to function. Entering one of them
 * flips `editEnabled` on; leaving edit mode forces these tools
 * back to `'select'`. Keep the list in sync — duplicating the
 * authoring-tool check between `setActiveTool` and
 * `setEditEnabled` is how the two states drift apart in the
 * "enter edit, switch tool, exit edit" flow.
 */
const AUTHORING_TOOLS: ReadonlySet<string> = new Set([
  'addElement',
  'cesium-placement',
  'split',
  'spaceSketch',
  'zonePaint',
]);

/**
 * Cross-slice surface UISlice reaches into via the combined Zustand
 * `get()` to decide whether toggling a load-time setting needs a
 * reload (only meaningful while a model is in scope).
 */
export interface UICrossSliceState {
  models: Map<string, FederatedModel>;
  geometryResult: GeometryResult | null;
  /**
   * Cesium placement draft state owned by `CesiumSlice`. UISlice
   * reaches in to clear it when global edit mode flips off, so that
   * "exit edit" really exits everything (the placement editor, the
   * draft values, the active tool) in a single atomic update.
   */
  cesiumPlacementEditMode: boolean;
  cesiumPlacementDraftModelId: string | null;
  cesiumPlacementDraft: CesiumPlacementDraft | null;
}

export interface UISlice extends GeometryLoadSettingsState, GeometryLoadSettingsActions {
  // State
  /**
   * Bumped whenever something asks for the pending-changes review to open.
   *
   * A counter rather than a boolean: the review owns its own open/closed state
   * (it can be dismissed), and a flag would have to be reset by whoever raised
   * it — two owners for one truth. Each increment is one request, and a
   * request that arrives while the review is already open changes nothing.
   */
  changesReviewRequests: number;
  /** Ask the pending-changes review to open — see `changesReviewRequests`. */
  requestChangesReview: () => void;
  /**
   * "Bring this element into view in the plan", as a request rather than a
   * state.
   *
   * A counter and an id, the same shape as the review request above and for
   * the same reason: the plan owns its own transform, and a list on the side
   * can only ASK. Panning on every selection change instead would yank the
   * drawing whenever anything anywhere selected something.
   */
  planFocusRequest: {
    readonly globalId: number;
    readonly seq: number;
    /**
     * Where to centre, in drawing coordinates, when the caller knows.
     *
     * Without it the plan looks the element up in the DRAWING, which only
     * finds what the cut passed through. A caller that measured the element
     * itself — the space graph knows every door's centre — can say so and be
     * right for the ones the cut missed.
     */
    readonly point?: { readonly x: number; readonly y: number };
    /**
     * Fit the whole drawing to the window instead of centring on one element.
     *
     * Same request because it is the same thing to a reader — "put that where
     * I can see it" — and because two mechanisms racing for the same transform
     * is how a view ends up half panned and half fitted.
     */
    readonly fit?: boolean;
    /**
     * Multiply the plan's scale by this, about the middle of the window.
     *
     * A fit is idempotent — the plan already fits itself when a drawing
     * arrives — so "show me that closer" cannot be expressed as one. Same
     * request as the others because all three end in the same transform.
     */
    readonly zoom?: number;
  } | null;
  /** Centre the plan on this element, keeping the current zoom. */
  requestPlanFocus: (globalId: number, point?: { x: number; y: number }) => void;
  /** Fit the whole drawing to the plan window. */
  requestPlanFit: () => void;
  /** Multiply the plan's zoom by `factor`, about the middle of the window. */
  requestPlanZoom: (factor: number) => void;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  /**
   * Height of the bottom strip in pixels — Lists, Graph, Gantt, Script.
   *
   * Here rather than in the layout component because the drag handle is not
   * the only thing that should be able to set it: a table of five rows and a
   * chain graph both need more than the default before they are readable, and
   * a screenflow that opens one has to be able to make room for it. The
   * component still clamps to its own minimum and maximum — this is a request,
   * not an override.
   */
  bottomPanelHeight: number;
  /**
   * Draw a small XYZ triad on the selected element.
   *
   * The highlight answers "which one" and stops there. Where the interesting
   * elements are 15 cm devices on a ceiling that is not enough — a highlighted
   * detector two rooms away and one behind a wall look the same, and neither
   * says which way it is turned.
   */
  showSelectionOrigin: boolean;
  /**
   * Bumped every time the plan re-frames itself — a fit, from the toolbar, a
   * request, or the automatic one after a regenerate.
   *
   * The transform itself deliberately does NOT live in the store: it changes
   * on every wheel tick and every drag frame, and only an overlay reads it.
   * But "the paper was re-framed" is a rare event, and it has to be a store
   * fact for anything to be able to WAIT for it — a watcher subscribes to the
   * store, so a change it cannot see is a change it never learns about.
   */
  planFitVersion: number;
  /**
   * Issue the plan as this format. Consumed once and cleared by the plan.
   *
   * The three writers live inside `useDrawingExport`, which is React and reads
   * a dozen pieces of the plan's own state — what is on screen IS the drawing,
   * and a second caller assembling that state elsewhere would export something
   * else. So the request goes in and the plan answers it.
   */
  planExportRequested: 'pdf' | 'svg' | 'dxf' | null;
  activeTool: string;
  /**
   * The room whose outline is being dragged, as `modelId:expressId`.
   *
   * Its own mode rather than a consequence of "a room is selected in edit
   * mode": the handles take the pointer and the draft outline is drawn over
   * the room, so it has to be something entered on purpose and left on
   * purpose. Started from the element's own geometry section, finished with
   * Enter or the tick where the button was.
   */
  roomShapeEditKey: string | null;
  /**
   * Bumped to ask the open outline editor to WRITE what it has.
   *
   * The draft lives in the editor component, because that is where the pointer
   * is. The button that finishes the mode lives in the properties panel, on the
   * other side of the tree — so it asks, rather than reaching in. Without this
   * the button could only END the mode, which is exactly what it did: it looked
   * like a commit and silently threw the reshape away.
   */
  roomShapeCommitTick: number;
  /**
   * Global edit mode. When `true`, all in-place editing affordances
   * (inline property/attribute editors, future geometry manipulators,
   * georeference placement, the add-element draw tools) are unlocked.
   * When `false` the viewer is strictly read-only — this is the
   * default. The toggle is surfaced as a single pill in the main
   * toolbar so the user has one switch for "am I editing anything?"
   * rather than per-panel toggles.
   */
  editEnabled: boolean;
  /**
   * Space Sketch tool minimized to a small reopen pill. Set when the user
   * clicks into the 3D scene while the tool is open, so the panel gets out of
   * the way for inspection without discarding the draft (the overlay stays
   * mounted — only its panel is visually collapsed). Reset to false on any
   * tool change so reopening the tool always starts expanded.
   */
  spaceSketchMinimized: boolean;
  /** Active tab in the Properties panel. Controlled so in-app flows (e.g.
   *  adding a bSDD property) can jump back to "properties" — issue #1107. */
  propertiesActiveTab: 'properties' | 'quantities' | 'bsdd' | 'raw-step';
  /** Active grouping tab shared by the Hierarchy panel and Ribbon. */
  hierarchyMode: HierarchyMode;
  /** One-shot "scroll to + highlight + edit this property" request, armed by
   *  the bSDD add flow and consumed by the Properties panel. Null when idle. */
  pendingPropertyFocus: PropertyFocusTarget | null;
  theme: ThemeMode;
  isMobile: boolean;
  hoverTooltipsEnabled: boolean;
  visualEnhancementsEnabled: boolean;
  edgeContrastEnabled: boolean;
  edgeContrastIntensity: number;
  contactShadingQuality: ContactShadingQuality;
  contactShadingIntensity: number;
  contactShadingRadius: number;
  separationLinesEnabled: boolean;
  separationLinesQuality: SeparationLinesQuality;
  separationLinesIntensity: number;
  separationLinesRadius: number;
  /**
   * Desktop toolbar style (issue #1686): the tabbed, IFCFlux-style
   * `ribbon` (the default) or the original `classic` strip. Persisted
   * preference — the mobile toolbar is orthogonal (`isMobile` wins on
   * small screens).
   */
  toolbarStyle: ToolbarStyle;
  /** Ribbon collapsed to its tab strip (Office-style double-click). */
  ribbonCollapsed: boolean;
  /**
   * Ribbon tab showing in the band. Lives in the store rather than the
   * component so non-React drivers (the ribbon walkthrough, the command
   * palette) can open a tab; deliberately NOT persisted, so every session
   * still starts on Home.
   */
  ribbonTab: RibbonTabId;
  /**
   * Ribbon tabs follow the working context: a selection opens Elements,
   * edit mode opens Author, an empty scene opens File, and dropping the
   * context returns the user to the tab they came from. Persisted opt-out.
   */
  ribbonContextualTabs: boolean;

  // Actions
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setBottomPanelHeight: (height: number) => void;
  setShowSelectionOrigin: (show: boolean) => void;
  notePlanFitted: () => void;
  requestPlanExport: (format: 'pdf' | 'svg' | 'dxf' | null) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setActiveTool: (tool: string) => void;
  /** Enter the room-outline mode for one room. */
  beginRoomShapeEdit: (modelId: string, expressId: number) => void;
  /** Leave it — from the tick, from Enter, or when the selection moves on. */
  endRoomShapeEdit: () => void;
  /** Ask the open editor to commit. It ends the mode itself once written. */
  requestRoomShapeCommit: () => void;
  /** Collapse the Space Sketch panel to a reopen pill (or restore it). */
  setSpaceSketchMinimized: (minimized: boolean) => void;
  setEditEnabled: (enabled: boolean) => void;
  toggleEditEnabled: () => void;
  setPropertiesActiveTab: (tab: 'properties' | 'quantities' | 'bsdd' | 'raw-step') => void;
  setHierarchyMode: (mode: HierarchyMode) => void;
  /** Arm (or clear, with null) the one-shot property-focus request. */
  setPendingPropertyFocus: (focus: PropertyFocusTarget | null) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  /** Shift+click secret: toggle colorful mode on/off */
  toggleColorful: () => void;
  setIsMobile: (isMobile: boolean) => void;
  toggleHoverTooltips: () => void;
  setVisualEnhancementsEnabled: (enabled: boolean) => void;
  setEdgeContrastEnabled: (enabled: boolean) => void;
  setEdgeContrastIntensity: (intensity: number) => void;
  setContactShadingQuality: (quality: ContactShadingQuality) => void;
  setContactShadingIntensity: (intensity: number) => void;
  setContactShadingRadius: (radius: number) => void;
  setSeparationLinesEnabled: (enabled: boolean) => void;
  setSeparationLinesQuality: (quality: SeparationLinesQuality) => void;
  setSeparationLinesIntensity: (intensity: number) => void;
  setSeparationLinesRadius: (radius: number) => void;
  /** Switch the desktop toolbar style and persist the choice. */
  setToolbarStyle: (style: ToolbarStyle) => void;
  /** Collapse/expand the ribbon band and persist the choice. */
  setRibbonCollapsed: (collapsed: boolean) => void;
  /** Open a ribbon tab (session-local). */
  setRibbonTab: (tab: RibbonTabId) => void;
  /** Turn contextual tab following on/off and persist the choice. */
  setRibbonContextualTabs: (enabled: boolean) => void;
}

/** Apply the correct CSS classes on <html> for the given theme */
function applyThemeClasses(theme: ThemeMode) {
  const el = document.documentElement;
  el.classList.toggle('dark', theme === 'dark');
  el.classList.toggle('colorful', theme === 'colorful');
}

/**
 * Returns true when any geometry is loaded — federated model map has
 * entries OR the legacy single-model `geometryResult` is non-null with
 * at least one mesh. Centralised here so the merge-layers toggle has
 * a single source of truth for "is a model loaded?".
 */
function hasLoadedModel(state: UICrossSliceState): boolean {
  if (state.models.size > 0) return true;
  return (state.geometryResult?.meshes.length ?? 0) > 0;
}

export const createUISlice: StateCreator<UISlice & UICrossSliceState, [], [], UISlice> = (set, get) => ({
  ...geometryLoadSettingsInitialState,
  ...createGeometryLoadSettings(set, get, () => hasLoadedModel(get())),
  // Initial state
  changesReviewRequests: 0,
  requestChangesReview: () => set((state) => ({
    changesReviewRequests: state.changesReviewRequests + 1,
  })),
  planFocusRequest: null,
  requestPlanFocus: (globalId, point) => set((state) => ({
    planFocusRequest: { globalId, point, seq: (state.planFocusRequest?.seq ?? 0) + 1 },
  })),
  requestPlanFit: () => set((state) => ({
    planFocusRequest: { globalId: 0, fit: true, seq: (state.planFocusRequest?.seq ?? 0) + 1 },
  })),
  requestPlanZoom: (zoom) => set((state) => ({
    planFocusRequest: { globalId: 0, zoom, seq: (state.planFocusRequest?.seq ?? 0) + 1 },
  })),
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  bottomPanelHeight: 300,
  showSelectionOrigin: false,
  planFitVersion: 0,
  planExportRequested: null,
  activeTool: UI_DEFAULTS.ACTIVE_TOOL,
  roomShapeEditKey: null,
  roomShapeCommitTick: 0,
  editEnabled: false,
  spaceSketchMinimized: false,
  propertiesActiveTab: 'properties',
  hierarchyMode: getInitialHierarchyMode(),
  pendingPropertyFocus: null,
  theme: UI_DEFAULTS.THEME,
  isMobile: false,
  hoverTooltipsEnabled: UI_DEFAULTS.HOVER_TOOLTIPS_ENABLED,
  visualEnhancementsEnabled: UI_DEFAULTS.VISUAL_ENHANCEMENTS_ENABLED,
  edgeContrastEnabled: UI_DEFAULTS.EDGE_CONTRAST_ENABLED,
  edgeContrastIntensity: UI_DEFAULTS.EDGE_CONTRAST_INTENSITY,
  contactShadingQuality: UI_DEFAULTS.CONTACT_SHADING_QUALITY,
  contactShadingIntensity: UI_DEFAULTS.CONTACT_SHADING_INTENSITY,
  contactShadingRadius: UI_DEFAULTS.CONTACT_SHADING_RADIUS,
  separationLinesEnabled: UI_DEFAULTS.SEPARATION_LINES_ENABLED,
  separationLinesQuality: UI_DEFAULTS.SEPARATION_LINES_QUALITY,
  separationLinesIntensity: UI_DEFAULTS.SEPARATION_LINES_INTENSITY,
  separationLinesRadius: UI_DEFAULTS.SEPARATION_LINES_RADIUS,
  toolbarStyle: UI_DEFAULTS.TOOLBAR_STYLE,
  ribbonCollapsed: UI_DEFAULTS.RIBBON_COLLAPSED,
  ribbonTab: UI_DEFAULTS.RIBBON_TAB,
  ribbonContextualTabs: UI_DEFAULTS.RIBBON_CONTEXTUAL_TABS,

  // Actions
  setLeftPanelCollapsed: (leftPanelCollapsed) => set({ leftPanelCollapsed }),
  setRightPanelCollapsed: (rightPanelCollapsed) => set({ rightPanelCollapsed }),
  setBottomPanelHeight: (bottomPanelHeight) => set({ bottomPanelHeight }),
  setShowSelectionOrigin: (showSelectionOrigin) => set({ showSelectionOrigin }),
  notePlanFitted: () => set((state) => ({ planFitVersion: state.planFitVersion + 1 })),
  requestPlanExport: (planExportRequested) => set({ planExportRequested }),
  beginRoomShapeEdit: (modelId, expressId) => set({
    roomShapeEditKey: `${modelId}:${expressId}`,
  }),
  endRoomShapeEdit: () => set({ roomShapeEditKey: null }),
  requestRoomShapeCommit: () => set((state) => ({
    roomShapeCommitTick: state.roomShapeCommitTick + 1,
  })),

  setActiveTool: (activeTool) => {
    // Authoring tools require edit mode. Entering one of them flips
    // the global toggle on so the rest of the UI (Properties panel,
    // future manipulators) stays in sync. Read-only tools leave the
    // flag alone.
    // Any tool change that actually lands also resets the Space Sketch minimize
    // state, so the panel is never stranded collapsed after switching tools and
    // a fresh open of the tool always starts expanded. A tool change the collab
    // gate below rejects is not a tool change, so it leaves the flag alone.
    //
    // Leaving the Measure tool (activeTool currently 'measure', landing on
    // something else) must discard any in-progress measurement gesture —
    // MeasureOverlay only mounts while activeTool === 'measure' (see
    // ToolOverlays.tsx), so this is the ONE place a stray drag or polyline
    // click-sequence can be left stranded. Routed through
    // measurementSlice's resetMeasureGesture rather than duplicating the
    // clear here, so there's exactly one place that has to know what
    // "in-progress gesture" means (see measurementSlice.ts's measureMode
    // doc comment).
    const leavingMeasure = get().activeTool === 'measure' && activeTool !== 'measure';
    if (AUTHORING_TOOLS.has(activeTool)) {
      // Collab role gate: in a shared session only editor/admin may
      // unlock authoring. Viewers/commenters can still pick read-only
      // tools, so we only block the authoring branch.
      const canEdit = (get() as unknown as { canCollabEdit?: () => boolean }).canCollabEdit;
      if (canEdit && !canEdit()) return;
      if (leavingMeasure) (get() as unknown as { resetMeasureGesture?: () => void }).resetMeasureGesture?.();
      set({ activeTool, editEnabled: true, spaceSketchMinimized: false });
      return;
    }
    if (leavingMeasure) (get() as unknown as { resetMeasureGesture?: () => void }).resetMeasureGesture?.();
    set({ activeTool, spaceSketchMinimized: false });
  },
  setSpaceSketchMinimized: (spaceSketchMinimized) => set({ spaceSketchMinimized }),
  setEditEnabled: (editEnabled) => {
    if (editEnabled) {
      // Collab role gate: only editor/admin (or single-user, role===null)
      // may enter edit mode. This is the single chokepoint that unlocks
      // the gizmo, geometry card, add-element draw tools, and the inline
      // property editors — gating it here covers every authoring surface.
      const canEdit = (get() as unknown as { canCollabEdit?: () => boolean }).canCollabEdit;
      if (canEdit && !canEdit()) return;
    }
    if (!editEnabled) {
      // Flipping edit mode off must clear every authoring sub-state
      // that depends on it — otherwise the viewer ends up "not in
      // edit mode" but still carrying a georef draft or a half-drawn
      // slab polygon. Cross-slice reset lives here so callers don't
      // have to remember to mop up.
      set((s) => ({
        editEnabled: false,
        activeTool: AUTHORING_TOOLS.has(s.activeTool) ? 'select' : s.activeTool,
        spaceSketchMinimized: false,
        cesiumPlacementEditMode: false,
        cesiumPlacementDraftModelId: null,
        cesiumPlacementDraft: null,
      }));
      return;
    }
    // Turning edit mode ON with nothing selected auto-opens the
    // AddElement panel — most "I want to edit" sessions start
    // with adding something, and forcing the user to click an
    // extra button to reach the panel adds friction. When a
    // selection already exists, leave activeTool alone so the
    // Properties panel + Geometry edit card stay primary.
    set((s) => {
      const next: Partial<UISlice & UICrossSliceState> = { editEnabled: true };
      const slice = s as unknown as { selectedEntity?: unknown };
      if (s.activeTool === 'select' && !slice.selectedEntity) {
        next.activeTool = 'addElement';
      }
      return next;
    });
  },
  toggleEditEnabled: () => {
    get().setEditEnabled(!get().editEnabled);
  },

  setPropertiesActiveTab: (propertiesActiveTab) => set({ propertiesActiveTab }),

  setHierarchyMode: (mode) => {
    set({ hierarchyMode: mode });
    try {
      localStorage.setItem(HIERARCHY_MODE_STORAGE_KEY, mode);
    } catch (err) {
      console.warn('[hierarchy-mode] persist failed; in-memory only', err);
    }
  },

  setPendingPropertyFocus: (pendingPropertyFocus) => set({ pendingPropertyFocus }),

  setTheme: (theme) => {
    applyThemeClasses(theme);
    localStorage.setItem('ifc-lite-theme', theme);
    set({ theme });
  },

  toggleTheme: () => {
    // Normal toggle: dark ↔ light. If currently colorful, drop to dark.
    const current = get().theme;
    const newTheme = current === 'dark' ? 'light' : 'dark';
    applyThemeClasses(newTheme);
    localStorage.setItem('ifc-lite-theme', newTheme);
    set({ theme: newTheme });
  },

  toggleColorful: () => {
    // Shift+click secret: toggle colorful on/off
    // Into colorful from any state. Out of colorful → light (the storm clears).
    const current = get().theme;
    const newTheme: ThemeMode = current === 'colorful' ? 'light' : 'colorful';
    applyThemeClasses(newTheme);
    localStorage.setItem('ifc-lite-theme', newTheme);
    set({ theme: newTheme });
  },

  setIsMobile: (isMobile) => set({ isMobile }),
  toggleHoverTooltips: () => set((state) => ({ hoverTooltipsEnabled: !state.hoverTooltipsEnabled })),
  setVisualEnhancementsEnabled: (visualEnhancementsEnabled) => set({ visualEnhancementsEnabled }),
  setEdgeContrastEnabled: (edgeContrastEnabled) => set({ edgeContrastEnabled }),
  setEdgeContrastIntensity: (edgeContrastIntensity) => set({ edgeContrastIntensity }),
  setContactShadingQuality: (contactShadingQuality) => set({ contactShadingQuality }),
  setContactShadingIntensity: (contactShadingIntensity) => set({ contactShadingIntensity }),
  setContactShadingRadius: (contactShadingRadius) => set({ contactShadingRadius }),
  setSeparationLinesEnabled: (separationLinesEnabled) => set({ separationLinesEnabled }),
  setSeparationLinesQuality: (separationLinesQuality) => set({ separationLinesQuality }),
  setSeparationLinesIntensity: (separationLinesIntensity) => set({ separationLinesIntensity }),
  setSeparationLinesRadius: (separationLinesRadius) => set({ separationLinesRadius }),


  setToolbarStyle: (toolbarStyle) => {
    // Persist eagerly so the next page-load boots straight into the chosen
    // style (constants.ts `resolveInitialToolbarStyle`). Wrap in try/catch —
    // Safari private mode / locked storage throws.
    try {
      localStorage.setItem(TOOLBAR_STYLE_STORAGE_KEY, toolbarStyle);
    } catch (err) {
      console.warn('[toolbar-style] persist failed; in-memory only', err);
    }
    set({ toolbarStyle });
  },

  setRibbonCollapsed: (ribbonCollapsed) => {
    try {
      localStorage.setItem(RIBBON_COLLAPSED_STORAGE_KEY, String(ribbonCollapsed));
    } catch (err) {
      console.warn('[ribbon-collapsed] persist failed; in-memory only', err);
    }
    set({ ribbonCollapsed });
  },

  setRibbonTab: (ribbonTab) => set({ ribbonTab }),

  setRibbonContextualTabs: (ribbonContextualTabs) => {
    try {
      localStorage.setItem(RIBBON_CONTEXTUAL_TABS_STORAGE_KEY, String(ribbonContextualTabs));
    } catch (err) {
      console.warn('[ribbon-contextual-tabs] persist failed; in-memory only', err);
    }
    set({ ribbonContextualTabs });
  },
});
