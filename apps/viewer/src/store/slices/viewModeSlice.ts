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

/**
 * Two modes, not three. The schematic view (PROJECT.md §V35) was briefly a
 * third one here and is now a bottom-strip panel instead: it is read ALONGSIDE
 * the building or the plan, highlighting in the model what the drawing
 * contains, so making it a mode meant switching off the very thing it points
 * at. See `components/viewer/graph/GraphPanel.tsx`.
 */
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
  /**
   * Whether doors get their number written next to them.
   *
   * Its own flag, split out of `planShowRoomLabels`: the two answer different
   * questions on the same drawing. A room schedule wants the room text and
   * nothing else; a door list wants the door tags and nothing else, and a fire
   * plan usually wants the rooms named while the door numbers stay out of the
   * way of the escape route. One flag for both meant losing one to get rid of
   * the other.
   */
  planShowDoorLabels: boolean;
  /**
   * Draw the space graph — the rooms as dots, the doorways as lines, and the
   * doors-to-safety count each room carries. One flag for BOTH views: it is
   * the same graph, and two switches for one diagram would drift.
   *
   * Off by default: it is a diagnostic, not part of a drawing. It is what the
   * escape routes are walked on and the door numbers derived from, so it earns
   * its own switch — the first question about a wrong number is whether the
   * graph found that doorway at all.
   */
  showSpaceGraph: boolean;
  /**
   * Whether small devices get a mark instead of their own (invisible) shape.
   *
   * On by default: a detector at its real 100 mm is a speck at 1:100 and gone
   * at 1:200, so without this the plan simply does not show that the device is
   * there. Switchable because a plan used as a background for something else
   * wants the floor bare.
   */
  planShowDeviceMarks: boolean;

  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setPlanCutHeight: (metres: number) => void;
  setPlanShowRoomLabels: (show: boolean) => void;
  setPlanShowOpeningSymbols: (show: boolean) => void;
  setPlanShowDoorLabels: (show: boolean) => void;
  setShowSpaceGraph: (show: boolean) => void;
  setPlanShowDeviceMarks: (show: boolean) => void;
  setPlanRotation: (radians: number) => void;
  /**
   * Set the displayed angle WITHOUT deciding where it is remembered.
   *
   * For the plan-products slice, which owns that decision: it has already
   * stored the angle against a product, and letting `setPlanRotation` run
   * would write it to the project as well — where the other product would
   * then inherit it, which is the exact collision products exist to prevent.
   */
  setPlanRotationForProduct: (radians: number) => void;
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
  planShowDoorLabels: true,
  showSpaceGraph: false,
  planShowDeviceMarks: true,

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

    // Where the angle is remembered depends on what is being drawn. With a
    // plan product active the angle belongs to THAT drawing — a
    // Feuerwehrlageplan is turned to the approach direction, and the concept
    // plan beside it must not inherit that. With no product active this is an
    // ordinary plan and the angle belongs to the project, exactly as before
    // products existed.
    //
    // Either way it is never written into the model. The building keeps the
    // orientation it was modelled with; this records only that somebody chose
    // to look at it straight while working.
    if (get().activePlanProductId !== null) {
      get().setActivePlanProductRotation(radians);
      return;
    }
    savePlanRotation(get().currentProjectKey(), radians);
  },

  setPlanRotationForProduct: (radians) => {
    if (!Number.isFinite(radians)) return;
    set({ planRotation: radians, planRotationPicking: false });
  },

  setPlanRotationPicking: (planRotationPicking) => set({ planRotationPicking }),

  setPlanShowRoomLabels: (planShowRoomLabels) => set({ planShowRoomLabels }),

  setPlanShowOpeningSymbols: (planShowOpeningSymbols) => set({ planShowOpeningSymbols }),
  setPlanShowDoorLabels: (planShowDoorLabels) => set({ planShowDoorLabels }),
  setShowSpaceGraph: (showSpaceGraph) => set({ showSpaceGraph }),

  setPlanShowDeviceMarks: (planShowDeviceMarks) => set({ planShowDeviceMarks }),

  restorePlanRotationForProject: () => {
    const project = get().currentProjectKey();
    if (project === null) return;

    // Products first, and through this one entry point rather than a second
    // call site: whichever ran last would otherwise win, and "which angle is
    // the plan at" would depend on the order two effects happened to fire.
    get().restorePlanProductsForProject();

    // Once per project. Without the guard, reopening the plan would discard an
    // angle set and not yet stored, and switching storeys would fight the user.
    if (get().planRotationProject === project) return;
    const stored = loadPlanRotation(project);

    // With a product active the angle is already its own — restoring the
    // project's over it would hand the Lageplan's approach direction to the
    // concept plan, or the other way round.
    if (get().activePlanProductId !== null) {
      set({ planRotationProject: project });
      return;
    }
    set({ planRotationProject: project, planRotation: stored ?? 0 });
  },
});
