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
import { PropertyValueType } from '@ifc-lite/data';
import { COMPARTMENT_PSET } from '@/lib/fireSafety/compartmentRequirements';
import {
  describeFirePlan, planFireZones, SPACE_FIRE_PSET,
  type PlanRoom, type ZoneToCreate,
} from '@/lib/fireSafety/firePlan';
import { resolveEntityLongName } from '@/lib/entity-predefined-type';
import { layOutCallPoint, layOutDetectors } from '@/lib/fireSafety/detectorLayout';
import { roomUseFromName } from '@/lib/fireSafety/roomUse';
import {
  createZone as createZoneInStore,
  deleteZone as deleteZoneInStore,
  paintZone as paintZoneInStore,
  setZoneColour as setZoneColourInStore,
  setZoneDescription as setZoneDescriptionInStore,
  setZoneName as setZoneNameInStore,
  setZoneObjectType as setZoneObjectTypeInStore,
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
  /** Change the zone's theme. `ObjectType`, since `IfcZone` has no
   *  PredefinedType — see `lib/ifcZones/themes`. */
  setIfcZoneObjectType: (modelId: string, zoneId: number, objectType: string) => boolean;
  /**
   * Write one `CHIBB_FireCompartmentRequirements` property on a zone, or clear
   * it when `value` is empty.
   *
   * Clearing DELETES the property rather than writing an empty string: absent
   * means "not decided yet" and `NONE` means "decided: no requirement", and an
   * empty value would be a third thing that reads like the first and exports
   * like neither.
   */
  setIfcZoneRequirement: (
    modelId: string, zoneId: number, propertyName: string, value: string,
  ) => boolean;
  deleteIfcZone: (modelId: string, zoneId: number) => boolean;
  /**
   * Paint rooms into (or out of) a zone. Returns what changed, or `null` when
   * the stroke was a no-op — no undo entry, no dirty flag, no re-render.
   */
  paintIfcZone: (
    modelId: string, zoneId: number, spaceIds: readonly number[], mode: PaintMode,
  ) => { added: number[]; removed: number[] } | null;

  /**
   * Derive the fire compartments and the Meldergruppen from the rooms, and
   * write them.
   *
   * One action rather than a script the panel drives, because the three parts
   * have to land together or not at all: a compartment zone with no alarm zone
   * is a proposal half-applied, and a `FireExit` written onto rooms whose
   * compartment was refused is a claim with nothing behind it.
   *
   * Refuses outright when the model already carries zones of either theme.
   * Re-deriving on top of them would double every compartment, and deciding
   * which of two overlapping proposals is current is not a decision code can
   * make — see `lib/fireSafety/firePlan.ts` for what it would be deciding.
   */
  proposeFireZones: (modelId: string) => FireZonesResult | { error: string };

  /**
   * Hang a smoke detector on every room's ceiling and a call point on the wall
   * of every escape corridor.
   *
   * Separate from `proposeFireZones` because the two fail differently and a
   * person wants them separately: the zones are a classification somebody
   * corrects by repainting, the detectors are geometry somebody corrects by
   * dragging. Running them as one action would mean undoing 140 devices to
   * change one compartment.
   *
   * Refuses when the model already carries detectors of this installation, for
   * the same reason the zones do.
   */
  placeFireDetectors: (modelId: string) => FireDevicesResult | { error: string };
}

export interface FireDevicesResult {
  detectors: number;
  callPoints: number;
  /** Rooms whose outline would not resolve — skipped, not guessed at. */
  skippedRooms: number;
}

export interface FireZonesResult {
  compartments: number;
  alarmGroups: number;
  /** Rooms that got a `Pset_SpaceCommon.FireExit`, true or false. */
  roomsFlagged: number;
  /** Lines for the toast — see `describeFirePlan`. */
  summary: string[];
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

    setIfcZoneObjectType: (modelId, zoneId, objectType) => {
      const ctx = writable(modelId);
      if (!ctx || !setZoneObjectTypeInStore(ctx.editor, ctx.entities, zoneId, objectType)) return false;
      commit(set, modelId, null);
      return true;
    },

