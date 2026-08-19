/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The emit half of Space Sketch: turning every storey's draft plate into real
 * `IfcSpace`, once, on confirm.
 *
 * Split out of `SpaceSketchOverlay.tsx` because this is a self-contained
 * subject with its own state (`generatedRef`, the ids this tool authored per
 * storey) and its own failure stories, none of which involve the 2D editor:
 * re-confirming duplicating spaces instead of replacing them, one storey's
 * `addSpace` failure being reported as a "skip" and silently dropping rooms
 * from the export, and a partial failure closing the tool and discarding the
 * remaining drafts. The decisions live in `space-bake.ts`; this hook is the
 * store-facing plumbing around them.
 */

import { useCallback, useRef } from 'react';
import { useViewerStore } from '@/store';
import { overlayAttribute } from '@/lib/mutations/overlayAttribute';
import type { IfcDataStore } from '@ifc-lite/parser';
import {
  existingSpaceFootprintsByStorey,
  GENERATED_SPACE_OBJECTTYPE,
  type BoundaryMode,
} from '@ifc-lite/create';
import type { SpacePlateSession } from '@/lib/space-plate-session';
import type { Pt } from '@/lib/space-sketch-geometry';
import { planStoreySpaces, planStoreyGfa, type DraftRoom } from './space-bake';

export interface SpaceBakeResult {
  emitted: number;
  floors: number;
  /** Rooms left alone because they had been renamed since this tool made them. */
  kept: number;
  /** Rooms the author discarded — reported so the count is explainable. */
  discarded: number;
  /** Storey-wide GFA spaces created, when that option is on. */
  gfa: number;
  error: string | null;
}

export interface UseSpaceBakeOptions {
  /** Model the spaces are authored into; null refuses to guess. */
  sketchModelId: string | null;
  ifcDataStore: IfcDataStore | null;
  /** Net / gross / centre outline the user picked. */
  boundaryMode: BoundaryMode;
  /** Every storey's draft plate, keyed by storey expressId. */
  sessionsRef: React.RefObject<Map<number, SpacePlateSession>>;
  floorToFloor: (sid: number) => number;
  /**
   * Outlines of the rooms the author discarded, per storey.
   *
   * The escape hatch for a region the topology editor cannot dissolve — a node
   * joining three or more walls has no wall to remove that would merge two
   * rooms, so without this such a region can only be left in the file.
   */
  discardedRooms: React.RefObject<Map<number, Pt[][]>>;
  /** Also emit one `IfcSpace.GFA` per storey, named after the storey. */
  emitGfa: boolean;
  /**
   * The storey's gross outline, for the GFA space. `null` where none can be
   * derived, which is a normal answer on a storey whose walls were not found.
   */
  storeyOutline: (sid: number) => Pt[] | null;
  /** Storey name and long name, for naming the GFA space. */
  storeyNaming: (sid: number) => { name: string; longName?: string | null } | null;
  /** The storey on screen — the one a confirm writes into by default. */
  activeStoreyId: number | null;
  /**
   * Confirm every storey that has a draft, not just the one on screen.
   *
   * Off by default. Deriving is a whole-model action, so leaving the confirm
   * whole-model too meant somebody working on the first floor could create
   * rooms in the basement without ever looking at it — and did.
   */
  bakeAllStoreys: boolean;
}

export interface UseSpaceBake {
  /** Create every storey's draft as IfcSpace. Never throws. */
  createAllSpaces: () => SpaceBakeResult;
  /** Every expressId this tool has authored, across all storeys. */
  createdIds: () => number[];
}

