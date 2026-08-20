/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Add-element tool state — drives the right-side AddElementPanel and
 * the viewport's click-to-place state machine. The actual STEP work
 * runs through `mutationSlice` actions (`addWall` / `addSlab` /
 * `addBeam` / `addColumn`); this slice holds:
 *
 *   - the panel form state (selected type, per-type dimensions,
 *     target storey, target federated model)
 *   - the in-progress click-placement state (pendingPoints,
 *     hoverPoint, slabMode for rectangle vs polygon)
 *
 * Defaults match the IfcCreator builders' construction-standard
 * conventions: wall thickness 0.2m, floor height 3m, slab 5×5×0.3m,
 * column 0.4×0.4×3m, beam 0.3×0.5×3m.
 */

import { type StateCreator } from 'zustand';
import type { CatalogEntry } from '@/lib/catalog';
import { VIEWER_ROLE_ID, normalizeRoleId } from '@/lib/roles/disciplineRoles';
import type { BoundaryMode } from '@ifc-lite/create';

const ROLE_STORAGE_KEY = 'ifclite.authoring.discipline-role';

/** Last chosen role. `normalizeRoleId` migrates the pre-split `standard` value
 *  and sends anything unrecognised to the read-only default. */
function readStoredRole(): string {
  try {
    return normalizeRoleId(window.localStorage.getItem(ROLE_STORAGE_KEY));
  } catch {
    // Storage blocked; fall through to the default.
    return VIEWER_ROLE_ID;
  }
}

export type AddElementType =
  | 'wall'
  | 'slab'
  | 'beam'
  | 'column'
  | 'door'
  | 'window'
  | 'space'
  | 'roof'
  | 'plate'
  | 'member'
  | 'sensor'
  | 'library';
export type AddElementSlabMode = 'rectangle' | 'polygon';

/**
 * A single accumulated 3D click point in **renderer-frame** Y-up world
 * coordinates (the same space the camera projects from). The IFC
 * conversion happens at builder dispatch time so the live preview can
 * project each pending point to screen without needing to know the
 * target storey's elevation.
 */
export interface AddElementVec3 {
  x: number;
  y: number;
  z: number;
}

export interface AddElementWallParams {
  Thickness: number;
  Height: number;
}

export interface AddElementSlabParams {
  Width: number;
  Depth: number;
  Thickness: number;
}

export interface AddElementBeamParams {
  Width: number;
  Height: number;
}

export interface AddElementColumnParams {
  Width: number;
  Depth: number;
  Height: number;
}

export interface AddElementDoorParams {
  Width: number;
  Height: number;
  FrameThickness: number;
}

export interface AddElementWindowParams {
  Width: number;
  Height: number;
  FrameThickness: number;
}

export interface AddElementSpaceParams {
  Width: number;
  Depth: number;
  Height: number;
}

export interface AddElementRoofParams {
  Width: number;
  Depth: number;
  Thickness: number;
}

export interface AddElementPlateParams {
  Width: number;
  Depth: number;
  Thickness: number;
}

export interface AddElementMemberParams {
  Width: number;
  Height: number;
}

/** Small MEP/building-automation device (fire detector, sensor, etc.) — IfcSensor. */
export interface AddElementSensorParams {
  Width: number;
  Depth: number;
  Height: number;
  /** IfcSensorTypeEnum value (without dots). Ignored on IFC2X3. */
  PredefinedType: string;
}

/** Placement box for a library-catalog element — seeded from the selected entry's geometry hint, editable per placement. */
export interface AddElementLibraryParams {
  Width: number;
  Depth: number;
  Height: number;
}

/**
 * Auto-space generation settings — ties into `generateSpacesFromWalls`.
 * Lives here so the panel form survives type-switches.
 */