    setIfcZoneRequirement: (modelId, zoneId, propertyName, value) => {
      const ctx = writable(modelId);
      if (!ctx) return false;
      // The property set is created on first write by `setProperty`; there is
      // nothing to declare up front.
      const mutation = value === ''
        ? ctx.view.deleteProperty(zoneId, COMPARTMENT_PSET, propertyName)
        : ctx.view.setProperty(
          zoneId, COMPARTMENT_PSET, propertyName, value, PropertyValueType.Label,
        );
      // `deleteProperty` answers null for a property that was not there, and a
      // no-op must not push an undo entry or mark the model dirty.
      if (!mutation) return false;
      commit(set, modelId, mutation);
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

    proposeFireZones: (modelId) => {
      const ctx = writable(modelId);
      if (!ctx) return { error: 'Für dieses Modell ist Schreiben nicht möglich.' };

      // Refused rather than merged. Two proposals over one building is a state
      // nobody can read, and the undo stack is not a migration plan.
      const existing = readZones(ctx.entities).filter(
        (z) => z.objectType === 'FireCompartment' || z.objectType === 'TriggerZoneFire',
      );
      if (existing.length > 0) {
        return {
          error: `Das Modell hat schon ${existing.length} Brandschutz-Zonen. `
            + 'Zuerst löschen, dann neu ableiten.',
        };
      }

      const rooms = collectPlanRooms(get, modelId);
      if (rooms.length === 0) {
        return { error: 'Keine Räume mit Umriss gefunden.' };
      }

      // Grouped by storey, storeys in elevation order: the numbering runs per
      // storey and reads the storey's NAME, so the order here is only what
      // decides which floor is written first.
      const byStorey = new Map<number, PlanRoom[]>();
      for (const room of rooms) {
        const list = byStorey.get(room.storeyExpressId);
        if (list) list.push(room); else byStorey.set(room.storeyExpressId, [room]);
      }
      const elevations = ctx.dataStore.spatialHierarchy?.storeyElevations;
      const ordered = [...byStorey.entries()]
        .sort((a, b) => (elevations?.get(a[0]) ?? 0) - (elevations?.get(b[0]) ?? 0))
        .map(([, list]) => ({ storeyName: list[0].storeyName, rooms: list }));

      const plan = planFireZones(ordered);

      const paint = (zone: ZoneToCreate) => {
        const zoneId = get().createIfcZone(modelId, {
          name: zone.name,
          description: zone.description,
          colour: zone.colour,
          objectType: zone.objectType,
        });
        if (zoneId === null) return false;
        get().paintIfcZone(modelId, zoneId, zone.roomIds, 'add');
        return true;
      };

      let compartments = 0;
      for (const zone of plan.compartmentZones) if (paint(zone)) compartments += 1;
      let alarmGroups = 0;
      for (const zone of plan.alarmZones) if (paint(zone)) alarmGroups += 1;

      let roomsFlagged = 0;
      for (const { roomId, value } of plan.fireExit) {
        const written = get().setProperty(
          modelId, roomId, SPACE_FIRE_PSET, 'FireExit', value, PropertyValueType.Boolean,
        );
        if (written) roomsFlagged += 1;
      }

      return { compartments, alarmGroups, roomsFlagged, summary: describeFirePlan(plan) };
    },

    placeFireDetectors: (modelId) => {
      const ctx = writable(modelId);
      if (!ctx) return { error: 'Für dieses Modell ist Schreiben nicht möglich.' };

      // Same refusal as the zones: a second run would hang a second detector
      // beside every first one, and "which of these two is current" is not a
      // question the model can answer.
      const already = ctx.entities.filter((e) => e.type === 'IfcSensor').length;
      if (already > 0) {
        return {
          error: `Das Modell hat schon ${already} Melder aus dieser Sitzung. `
            + 'Zuerst löschen, dann neu platzieren.',
        };
      }

      const rooms = collectPlanRooms(get, modelId);
      if (rooms.length === 0) return { error: 'Keine Räume mit Umriss gefunden.' };

      let detectors = 0;
      let callPoints = 0;
      let skippedRooms = 0;

      for (const room of rooms) {
        const footprint = get().readSlabFootprint(modelId, room.expressId);
        if (!footprint || footprint.footprint.length < 3) { skippedRooms += 1; continue; }
        const ring = footprint.footprint.map(([x, y]) => ({ x, y }));

        // Just under the ceiling. `thickness` is the room's own extrusion, so
        // a low basement and a high hall each get their own — and a room whose
        // height is missing or absurd falls back to a storey height rather
        // than hanging its detectors in the floor.
        const height = footprint.thickness > 0.5 && footprint.thickness < 20
          ? footprint.thickness : DEFAULT_ROOM_HEIGHT_M;
        const z = Math.max(0, height - DETECTOR_DROP_M);

        for (const at of layOutDetectors(ring)) {
          const result = get().addSensor(modelId, room.storeyExpressId, {
            Position: [at.x, at.y, z],
            PredefinedType: 'SMOKESENSOR',
            Name: 'Rauchmelder',
            Tag: 'RM',
          });
          if (!('error' in result)) detectors += 1;
        }

        if (roomUseFromName(room.name, room.longName) !== 'escape-corridor') continue;
        const callPoint = layOutCallPoint(ring);
        if (!callPoint) continue;
        const placed = get().addLibraryElement(modelId, room.storeyExpressId, {
          IfcEntity: 'IfcAlarm',
          // The IFC class for a Handfeuermelder. Not an IfcSensor: a sensor
          // detects, a manual pull box is pressed, and the panel treats the
          // two differently — an alarm from one is a fire, from the other a
          // person saying there is one.
          PredefinedType: 'MANUALPULLBOX',
          Position: [callPoint.at.x, callPoint.at.y, callPoint.height],
          Width: 0.1, Depth: 0.05, Height: 0.1,
          Discipline: 'fire',
          Name: 'Handfeuermelder',
          // The id the Type is found-or-created under, so every call point in
          // the building shares one `IfcAlarmType` instead of each carrying
          // its own copy of the same attributes.
          CatalogEntryId: 'fire.manual-call-point',
          CatalogEntryTag: 'HFM',
        });
        if (!('error' in placed)) callPoints += 1;
      }

      return { detectors, callPoints, skippedRooms };
    },
  };
};