export function useSpaceBake({
  sketchModelId,
  ifcDataStore,
  boundaryMode,
  sessionsRef,
  floorToFloor,
  discardedRooms,
  emitGfa,
  storeyOutline,
  storeyNaming,
  activeStoreyId,
  bakeAllStoreys,
}: UseSpaceBakeOptions): UseSpaceBake {
  const addSpace = useViewerStore((s) => s.addSpace);
  const removeEntity = useViewerStore((s) => s.removeEntity);

  // What this tool created per storey, with the name it gave each room — so
  // confirming again replaces its own spaces instead of duplicating them, and
  // can tell which of them somebody has since made their own.
  const generatedRef = useRef<Map<number, Array<{ id: number; name: string }>>>(new Map());

  /**
   * IfcSpace is class-hidden by default (TYPE_VISIBILITY_SEMANTIC_DEFAULTS).
   * Flip the toggle on after creating spaces so the user sees what they just
   * created — and, since the toggle persists, so the spaces stay visible when
   * the exported file is reopened.
   */
  const revealSpaces = useCallback(() => {
    const s = useViewerStore.getState();
    if (!s.typeVisibility.spaces) s.toggleTypeVisibility('spaces');
  }, []);

  /**
   * Create one storey's draft rooms as real IfcSpace. (1) Replace: remove the
   * spaces this tool previously created on the storey. (2) Skip rooms that
   * overlap an existing authored space (dedup, decided in `space-bake.ts`).
   * (3) Emit each via `addSpace`, which mirrors a mesh into the 3D scene
   * immediately. Returns counts.
   */
  const createSpacesForStorey = useCallback((
    sid: number,
    rooms: DraftRoom[],
    authored: Pt[][],
  ): {
    emitted: number; skipped: number; discarded: number; gfa: number;
    /** Rooms kept because they had been renamed since this tool made them. */
    kept: number;
    error: string | null;
  } => {
    if (!sketchModelId) {
      return { emitted: 0, skipped: 0, discarded: 0, gfa: 0, kept: 0, error: 'no model to create spaces in' };
    }

    // Replacing is for rooms nobody has touched. A room this tool made and
    // somebody has since NAMED is their work sitting on the tool's id, and
    // deleting it to make a fresh "Space 3" threw away an afternoon of room
    // numbers with no warning and no undo entry that looked like a loss.
    // Reported from real use, on a basement renamed while the tool was open.
    const view = useViewerStore.getState().getMutationView(sketchModelId);
    /** The room's name right now, or `null` when it cannot be read. */
    const nameOf = (id: number): string | null => {
      if (!view) return null;
      const authored = overlayAttribute(view, id, 'Name');
      if (authored !== null) return authored;
      const attr = view.getNewEntity(id)?.attributes?.[2];
      return typeof attr === 'string' ? attr : null;
    };
    let kept = 0;
    for (const made of generatedRef.current.get(sid) ?? []) {
      // Only a name we can READ and that has changed protects a room. An
      // unreadable one is not evidence of anything, and treating it as edited
      // would quietly turn the replace back into a duplicate — the thing this
      // ledger exists to prevent.
      const current = nameOf(made.id);
      if (current !== null && current !== made.name) { kept++; continue; }
      removeEntity(sketchModelId, made.id);
    }
    generatedRef.current.delete(sid);
    const height = floorToFloor(sid);
    const { planned, skipped, discarded } = planStoreySpaces(
      rooms, authored, height, discardedRooms.current?.get(sid) ?? [],
    );
    const made: Array<{ id: number; name: string }> = [];
    // An addSpace failure (anchor resolution, missing mutation view, …) is
    // NOT an "already a space" skip — keep the first error so the status
    // line tells the user the truth instead of silently dropping spaces
    // that would then be missing from the export.
    let error: string | null = null;
    for (const space of planned) {
      // `OuterCurve` is the engine's net/gross/centre outline; gross area stays
      // on the centreline so the quantity reflects the room, not the wall face.
      // The name counts SUCCESSFUL emissions, so a failed space does not leave
      // a gap in the numbering the user can see.
      const res = addSpace(sketchModelId, sid, {
        Profile: 'polygon',
        OuterCurve: space.OuterCurve,
        Height: space.Height,
        Name: `Space ${made.length + 1}`,
        ObjectType: GENERATED_SPACE_OBJECTTYPE,
        grossFloorArea: space.grossFloorArea,
      });
      if (res && 'expressId' in res) made.push({ id: res.expressId, name: `Space ${made.length + 1}` });
      else error ??= (res && 'error' in res ? res.error : 'unknown error');
    }
    // The storey's own space, after the rooms so it does not take "Space 1".
    // Emitted even where every room was discarded: the floor still has an area,
    // and that is a different statement from the rooms on it.
    let gfa = 0;
    if (emitGfa) {
      const outline = storeyOutline(sid);
      const naming = storeyNaming(sid);
      const plan = outline && naming ? planStoreyGfa(outline, height, naming) : null;
      if (plan) {
        const res = addSpace(sketchModelId, sid, {
          Profile: 'polygon',
          OuterCurve: plan.OuterCurve,
          Height: plan.Height,
          Name: plan.Name,
          LongName: plan.LongName ?? undefined,
          // The storey area, not a room somebody stands in.
          PredefinedType: 'GFA',
          ObjectType: GENERATED_SPACE_OBJECTTYPE,
          grossFloorArea: plan.grossFloorArea,
        });
        if (res && 'expressId' in res) { made.push({ id: res.expressId, name: plan.Name }); gfa = 1; }
        else error ??= (res && 'error' in res ? res.error : 'unknown error');
      }
    }

    generatedRef.current.set(sid, made);
    return { emitted: made.length, skipped, discarded, gfa, kept, error };
  }, [sketchModelId, removeEntity, addSpace, floorToFloor,
      discardedRooms, emitGfa, storeyOutline, storeyNaming]);

  /**
   * Confirm: turn EVERY storey's collected draft into IfcSpace at once — the
   * single create path, run on close. Reads each per-storey session's rooms at
   * the active boundary mode and dedupes against existing authored spaces.
   */
  const createAllSpaces = useCallback((): SpaceBakeResult => {
    // Report a real error rather than a silent zero: `confirmCreate` treats a
    // null error as success and closes the tool, which would discard every
    // draft the user has drawn. `sketchModelId` is genuinely reachable as null
    // — with several models loaded and none active we deliberately refuse to
    // guess which one to author into, rather than picking an arbitrary one.
    if (!sketchModelId) {
      return { emitted: 0, floors: 0, discarded: 0, gfa: 0, kept: 0, error: 'No active model — pick one in the model list, then confirm again.' };
    }
    if (!ifcDataStore) {
      return { emitted: 0, floors: 0, discarded: 0, gfa: 0, kept: 0, error: 'Model data is still loading — confirm again in a moment.' };
    }
    // The overlay is asked too, so a room this session already created — kept
    // because somebody named it — counts as "already there" and does not get a
    // second room laid on top of it.
    const bakeView = useViewerStore.getState().getMutationView(sketchModelId);
    const authoredMap = existingSpaceFootprintsByStorey(
      ifcDataStore,
      bakeView ? { getNewEntities: () => bakeView.getNewEntities() } : undefined,
    );
    let emitted = 0, floors = 0, discarded = 0, gfa = 0, kept = 0;
    let firstError: string | null = null;
    for (const [sid, session] of sessionsRef.current) {
      if (!bakeAllStoreys && sid !== activeStoreyId) continue;
      if (!session.alive || session.roomCount === 0) continue;
      const rooms = session.rooms().map((r) => ({
        outline: r.outline,
        boundary: session.boundaryOutline(r.face, boundaryMode),
      }));
      const res = createSpacesForStorey(sid, rooms, authoredMap.get(sid) ?? []);
      emitted += res.emitted;
      discarded += res.discarded;
      gfa += res.gfa;
      kept += res.kept;
      if (res.emitted) floors++;
      firstError ??= res.error;
    }
    if (emitted > 0) revealSpaces();
    return { emitted, floors, discarded, gfa, kept, error: firstError };
  }, [
    sketchModelId, ifcDataStore, boundaryMode, sessionsRef, createSpacesForStorey, revealSpaces,
    activeStoreyId, bakeAllStoreys,
  ]);

  const createdIds = useCallback((): number[] => {
    const out: number[] = [];
    for (const rooms of generatedRef.current.values()) out.push(...rooms.map((r) => r.id));
    return out;
  }, []);

  return { createAllSpaces, createdIds };
}