export interface AddElementAutoSpaceParams {
  /**
   * How far apart two wall ends may be and still be welded into one node,
   * in metres.
   *
   * Called WELD rather than snap because this panel already has a snap: the
   * cursor magnet on vertices and edges (S). One is about where you click,
   * the other about how the wall graph is stitched, and naming both "snap"
   * made the drawing settings read as one control with two boxes.
   */
  SnapTolerance: number;
  /** Drop detected regions below this area (m²). */
  MinArea: number;
  /** IfcSpace extrusion height (m). */
  Height: number;
  /** Naming pattern; `{n}` = 1-based index. */
  NamePattern: string;
  /** IfcSpaceTypeEnum value (without dots). */
  PredefinedType: string;
  /**
   * Where the room's boundary sits relative to the walls it was found
   * between: `inner` = the room face (net area), `center` = the wall
   * centrelines (axis area), `outer` = the far face.
   *
   * It decides what every area in the room schedule MEANS, which is why it
   * belongs in the panel rather than in the generator's default.
   */
  BoundaryMode: BoundaryMode;
}

/**
 * Which of the three ways to make a room the panel is showing.
 *
 * They are three different tools that fail in three different ways — drawn by
 * hand, found between the model's walls, traced off an imported plan — and
 * stacking them under one heading read as one tool with a lot of settings.
 */
export type AddElementSpaceSource = 'draw' | 'walls' | 'plan';

/**
 * Which of the two ways to place an installation element the panel is showing.
 *
 * `click` is the original: point at the model, drop one device. `space` places
 * from the ROOMS instead — an installation planner covers an area rather than
 * clicking fifty-eight times, and the rooms are already in the model by the
 * time devices go in. Deliberately shaped like the room sources above, because
 * it is the same idea one floor up: the model decides where, you decide how
 * much.
 */
export type AddElementInstallationSource = 'click' | 'space';

/** The coverage rule for {@link AddElementInstallationSource} `'space'`. */
export interface AddElementPlaceBySpaceParams {
  /** m² one device covers; the room needs `ceil(area / this)` of them. */
  CoverageArea: number;
  /** Cap per room, however big it is. */
  MaxPerRoom: number;
  /** Rooms below this area (m²) get nothing. */
  MinArea: number;
  /**
   * Metres above the storey floor, or `null` for "just under the ceiling".
   *
   * `null` is the default because the right height is a property of the
   * STOREY, not of the tool: a detector belongs at the ceiling, and typing the
   * clear height of every floor by hand is how it ends up wrong on one of
   * them. A number entered here overrides that for every room in the run.
   */
  MountingHeight: number | null;
}

/** Live preview from the most recent dry-run detection (cleared on commit). */
export interface AddElementAutoSpacePreview {
  storeyExpressId: number;
  /** CCW outlines in IFC storey-local 2D (X/Y, m). */
  outlines: Array<Array<[number, number]>>;
  /** Per-region metadata for the panel summary. */
  regions: Array<{ area: number }>;
  /**
   * Where the outlines came from. The two sources fail differently, so the
   * summary has to say which one is being looked at: too few walls contributing
   * versus too few segments on the chosen layers.
   */
  source?: 'walls' | 'drawing';
  /** Walls-only. Absent when the outlines came from a drawing. */
  wallsConsidered?: number;
  /** Walls-only. Absent when the outlines came from a drawing. */
  wallsContributing?: number;
  /** Drawing-only: segments the detector was given. */
  segmentsConsidered?: number;
  /** Drawing-only: regions dropped as too narrow — almost always wall cavities. */
  skippedNarrow?: number;
  /**
   * Diagnostic counts from the planar-graph pipeline. Surfaced
   * verbatim in the Auto Spaces panel so users can spot pipeline
   * failures (e.g. zero edges after intersect-split → walls don't
   * connect).
   */
  diagnostics?: {
    vertices: number;
    edgesAfterSplit: number;
    facesTotal: number;
    outerFacesDropped: number;
    belowMinAreaDropped: number;
    largestArea: number;
    skipReasons: Record<string, number>;
  };
}

