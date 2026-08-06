/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `IfcZone` authoring — create a zone, give it a colour, paint rooms into it.
 *
 * **Not** `zonesSlice`. That one owns the viewer-only location boxes that never
 * reach IFC (`lib/zones`); this one writes real `IfcZone` + `IfcRelAssignsToGroup`
 * into the mutation overlay (`lib/ifcZones`). The names are close enough that an
 * import can go to the wrong place, which is why both modules say so up front.
 *
 * The slice is deliberately thin: the IFC rules live in `lib/ifcZones/authoring`
 * (pure, unit-tested), and everything here is the part that needs the store —
 * resolving the editor, the role gate, undo entries, and the version bump that
 * makes the lens re-evaluate.
 */

import { type StateCreator } from 'zustand';
import { findOwnerHistoryId } from '@ifc-lite/create';
import type { Mutation } from '@ifc-lite/mutations';
import {
  createZone as createZoneInStore,
  deleteZone as deleteZoneInStore,
  paintZone as paintZoneInStore,
  setZoneColour as setZoneColourInStore,
  setZoneDescription as setZoneDescriptionInStore,
  setZoneName as setZoneNameInStore,
  type CreateZoneParams,
} from '@/lib/ifcZones/authoring';
import { readZones, type PaintMode, type ZoneInfo } from '@/lib/ifcZones/membership';
import { authoredEntities } from '@/lib/mutations/authoredEntities';
import { mayCreateEntities } from '@/lib/roles/roleGuard';
import { normalizeRoleId } from '@/lib/roles/disciplineRoles';
import { getOrCreateStoreEditor } from './mutationSlice.js';
import type { ViewerState } from '../index.js';

export interface IfcZonesSlice {
  /** The zone the brush paints into, as `modelId:expressId`. */
  activeIfcZoneKey: string | null;
  /**
   * Whether clicking a room paints it. Off by default: the brush hijacks
   * selection, and a tool that silently rewrites the model on every click is
   * not something to leave running.
   */
  ifcZoneBrushActive: boolean;
  /** `toggle` is the default — one brush that both paints and unpaints. */
  ifcZoneBrushMode: PaintMode;

  setActiveIfcZone: (modelId: string, zoneId: number | null) => void;
  setIfcZoneBrushActive: (active: boolean) => void;
  setIfcZoneBrushMode: (mode: PaintMode) => void;

  /** Every zone authored in this model, with members and colours. */
  ifcZonesOf: (modelId: string) => ZoneInfo[];

  createIfcZone: (modelId: string, params: CreateZoneParams) => number | null;
  renameIfcZone: (modelId: string, zoneId: number, name: string) => boolean;
  setIfcZoneColour: (modelId: string, zoneId: number, colour: string | null) => boolean;
  setIfcZoneDescription: (modelId: string, zoneId: number, text: string) => boolean;
  deleteIfcZone: (modelId: string, zoneId: number) => boolean;
  /**
   * Paint rooms into (or out of) a zone. Returns what changed, or `null` when
   * the stroke was a no-op — no undo entry, no dirty flag, no re-render.
   */
  paintIfcZone: (
    modelId: string, zoneId: number, spaceIds: readonly number[], mode: PaintMode,
  ) => { added: number[]; removed: number[] } | null;
}

/** `modelId:expressId`, so a zone stays identified across federated models. */
export function ifcZoneKey(modelId: string, zoneId: number): string {
  return `${modelId}:${zoneId}`;
}

/** Split an {@link ifcZoneKey} back apart, or `null` when it is not one. */
export function parseIfcZoneKey(key: string | null): { modelId: string; zoneId: number } | null {
  if (!key) return null;
  const at = key.lastIndexOf(':');
  if (at <= 0) return null;
  const zoneId = Number(key.slice(at + 1));
  return Number.isFinite(zoneId) ? { modelId: key.slice(0, at), zoneId } : null;
}

type Setter = (partial: Partial<ViewerState> | ((s: ViewerState) => Partial<ViewerState>)) => void;

/**
 * Mark the model changed and bump the version every lens / list / panel
 * subscribes to. Without the bump the write lands in the overlay and nothing
 * on screen notices — which looks exactly like the write not happening.
 */
function commit(set: Setter, modelId: string, mutation: Mutation | null): void {
  set((state) => {
    const dirtyModels = new Set(state.dirtyModels);
    dirtyModels.add(modelId);

    const next: Partial<ViewerState> = {
      dirtyModels,
      mutationVersion: state.mutationVersion + 1,
    };

    if (mutation) {
      const undoStacks = new Map(state.undoStacks);
      undoStacks.set(modelId, [...(undoStacks.get(modelId) ?? []), mutation]);
      const redoStacks = new Map(state.redoStacks);
      redoStacks.set(modelId, []);
      next.undoStacks = undoStacks;
      next.redoStacks = redoStacks;
    }

    return next;
  });
}

