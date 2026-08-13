/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Whether the viewer is showing a building or a plan.
 *
 * Not a camera preset. A top-down camera over a 3D scene still foreshortens,
 * still lets elements at different heights drift apart on screen, and still
 * picks whatever is nearest the eye rather than what is on the floor being
 * worked on. Somebody working from plans notices all three immediately.
 *
 * Plan mode is therefore its own mode: one storey at a time, cut at a stated
 * height, orthographic, no orbit. It sits ALONGSIDE the existing 2D Section
 * tool rather than replacing it — that one answers "what does a section
 * through this look like", which is a different question from "let me work on
 * this floor".
 *
 * The mode is deliberately thin state. Everything that reads it — the camera,
 * the storey isolation, the cut — stays where it already lives, so a tool that
 * knows nothing about plan mode keeps working unchanged.
 */

import { type StateCreator } from 'zustand';
import type { ViewerState } from '../index.js';
import { loadPlanRotation, savePlanRotation } from '@/lib/plan/planRotationStore';

export type ViewMode = '3d' | '2d';

/**
 * Where the plan is cut, in metres above the storey's finished floor level.
 *
 * 1.25 m is the drafting convention: above a window sill and below a door
 * head, so both appear the way a plan is read. Adjustable, because a building
 * with high sills or a mezzanine needs a different height and a fixed value
 * would quietly cut through the wrong things.
 */
export const DEFAULT_PLAN_CUT_HEIGHT = 1.25;

export interface ViewModeSlice {
  viewMode: ViewMode;
  /**
   * Which storey the plan shows is NOT stored here.
   *
   * It is `activeStorey`, the same field the hierarchy, the storey tabs, the
   * command palette and Solo already drive. A `planStoreyId` beside it was a
   * second channel for one question, and it behaved exactly the way a second
   * channel does: clicking a storey in the hierarchy moved the building and
   * left the plan on the floor it was already showing.
   */
  /** Metres above the storey's finished floor. */
  planCutHeight: number;
  /**
   * Whether the plan-appropriate drawing defaults have been applied yet.
   *
   * Session-scoped on purpose: it exists to make the FIRST plan of a session
   * look like a plan, not to override a preference the user has since set.
   */
  planDefaultsSeeded: boolean;
  /**
   * How far the plan is turned for display, in radians. Project-wide.
   *
   * A north deviation is a property of the building, so paging storeys must not
   * change it. It turns the PICTURE only — every coordinate that gets written
   * still goes through the un-rotated mapping, so placements and committed
   * annotations stay in true world coordinates and the georeferencing is
   * untouched.
   */
  planRotation: number;
  /** True while the two-click rotation gesture is armed. */
  planRotationPicking: boolean;
  /**
   * Which project the loaded rotation belongs to.
   *
   * Beside the angle rather than in it: it exists to notice that the project
   * changed, and an angle that carries a project id would have to be kept in
   * step with one. `null` means nothing has been loaded yet.
   */
  planRotationProject: string | null;
  /**
   * Whether rooms are labelled with their name and area.
   *
   * On by default: it is most of what makes a drawing read as a plan, and a
   * feature nobody finds is a feature nobody has. Switchable because a plan
   * being used as a background for something else — a sensor layout, a
   * coordination view — wants the floor bare.
   *
   * Its own flag rather than a drawing display option: the labels are an
   * overlay derived from the model, not something the drawing generator
   * produces, and 2D Section has no storey to label rooms on.
   */
  planShowRoomLabels: boolean;
  /**
   * Whether doors and windows get a derived plan symbol.
   *
   * On by default, and switchable for a reason beyond taste: a model that
   * carries its OWN 2D plan representation already draws its swings through
   * the symbolic path, and both at once would double every arc.
   */
  planShowOpeningSymbols: boolean;

  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setPlanCutHeight: (metres: number) => void;
  setPlanShowRoomLabels: (show: boolean) => void;
  setPlanShowOpeningSymbols: (show: boolean) => void;
  setPlanRotation: (radians: number) => void;
  setPlanRotationPicking: (picking: boolean) => void;
  /**
   * Adopt the rotation stored for the current project, once per project.
   *
   * Called when a plan opens rather than on every render: re-reading storage
   * continuously would overwrite an angle the user is in the middle of setting.
   */
  restorePlanRotationForProject: () => void;
}

export const createViewModeSlice: StateCreator<ViewerState, [], [], ViewModeSlice> = (set, get) => ({
  viewMode: '3d',
  planCutHeight: DEFAULT_PLAN_CUT_HEIGHT,
  planDefaultsSeeded: false,
  planRotation: 0,
  planRotationPicking: false,
  planRotationProject: null,
  planShowRoomLabels: true,
  planShowOpeningSymbols: true,

  setViewMode: (viewMode) => {
    if (get().viewMode === viewMode) return;
    // Plan mode shares the drawing display options with the 2D Section tool —
    // one set of preferences, one settings panel, one underlay list. But two of
    // the shipped defaults are section defaults, not plan defaults: a plan does
    // not show occluded geometry dashed (it shows what is below the cut through
    // the projection instead), and without the projection it has no floor under
    // it and reads as a diagram of walls floating in space.
    //
    // So they are seeded ONCE, the first time a plan is opened in a session,
    // and are ordinary toggles from then on. Seeding every time would fight the
    // user; not seeding at all would make the first plan they ever see the
    // worst-looking one.
    if (viewMode === '2d' && !get().planDefaultsSeeded) {
      get().updateDrawing2DDisplayOptions({
        showHiddenLines: false,
        showConstructionProjection: true,
      });
      set({ planDefaultsSeeded: true });
    }
    set({ viewMode });
  },
  toggleViewMode: () => set({ viewMode: get().viewMode === '2d' ? '3d' : '2d' }),

  // Refuses a non-finite value rather than defaulting to zero: a cut at the
  // floor shows the slab and nothing else, which reads as a broken plan.
  setPlanCutHeight: (metres) => {
    if (Number.isFinite(metres)) set({ planCutHeight: metres });
  },

  // Refused rather than coerced, for the same reason as the cut height: a NaN
  // angle turns the whole drawing into NaN coordinates and the plan vanishes
  // with nothing on screen saying why.
  setPlanRotation: (radians) => {
    if (!Number.isFinite(radians)) return;
    set({ planRotation: radians, planRotationPicking: false });
    // Remembered for the project, never written into the model. The building
    // keeps the orientation it was modelled with; this records only that
    // somebody chose to look at it straight while working.
    savePlanRotation(get().currentProjectKey(), radians);
  },

  setPlanRotationPicking: (planRotationPicking) => set({ planRotationPicking }),

  setPlanShowRoomLabels: (planShowRoomLabels) => set({ planShowRoomLabels }),

  setPlanShowOpeningSymbols: (planShowOpeningSymbols) => set({ planShowOpeningSymbols }),

  restorePlanRotationForProject: () => {
    const project = get().currentProjectKey();
    if (project === null) return;
    // Once per project. Without the guard, reopening the plan would discard an
    // angle set and not yet stored, and switching storeys would fight the user.
    if (get().planRotationProject === project) return;
    const stored = loadPlanRotation(project);
    set({ planRotationProject: project, planRotation: stored ?? 0 });
  },
});