export interface AddElementSlice {
  addElementType: AddElementType;
  /** Target storey expressId; `null` ⇒ auto-pick first storey on click. */
  addElementStoreyId: number | null;
  /** Target model id; `null` ⇒ auto-pick the active model on click. */
  addElementModelId: string | null;
  addElementWallParams: AddElementWallParams;
  addElementSlabParams: AddElementSlabParams;
  addElementBeamParams: AddElementBeamParams;
  addElementColumnParams: AddElementColumnParams;
  addElementDoorParams: AddElementDoorParams;
  addElementWindowParams: AddElementWindowParams;
  addElementSpaceParams: AddElementSpaceParams;
  addElementRoofParams: AddElementRoofParams;
  addElementPlateParams: AddElementPlateParams;
  addElementMemberParams: AddElementMemberParams;
  addElementSensorParams: AddElementSensorParams;
  addElementLibraryParams: AddElementLibraryParams;
  /** Currently selected catalog entry for the `'library'` type; `null` until the user picks one. */
  addElementLibrarySelection: CatalogEntry | null;
  addElementAutoSpaceParams: AddElementAutoSpaceParams;
  addElementSpaceSource: AddElementSpaceSource;
  addElementInstallationSource: AddElementInstallationSource;
  addElementPlaceBySpaceParams: AddElementPlaceBySpaceParams;
  addElementAutoSpacePreview: AddElementAutoSpacePreview | null;

  /**
   * Active discipline role, as a `DisciplineSystem` id (see
   * `lib/roles/disciplineRoles.ts`). While one is set, every placed library
   * element also joins that installation's `IfcDistributionSystem`.
   * The base roles — `VIEWER_ROLE_ID` (the default) and `EDITOR_ROLE_ID` —
   * group nothing; they differ only in what may be written.
   */
  activeDisciplineSystemId: string;

  /**
   * When true, the role dialog should open itself. Consumed once and cleared
   * by the dialog, the same handoff `flavorDialogRequested` uses.
   *
   * The dialog owns its open state, which is right for a control a person
   * clicks. But the role governs whether anything may be written at all, so
   * both a demo and the command palette need to put it on screen before it
   * changes — a role that flips with no visible cause reads as the software
   * deciding on its own.
   */
  roleDialogRequested: boolean;

  /** Rectangle (2 clicks) or polygon (N clicks + Enter to close). */
  addElementSlabMode: AddElementSlabMode;
  /** In-progress click points. Cleared on tool exit, type change, or Esc. */
  addElementPendingPoints: AddElementVec3[];
  /** Live preview point under the cursor (snap-aware). */
  addElementHoverPoint: AddElementVec3 | null;

  setActiveDisciplineSystemId: (id: string) => void;
  setRoleDialogRequested: (open: boolean) => void;
  setAddElementType: (t: AddElementType) => void;
  setAddElementStoreyId: (id: number | null) => void;
  setAddElementModelId: (id: string | null) => void;
  setAddElementWallParams: (p: Partial<AddElementWallParams>) => void;
  setAddElementSlabParams: (p: Partial<AddElementSlabParams>) => void;
  setAddElementBeamParams: (p: Partial<AddElementBeamParams>) => void;
  setAddElementColumnParams: (p: Partial<AddElementColumnParams>) => void;
  setAddElementDoorParams: (p: Partial<AddElementDoorParams>) => void;
  setAddElementWindowParams: (p: Partial<AddElementWindowParams>) => void;
  setAddElementSpaceParams: (p: Partial<AddElementSpaceParams>) => void;
  setAddElementRoofParams: (p: Partial<AddElementRoofParams>) => void;
  setAddElementPlateParams: (p: Partial<AddElementPlateParams>) => void;
  setAddElementMemberParams: (p: Partial<AddElementMemberParams>) => void;
  setAddElementSensorParams: (p: Partial<AddElementSensorParams>) => void;
  setAddElementLibraryParams: (p: Partial<AddElementLibraryParams>) => void;
  /** Selecting an entry reseeds the dimension params from its geometry hint. */
  setAddElementLibrarySelection: (entry: CatalogEntry | null) => void;
  setAddElementAutoSpaceParams: (p: Partial<AddElementAutoSpaceParams>) => void;
  setAddElementSpaceSource: (source: AddElementSpaceSource) => void;
  setAddElementInstallationSource: (source: AddElementInstallationSource) => void;
  setAddElementPlaceBySpaceParams: (p: Partial<AddElementPlaceBySpaceParams>) => void;
  setAddElementAutoSpacePreview: (preview: AddElementAutoSpacePreview | null) => void;
  setAddElementSlabMode: (m: AddElementSlabMode) => void;
  appendAddElementPendingPoint: (p: AddElementVec3) => void;
  setAddElementHoverPoint: (p: AddElementVec3 | null) => void;
  clearAddElementPending: () => void;
}

