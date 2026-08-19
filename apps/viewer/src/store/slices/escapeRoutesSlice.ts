/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The escape routes drawn on the plan, and the click that is half-made.
 *
 * Its own slice rather than more state in `drawing2DSlice`: a route is not a
 * free-hand annotation. The others there are shapes somebody drew and the
 * store simply keeps; a route is DERIVED from the model, can fail to exist,
 * and carries a length that has to stay in step with the building. Mixing it
 * in would put a thing that can fail among things that cannot.
 *
 * Routes live in the session until they are committed as `IfcAnnotation`.
 * They are deliberately NOT persisted to localStorage: a route is a statement
 * about the model, and a stale one restored beside a changed building would
 * state a length nobody can reproduce. Committing is what makes one durable.
 */

import type { StateCreator } from 'zustand';
import type { Point2D } from '@ifc-lite/drawing-2d';
import type { ViewerState } from '../index.js';
import type { EscapeRoute, EscapeRouteKind } from '@/lib/plan/escapeRoutes';
import type { EscapeRouteFailure } from '@/lib/spaceGraph/escapeRouting';

/** A route drawn this session, with what the router worked out about it. */
export interface DrawnEscapeRoute extends EscapeRoute {
  /** Walked length in metres, from the router. */
  readonly length: number;
  /** Rooms passed through, for a tooltip and for later checking. */
  readonly spaceIds: readonly number[];
  readonly doorIds: readonly number[];
  /** Narrowest door on the way, in metres — `null` where none was measured. */
  readonly narrowestDoor: number | null;
}

export interface EscapeRoutesSlice {
  /** Routes drawn this session, newest last. */
  escapeRoutes2D: readonly DrawnEscapeRoute[];
  /**
   * The first click of a two-click route, or `null` between routes.
   *
   * Held here rather than in the tool hook so the canvas can draw the pending
   * marker without the hook having to hand it down.
   */
  escapeRouteStart: Point2D | null;
  /** Why the last attempt produced nothing. Cleared on the next click. */
  escapeRouteFailure: EscapeRouteFailure | null;
  /** Which kind the next route is drawn as. */
  escapeRouteKind: EscapeRouteKind;

  setEscapeRouteStart: (point: Point2D | null) => void;
  setEscapeRouteFailure: (failure: EscapeRouteFailure | null) => void;
  setEscapeRouteKind: (kind: EscapeRouteKind) => void;
  addEscapeRoute: (route: DrawnEscapeRoute) => void;
  removeEscapeRoute: (id: string) => void;
  clearEscapeRoutes: () => void;
  /** Abandon a half-made route without touching the finished ones. */
  cancelEscapeRoute: () => void;
}

export const createEscapeRoutesSlice: StateCreator<
  ViewerState, [], [], EscapeRoutesSlice
> = (set, get) => ({
  escapeRoutes2D: [],
  escapeRouteStart: null,
  escapeRouteFailure: null,
  escapeRouteKind: 'horizontal',

  setEscapeRouteStart: (escapeRouteStart) => set({ escapeRouteStart }),
  setEscapeRouteFailure: (escapeRouteFailure) => set({ escapeRouteFailure }),
  setEscapeRouteKind: (escapeRouteKind) => set({ escapeRouteKind }),

  addEscapeRoute: (route) => {
    // Adding a route ends the gesture: the start marker has served its purpose
    // and leaving it would look like a second route was already begun.
    set({
      escapeRoutes2D: [...get().escapeRoutes2D, route],
      escapeRouteStart: null,
      escapeRouteFailure: null,
    });
  },

  removeEscapeRoute: (id) => {
    set({ escapeRoutes2D: get().escapeRoutes2D.filter((route) => route.id !== id) });
  },

  clearEscapeRoutes: () => set({ escapeRoutes2D: [], escapeRouteStart: null }),

  cancelEscapeRoute: () => set({ escapeRouteStart: null, escapeRouteFailure: null }),
});