/** Where a detector hangs below the ceiling, metres. */
const DETECTOR_DROP_M = 0.05;

/** For a room whose own height the file does not give. */
const DEFAULT_ROOM_HEIGHT_M = 2.8;

/**
 * Every room with an outline, with the storey it is on.
 *
 * `readSlabFootprint` is the same read the reshape handles use, so a room's
 * outline here is the one a person would see if they opened its handles —
 * there is no second derivation to disagree with the first.
 *
 * A room without a resolvable outline is skipped rather than given a guessed
 * position: the proposal groups by WHERE a room is, and a room placed at the
 * origin would drag a compartment across the building.
 */
function collectPlanRooms(get: () => ViewerState, modelId: string): PlanRoom[] {
  const dataStore = get().models.get(modelId)?.ifcDataStore;
  if (!dataStore) return [];
  const elementToStorey = dataStore.spatialHierarchy?.elementToStorey;
  const out: PlanRoom[] = [];

  for (const expressId of dataStore.entityIndex?.byType?.get('IFCSPACE') ?? []) {
    const storeyExpressId = elementToStorey?.get(expressId);
    if (storeyExpressId === undefined) continue;
    const footprint = get().readSlabFootprint(modelId, expressId);
    if (!footprint || footprint.footprint.length < 3) continue;

    const ring = footprint.footprint;
    let acc = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      acc += p[0] * q[1] - q[0] * p[1];
      cx += p[0];
      cy += p[1];
    }

    out.push({
      expressId,
      name: dataStore.entities?.getName?.(expressId) || undefined,
      longName: resolveEntityLongName(dataStore, expressId),
      area: Math.abs(acc) / 2,
      centre: { x: cx / ring.length, y: cy / ring.length },
      storeyExpressId,
      storeyName: String(dataStore.entities?.getName?.(storeyExpressId) ?? storeyExpressId),
    });
  }
  return out;
}