const ADD_ELEMENT_DEFAULTS = {
  type: 'wall' as AddElementType,
  wall: { Thickness: 0.2, Height: 3 } as AddElementWallParams,
  slab: { Width: 5, Depth: 5, Thickness: 0.3 } as AddElementSlabParams,
  beam: { Width: 0.3, Height: 0.5 } as AddElementBeamParams,
  column: { Width: 0.4, Depth: 0.4, Height: 3 } as AddElementColumnParams,
  door: { Width: 0.9, Height: 2.1, FrameThickness: 0.05 } as AddElementDoorParams,
  window: { Width: 1.2, Height: 1.5, FrameThickness: 0.05 } as AddElementWindowParams,
  space: { Width: 4, Depth: 4, Height: 3 } as AddElementSpaceParams,
  roof: { Width: 8, Depth: 8, Thickness: 0.3 } as AddElementRoofParams,
  plate: { Width: 1, Depth: 1, Thickness: 0.02 } as AddElementPlateParams,
  member: { Width: 0.1, Height: 0.1 } as AddElementMemberParams,
  // Ceiling-puck-sized default (typical smoke/fire detector housing).
  sensor: { Width: 0.1, Depth: 0.1, Height: 0.05, PredefinedType: 'FIRESENSOR' } as AddElementSensorParams,
  library: { Width: 0.1, Depth: 0.1, Height: 0.05 } as AddElementLibraryParams,
  placeBySpace: {
    // The rule the Langmatt fire-detection model was built with: 45 m² a
    // detector, never more than four in one room.
    CoverageArea: 45,
    MaxPerRoom: 4,
    MinArea: 2,
    MountingHeight: null,
  } as AddElementPlaceBySpaceParams,
  autoSpace: {
    SnapTolerance: 0.1,
    MinArea: 0.5,
    Height: 3,
    NamePattern: 'Space {n}',
    PredefinedType: 'INTERNAL',
    // The room face, which is what a room schedule means by "area".
    BoundaryMode: 'inner',
  } as AddElementAutoSpaceParams,
};