function mutationId(kind: string, entityId: number): string {
  return `mut_zone_${kind}_${entityId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const createIfcZonesSlice: StateCreator<ViewerState, [], [], IfcZonesSlice> = (set, get) => {
  /**
   * Everything a write needs, or `null` when this model cannot be written to.
   *
   * Creation needs its own gate: `canAuthorOn` asks about an existing entity,
   * and a zone about to be created has none — the same reason
   * `runInStoreElementBuilder` calls `mayCreateEntities` separately.
   */
  const writable = (modelId: string) => {
    if (!mayCreateEntities(normalizeRoleId(get().activeDisciplineSystemId)).allowed) return null;
    if (!get().canCollabEdit()) return null;

    const view = get().mutationViews.get(modelId);
    const dataStore = get().models.get(modelId)?.ifcDataStore;
    if (!view || !dataStore) return null;

    const editor = getOrCreateStoreEditor(get, set as (p: Partial<ViewerState>) => void, modelId);
    if (!editor) return null;

    return { editor, view, dataStore, entities: authoredEntities(view) };
  };

  return {
    activeIfcZoneKey: null,
    ifcZoneBrushActive: false,
    ifcZoneBrushMode: 'toggle',

    setActiveIfcZone: (modelId, zoneId) => set({
      activeIfcZoneKey: zoneId === null ? null : ifcZoneKey(modelId, zoneId),
    }),
    setIfcZoneBrushActive: (ifcZoneBrushActive) => set({ ifcZoneBrushActive }),
    setIfcZoneBrushMode: (ifcZoneBrushMode) => set({ ifcZoneBrushMode }),

    ifcZonesOf: (modelId) => {
      const view = get().mutationViews.get(modelId);
      return view ? readZones(authoredEntities(view)) : [];
    },

    createIfcZone: (modelId, params) => {
      const ctx = writable(modelId);
      if (!ctx) return null;

      const zoneId = createZoneInStore(ctx.editor, findOwnerHistoryId(ctx.dataStore), params);
      commit(set, modelId, {
        id: mutationId('create', zoneId),
        type: 'CREATE_ENTITY',
        timestamp: Date.now(),
        modelId,
        entityId: zoneId,
        attributeName: 'IfcZone',
      });
      return zoneId;
    },

    renameIfcZone: (modelId, zoneId, name) => {
      const ctx = writable(modelId);
      if (!ctx || !setZoneNameInStore(ctx.editor, ctx.entities, zoneId, name)) return false;
      commit(set, modelId, null);
      return true;
    },

    setIfcZoneColour: (modelId, zoneId, colour) => {
      const ctx = writable(modelId);
      if (!ctx || !setZoneColourInStore(ctx.editor, ctx.entities, zoneId, colour)) return false;
      commit(set, modelId, null);
      return true;
    },

    setIfcZoneDescription: (modelId, zoneId, text) => {
      const ctx = writable(modelId);
      if (!ctx || !setZoneDescriptionInStore(ctx.editor, ctx.entities, zoneId, text)) return false;
      commit(set, modelId, null);
      return true;
    },

    deleteIfcZone: (modelId, zoneId) => {
      const ctx = writable(modelId);
      if (!ctx) return false;

      const removed = deleteZoneInStore(ctx.editor, ctx.entities, zoneId);
      if (removed.length === 0) return false;

      // Deleting the zone the brush was pointing at leaves the brush aimed at
      // nothing; clear it rather than let the next click fail silently.
      if (get().activeIfcZoneKey === ifcZoneKey(modelId, zoneId)) {
        set({ activeIfcZoneKey: null, ifcZoneBrushActive: false });
      }
      commit(set, modelId, null);
      return true;
    },

    paintIfcZone: (modelId, zoneId, spaceIds, mode) => {
      const ctx = writable(modelId);
      if (!ctx) return null;

      const result = paintZoneInStore(
        ctx.editor, ctx.entities, findOwnerHistoryId(ctx.dataStore), zoneId, spaceIds, mode,
      );
      if (!result) return null;

      commit(set, modelId, result.createdRelationship
        ? {
          id: mutationId('assign', result.relExpressId),
          type: 'CREATE_ENTITY',
          timestamp: Date.now(),
          modelId,
          entityId: result.relExpressId,
          attributeName: 'IfcRelAssignsToGroup',
        }
        : null);
      return { added: result.added, removed: result.removed };
    },
  };
};