export const createAddElementSlice: StateCreator<AddElementSlice, [], [], AddElementSlice> = (set) => ({
  addElementType: ADD_ELEMENT_DEFAULTS.type,
  addElementStoreyId: null,
  addElementModelId: null,
  addElementWallParams: { ...ADD_ELEMENT_DEFAULTS.wall },
  addElementSlabParams: { ...ADD_ELEMENT_DEFAULTS.slab },
  addElementBeamParams: { ...ADD_ELEMENT_DEFAULTS.beam },
  addElementColumnParams: { ...ADD_ELEMENT_DEFAULTS.column },
  addElementDoorParams: { ...ADD_ELEMENT_DEFAULTS.door },
  addElementWindowParams: { ...ADD_ELEMENT_DEFAULTS.window },
  addElementSpaceParams: { ...ADD_ELEMENT_DEFAULTS.space },
  addElementRoofParams: { ...ADD_ELEMENT_DEFAULTS.roof },
  addElementPlateParams: { ...ADD_ELEMENT_DEFAULTS.plate },
  addElementMemberParams: { ...ADD_ELEMENT_DEFAULTS.member },
  addElementSensorParams: { ...ADD_ELEMENT_DEFAULTS.sensor },
  addElementLibraryParams: { ...ADD_ELEMENT_DEFAULTS.library },
  addElementLibrarySelection: null,
  addElementAutoSpaceParams: { ...ADD_ELEMENT_DEFAULTS.autoSpace },
  addElementSpaceSource: 'draw',
  addElementInstallationSource: 'click',
  addElementPlaceBySpaceParams: { ...ADD_ELEMENT_DEFAULTS.placeBySpace },
  addElementAutoSpacePreview: null,
  addElementSlabMode: 'rectangle',
  addElementPendingPoints: [],
  addElementHoverPoint: null,
  activeDisciplineSystemId: readStoredRole(),
  roleDialogRequested: false,

  setActiveDisciplineSystemId: (activeDisciplineSystemId) => {
    // Persisted because the role now decides what may be edited, not just how
    // placements are grouped: silently reverting to Standard on reload would
    // hand back write access to the reference model without anyone asking.
    try {
      window.localStorage.setItem(ROLE_STORAGE_KEY, activeDisciplineSystemId);
    } catch {
      // Storage blocked — the choice still applies for this session.
    }
    set({ activeDisciplineSystemId });
  },
  setRoleDialogRequested: (roleDialogRequested) => set({ roleDialogRequested }),
  setAddElementType: (addElementType) =>
    // Switching types resets the pending-click queue — a wall's start
    // doesn't make sense as a slab's first corner. Hover is cleared
    // alongside so a stale preview doesn't flash with the new shape.
    set({ addElementType, addElementPendingPoints: [], addElementHoverPoint: null }),
  setAddElementStoreyId: (addElementStoreyId) => set({ addElementStoreyId }),
  setAddElementModelId: (addElementModelId) => set({ addElementModelId }),
  setAddElementWallParams: (p) =>
    set((s) => ({ addElementWallParams: { ...s.addElementWallParams, ...p } })),
  setAddElementSlabParams: (p) =>
    set((s) => ({ addElementSlabParams: { ...s.addElementSlabParams, ...p } })),
  setAddElementBeamParams: (p) =>
    set((s) => ({ addElementBeamParams: { ...s.addElementBeamParams, ...p } })),
  setAddElementColumnParams: (p) =>
    set((s) => ({ addElementColumnParams: { ...s.addElementColumnParams, ...p } })),
  setAddElementDoorParams: (p) =>
    set((s) => ({ addElementDoorParams: { ...s.addElementDoorParams, ...p } })),
  setAddElementWindowParams: (p) =>
    set((s) => ({ addElementWindowParams: { ...s.addElementWindowParams, ...p } })),
  setAddElementSpaceParams: (p) =>
    set((s) => ({ addElementSpaceParams: { ...s.addElementSpaceParams, ...p } })),
  setAddElementRoofParams: (p) =>
    set((s) => ({ addElementRoofParams: { ...s.addElementRoofParams, ...p } })),
  setAddElementPlateParams: (p) =>
    set((s) => ({ addElementPlateParams: { ...s.addElementPlateParams, ...p } })),
  setAddElementMemberParams: (p) =>
    set((s) => ({ addElementMemberParams: { ...s.addElementMemberParams, ...p } })),
  setAddElementSensorParams: (p) =>
    set((s) => ({ addElementSensorParams: { ...s.addElementSensorParams, ...p } })),
  setAddElementLibraryParams: (p) =>
    set((s) => ({ addElementLibraryParams: { ...s.addElementLibraryParams, ...p } })),
  setAddElementLibrarySelection: (entry) =>
    set({
      addElementLibrarySelection: entry,
      addElementLibraryParams: entry
        ? { Width: entry.geometry.width, Depth: entry.geometry.depth, Height: entry.geometry.height }
        : { ...ADD_ELEMENT_DEFAULTS.library },
    }),
  setAddElementAutoSpaceParams: (p) =>
    set((s) => ({ addElementAutoSpaceParams: { ...s.addElementAutoSpaceParams, ...p } })),
  setAddElementSpaceSource: (addElementSpaceSource) => set({ addElementSpaceSource }),
  setAddElementInstallationSource: (addElementInstallationSource) =>
    // Same reset as a type change: half a click sequence means nothing once
    // the rooms are doing the placing.
    set({ addElementInstallationSource, addElementPendingPoints: [], addElementHoverPoint: null }),
  setAddElementPlaceBySpaceParams: (p) =>
    set((s) => ({ addElementPlaceBySpaceParams: { ...s.addElementPlaceBySpaceParams, ...p } })),
  setAddElementAutoSpacePreview: (preview) =>
    set({ addElementAutoSpacePreview: preview }),
  setAddElementSlabMode: (addElementSlabMode) =>
    set({ addElementSlabMode, addElementPendingPoints: [], addElementHoverPoint: null }),
  appendAddElementPendingPoint: (p) =>
    set((s) => ({ addElementPendingPoints: [...s.addElementPendingPoints, p] })),
  setAddElementHoverPoint: (addElementHoverPoint) => set({ addElementHoverPoint }),
  clearAddElementPending: () =>
    set({ addElementPendingPoints: [], addElementHoverPoint: null }),
});
