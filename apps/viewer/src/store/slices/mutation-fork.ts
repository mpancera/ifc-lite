/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Fork: the mutation actions this fork adds on top of upstream's slice —
 * discipline-role gates, catalogue elements, sensors, annotations, detector
 * groups, wiring, alarm panels, door numbers, class triage, room reshaping and
 * rooms from an imported drawing.
 *
 * Kept out of `mutationSlice.ts` since the 2026-11 upstream sync: upstream
 * split that slice into modules, and holding the fork's additions in one
 * module of their own keeps the next sync a small merge instead of a large one.
 */

import type { ViewerState } from '../index.js';
import type { MutablePropertyView, Mutation } from '@ifc-lite/mutations';
import { StoreEditor } from '@ifc-lite/mutations';
import { PropertyValueType, RelationshipType } from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { MeshData } from '@ifc-lite/geometry';
import {
  resolveSpatialAnchor,
  addLibraryElementToStore,
  addLibraryTypeToStore,
  addDistributionSystemToStore,
  addDistributionCircuitToStore,
  addDistributionGroupToStore,
  toNativeArea,
  toNativeVolume,
  toNativeLength,
  emitRelAggregates,
  emitRelAssignsToGroup,
  emitRelDefinesByType,
  findDistributionSystem,
  addRunPortsToStore,
  emitRelConnectsPorts,
  addControllerToStore,
  addAlarmPanelToStore,
  addSensorToStore,
  addAnnotationToStore,
  generateSpacesFromDrawing,
  addSpaceBoundaryToStore,
  type GenerateSpacesResult,
  type GenerateSpacesFromDrawingOptions,
  type GenerateSpacesFromDrawingResult,
  type AutoSpaceSegment,
  type LibraryElementInStoreParams,
  type SensorInStoreParams,
  type AnnotationInStoreParams,
} from '@ifc-lite/create';
import { TRADE_PROPERTY, TRADE_PSET, tradeCodeFor } from '@/lib/catalog/tradeCode';
import { AAS_CONNECTOR_PSET, AAS_KIND, aasConnectorProperties } from '@/lib/aas/connectorPset';
import type { CatalogEntry } from '@/lib/catalog';
import {
  disciplineSystemName, findDisciplineSystem, normalizeRoleId, parsedDisciplineSystemOf,
} from '@/lib/roles/disciplineRoles';
import { parsedZonesOf, readZones, readZonesForDisplay } from '@/lib/ifcZones/membership';
import { themeOfZone } from '@/lib/ifcZones/themes';
import { authoredEntities } from '@/lib/mutations/authoredEntities';
import {
  CIRCUIT_OBJECT_TYPE, mergeOwnCircuits, parsedCircuitsOf, planCircuits, readCircuits,
  type CircuitPlan,
} from '@/lib/detectorGroups/circuits';
import {
  nextRunName, planWiring, RUN_OBJECT_TYPE, type WirePlan,
} from '@/lib/wiring/wirePlan';
import { findAlarmPanelSite } from '@/lib/wiring/alarmPanelSite';
import { resolveEntityLongName } from '@/lib/entity-predefined-type';
import { isDeviceType } from '@/lib/plan/deviceSymbols';
import { reshapeRoomOutline } from '@/lib/roomShape/reshape';
import { mayCreateEntities, mayEditEntity, type EditPermission } from '@/lib/roles/roleGuard';
import { typeClassFor } from '@/lib/classTriage/groupAssignment';
import { resolveSpaceForPlacement, spacesByStorey } from '@/lib/relationships/spaceLookup';
import { overlayContainerOf } from '@/lib/persistence/storeAdapter';
import { applySmartPropertyRules } from '@/lib/smartProperties/applyRules';
import { getModelLengthUnitScale } from '@/lib/length-unit-scale.js';
import { registerAuthoredElement } from '@/utils/spatialHierarchy.js';
import { toGlobalIdFromModels } from '../globalId.js';
import { mutationDenial } from '../mutation-permission.js';
import { buildElementMesh, type ElementMeshPayload } from './addElementMeshes.js';
import { revealAddedGeometryInModelView } from './authoredGeometryCompletion.js';
import { ensureStoreyPlacement } from './storeyPlacement.js';
import { modelEditTarget } from './mutation-modelling-records.js';
import { recordHistory } from './mutation-history-record.js';
import { getOrCreateStoreEditor, writeView } from './mutationSlice.js';

type SetState = (partial: Partial<ViewerState> | ((s: ViewerState) => Partial<ViewerState>)) => void;

/** The generator's own default room height in metres, mirrored for the mesh. */
export const DEFAULT_SPACE_HEIGHT = 3;

/** One room's geometry either side of a reshape — see `mutationShapeReplacements`. */
export interface RoomShapeReplacement {
  modelId: string;
  globalId: number;
  expressId: number;
  /** The meshes the reshape dropped. */
  before: MeshData[];
  /** The meshes it put there instead. */
  after: MeshData[];
  /** Qto values to restore on undo, or `null` when the room had none of ours. */
  beforeQuantities: RoomQuantities | null;
  afterQuantities: RoomQuantities;
}

/** The five `Qto_SpaceBaseQuantities` a reshape rewrites, in m²/m/m³. */
export interface RoomQuantities {
  area: number;
  perimeter: number;
  height: number;
}

/**
 * Give freshly generated rooms the same standing a hand-drawn one gets:
 * a node in the spatial tree, a mesh in the scene, and a class that is
 * switched on so they can be seen.
 *
 * The bulk generator emits straight into the overlay and stops there. That is
 * enough for the export, and nothing else — every surface that draws or lists
 * rooms reads the spatial hierarchy or the geometry, and neither had heard of
 * them.
 */
export function materialiseGeneratedSpaces(
  get: () => ViewerState,
  set: (partial: Partial<ViewerState> | ((s: ViewerState) => Partial<ViewerState>)) => void,
  modelId: string,
  dataStore: IfcDataStore,
  storeyExpressId: number,
  emitted: GenerateSpacesResult['emitted'],
  height: number,
): void {
  const storeyElevation = dataStore.spatialHierarchy?.storeyElevations?.get(storeyExpressId) ?? 0;
  const meshes: MeshData[] = [];

  for (const { result, name, outline } of emitted) {
    if (dataStore.spatialHierarchy) {
      registerAuthoredElement(
        dataStore.spatialHierarchy, storeyExpressId, result.spaceId, 'IfcSpace', name,
      );
    }
    // The baked outline, not the centreline one: the mesh has to be the solid
    // the file describes, or picking and the drawing disagree with the export.
    const mesh = buildElementMesh({
      type: 'space',
      globalId: toGlobalIdFromModels(get().models, modelId, result.spaceId),
      storeyElevation,
      payload: {
        type: 'space',
        // Width/Depth are the rectangle mode's inputs; the polygon branch
        // reads Height alone, but the payload type carries all three.
        params: { Width: 0, Depth: 0, Height: height },
        corners: outline.map(([x, y]) => [x, y, 0] as [number, number, number]),
      },
    });
    if (mesh) meshes.push(mesh);
  }

  if (meshes.length > 0) {
    get().appendGeometryBatch(modelId, meshes);
  }

  // IfcSpace is class-hidden by default, so without this the rooms are in the
  // scene and still not on screen — the same reveal Space Sketch does.
  const state = get();
  if (!state.typeVisibility.spaces) state.toggleTypeVisibility('spaces');
  revealAddedGeometryInModelView(get);
  set((s) => ({ mutationVersion: s.mutationVersion + 1 }));
}

/** True when this entity is an `IfcZone` — authored this session or in the file. */
export function zoneTypeOf(get: () => ViewerState, modelId: string, entityId: number): boolean {
  const authored = get().mutationViews.get(modelId)?.getNewEntity(entityId)?.type;
  if (authored) return authored === 'IfcZone';
  const store = get().models.get(modelId)?.ifcDataStore ?? get().ifcDataStore;
  return store?.entities?.getTypeName?.(entityId) === 'IfcZone';
}

/**
 * The entity's Description as it currently stands, merging the overlay the
 * same way every reader does: a named edit wins, then a positional one, then
 * the authored record, then the parsed file.
 */
export function currentDescription(
  get: () => ViewerState, modelId: string, entityId: number,
): string | null {
  const view = get().mutationViews.get(modelId);
  if (view) {
    for (const m of view.getAttributeMutationsForEntity(entityId)) {
      if (m.name === 'Description') return m.value;
    }
    const positional = view.getPositionalMutationsForEntity(entityId)?.get(DESCRIPTION_INDEX);
    if (typeof positional === 'string') return positional;
    const authored = view.getNewEntity(entityId)?.attributes?.[DESCRIPTION_INDEX];
    if (typeof authored === 'string') return authored;
  }
  const store = get().models.get(modelId)?.ifcDataStore ?? get().ifcDataStore;
  return store?.entities?.getDescription?.(entityId) ?? null;
}

/** `Description` sits at index 3 on every `IfcRoot` subtype. */
const DESCRIPTION_INDEX = 3;

/**
 * Fill rule-driven properties for a freshly placed element.
 *
 * Written straight onto the view rather than through `setProperty`, so the
 * property is part of the SAME undo step as the placement: undoing a drop that
 * also stamped an identifier should not leave the identifier behind.
 *
 * Failures are swallowed deliberately — a rule that cannot resolve must never
 * cost the user the element they just placed.
 */
export function applySmartProperties(
  get: () => ViewerState,
  modelId: string,
  expressId: number,
  ifcClass: string,
): void {
  const store = get().models.get(modelId)?.ifcDataStore;
  const view = get().mutationViews.get(modelId);
  if (!store || !view) return;

  try {
    applySmartPropertyRules({
      store, view, expressId, ifcClass,
      write: (pset, property, value, targetId) => {
        view.setProperty(targetId ?? expressId, pset, property, value, PropertyValueType.String);
      },
    });
  } catch (err) {
    console.warn('[smartProperties] rule evaluation failed:', err);
  }
}

/**
 * Run a builder that relates EXISTING elements to a group or a type.
 *
 * Lighter than {@link runInStoreElementBuilder}, which is shaped for creating
 * one element: there is no mesh, no spatial registration and no single new
 * express id to report — the product here is a relationship over a set.
 *
 * The anchor still comes from a storey, because `addLibraryTypeToStore` needs
 * the file's schema and owner history from one. Any storey will do; a type and
 * a system are not placed, so nothing about the choice reaches the output.
 */
/**
 * How high above its storey an alarm panel is mounted, in metres.
 *
 * A panel is wall-mounted at reading height, not lying on the floor. The
 * number is not precision — it is the difference between a box a person walks
 * up to and a box in the screed — and it is a starting point somebody drags.
 */
const PANEL_MOUNTING_HEIGHT_M = 1.4;

function runGroupRelation<T>(
  get: () => ViewerState,
  set: (partial: Partial<ViewerState> | ((s: ViewerState) => Partial<ViewerState>)) => void,
  modelId: string,
  expressIds: readonly number[],
  errorContext: string,
  build: (editor: StoreEditor, anchor: ReturnType<typeof resolveSpatialAnchor>) => T,
): T | { error: string } {
  if (expressIds.length === 0) return { error: 'Keine Elemente ausgewählt' };
  const mayCreate = mayCreateEntities(normalizeRoleId(get().activeDisciplineSystemId));
  if (!mayCreate.allowed) return { error: mayCreate.reason };
  if (!get().canCollabEdit()) return { error: 'Editing is disabled for your role in this shared session' };

  const dataStore = get().models.get(modelId)?.ifcDataStore;
  if (!dataStore) return { error: `No model loaded for id "${modelId}"` };
  // Create the overlay rather than refusing for the want of one. A freshly
  // opened model has none until some surface edits, so the FIRST authoring
  // action through this path used to fail with "no editable mutation view
  // yet" — which reads as a defect and is, since the next click after
  // touching anything else succeeds. `ensureMutationView` is the same
  // creation the editing surfaces do.
  if (!get().ensureMutationView(modelId)) {
    return { error: 'Model has no editable mutation view yet' };
  }

  const editor = getOrCreateStoreEditor(get, set, modelId);
  if (!editor) return { error: 'Failed to create store editor' };

  const storeyId = dataStore.entityIndex?.byType?.get('IFCBUILDINGSTOREY')?.[0];
  if (storeyId === undefined) return { error: 'Das Modell hat kein Geschoss, an dem sich verankern lässt' };

  try {
    ensureStoreyPlacement(dataStore, editor, storeyId);
    const result = build(editor, resolveSpatialAnchor(dataStore, storeyId));
    set((state) => ({
      dirtyModels: new Set(state.dirtyModels).add(modelId),
      mutationVersion: state.mutationVersion + 1,
    }));
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : `Failed to ${errorContext}` };
  }
}

/**
 * Join a freshly authored element to the active role's `IfcDistributionSystem`.
 *
 * The role is the whole point of authoring in a discipline: a trade planner
 * builds an installation, not a heap of devices, and the grouping is what a
 * downstream consumer reads to find the fire-detection system. One system per
 * role is created and then reused for every later placement
 * (`findDistributionSystem` matches on the same key).
 *
 * Grouping is independent of spatial containment, so this leaves the
 * element's placement untouched. Every path that creates an installation
 * element must call it — a detector's membership must not depend on which
 * button dropped it.
 */
function joinActiveDisciplineSystem(
  get: () => ViewerState,
  editor: StoreEditor,
  anchor: ReturnType<typeof resolveSpatialAnchor>,
  modelId: string,
  elementId: number,
): void {
  const system = findDisciplineSystem(get().activeDisciplineSystemId);
  if (!system) return;
  const entities = get().mutationViews.get(modelId)?.getNewEntities() ?? [];
  // Same three-step lookup as the circuit builder: session, then file, then
  // create. A placement must join the installation that is already there.
  const systemId = findDistributionSystem(entities, system.predefinedType, system.objectType)
    ?? parsedDisciplineSystemOf(get().models.get(modelId)?.ifcDataStore, system)
    ?? addDistributionSystemToStore(editor, anchor.ownerHistoryId, {
      PredefinedType: system.predefinedType,
      ObjectType: system.objectType,
      Name: disciplineSystemName(system),
    }, anchor.guidRandom).systemId;
  emitRelAssignsToGroup(editor, anchor.ownerHistoryId, [elementId], systemId, anchor.guidRandom);
}

/**
 * Put a reshaped room's geometry back the way the record says.
 *
 * Undo and redo differ only in which side of the pair they want, so both come
 * through here. Idempotent on purpose: the two positional writes of one reshape
 * are undone one after the other, and whichever reaches this first does the
 * whole job.
 *
 * Restores three things, because a reshape changed three: the mesh every 2D
 * reader cuts from, the renderer's own copy of it, and the quantities. Leaving
 * any one of them behind is what made the first version of undo look broken —
 * the file went back and the drawing did not.
 */
export function restoreRoomShape(
  get: () => ViewerState,
  set: (partial: Partial<ViewerState>) => void,
  record: RoomShapeReplacement,
  side: 'before' | 'after',
): void {
  const meshes = side === 'before' ? record.before : record.after;
  const quantities = side === 'before' ? record.beforeQuantities : record.afterQuantities;

  if (meshes.length > 0) {
    get().replaceMeshesForEntity([record.globalId, record.expressId], meshes[0]);
    get().setPendingMeshRemovals(new Set([record.globalId]));
  }

  const view = get().mutationViews.get(record.modelId);
  const dataStore = get().models.get(record.modelId)?.ifcDataStore;
  const key = `${record.modelId}:${record.expressId}`;
  const written = new Map(get().mutationShapeQuantities);

  if (!quantities) {
    // Nothing of ours was there before: take our set away so the file's own
    // quantities show through again, rather than writing a guess over them.
    for (const name of ['GrossFloorArea', 'NetFloorArea', 'GrossPerimeter', 'Height', 'GrossVolume']) {
      view?.removeQuantityMutation(record.expressId, 'Qto_SpaceBaseQuantities', name);
    }
    written.delete(key);
  } else if (view && dataStore) {
    const storeyId = dataStore.spatialHierarchy?.elementToStorey.get(record.expressId);
    if (storeyId !== undefined) {
      try {
        const anchor = resolveSpatialAnchor(dataStore, storeyId);
        const editor = getOrCreateStoreEditor(get, set, record.modelId);
        editor?.addQuantitySet(record.expressId, 'Qto_SpaceBaseQuantities', [
          { name: 'GrossFloorArea', value: toNativeArea(anchor, quantities.area), quantityType: 'AREA' },
          { name: 'NetFloorArea', value: toNativeArea(anchor, quantities.area), quantityType: 'AREA' },
          { name: 'GrossPerimeter', value: toNativeLength(anchor, quantities.perimeter), quantityType: 'LENGTH' },
          { name: 'Height', value: toNativeLength(anchor, quantities.height), quantityType: 'LENGTH' },
          {
            name: 'GrossVolume',
            value: toNativeVolume(anchor, quantities.area * quantities.height),
            quantityType: 'VOLUME',
          },
        ]);
        written.set(key, quantities);
      } catch {
        // The shape is back either way; a quantity set that would not attach
        // is not worth failing the undo over.
      }
    }
  }
  set({ mutationShapeQuantities: written });
}


/**
 * The fork's element builder: a callback that writes the IFC and an optional
 * mesh payload drawn at once. Upstream's `runInStoreElementBuilder` takes a
 * closed `AuthoredElement` union the fork's device classes are not part of.
 */
export function runForkElementBuilder(
  get: () => ViewerState,
  set: SetState,
  modelId: string,
  storeyExpressId: number,
  ifcType: string,
  errorContext: string,
  build: (editor: StoreEditor, anchor: ReturnType<typeof resolveSpatialAnchor>) => number,
  meshPayload?: ElementMeshPayload,
): { expressId: number } | { error: string } {
  // Creation needs its own gate: `canAuthorOn` asks about an entity, and a new
  // element has none yet.
  const mayCreate = mayCreateEntities(normalizeRoleId(get().activeDisciplineSystemId));
  if (!mayCreate.allowed) return { error: mayCreate.reason };
  const denial = mutationDenial(get(), modelId);
  if (denial) return { error: denial };
  const state = get();
  const dataStore = state.models.get(modelId)?.ifcDataStore;
  if (!dataStore) return { error: `No model loaded for id "${modelId}"` };

  const view = writeView(get, modelId);
  if (!view) return { error: 'Model has no editable mutation view yet' };
  const editor = getOrCreateStoreEditor(get, set, modelId);
  if (!editor) return { error: 'Failed to create store editor' };

  let entityId: number;
  try {
    ensureStoreyPlacement(dataStore, editor, storeyExpressId);
    entityId = build(editor, resolveSpatialAnchor(dataStore, storeyExpressId, view));
  } catch (err) {
    return { error: err instanceof Error ? err.message : `Failed to ${errorContext}` };
  }

  if (dataStore.spatialHierarchy) {
    const rawName = editor.getNewEntity(entityId)?.attributes?.[2];
    const name = typeof rawName === 'string' ? rawName : '';
    // The builder may have contained the element in the room enclosing it
    // rather than in the storey; read that back so the hierarchy agrees with
    // what the IFC actually says.
    const containerId = overlayContainerOf(view, entityId);
    registerAuthoredElement(
      dataStore.spatialHierarchy, storeyExpressId, entityId, ifcType, name, containerId,
    );
    // Rule-driven properties run after registration: they read the storey
    // and the room, which only resolve once the element is in the hierarchy.
    applySmartProperties(get, modelId, entityId, ifcType);
  }

  let createdMesh: MeshData | null = null;
  if (meshPayload) {
    const storeyElevation = dataStore.spatialHierarchy?.storeyElevations?.get(storeyExpressId) ?? 0;
    const mesh = buildElementMesh({
      type: meshPayload.type,
      globalId: toGlobalIdFromModels(state.models, modelId, entityId),
      storeyElevation,
      payload: meshPayload,
    });
    if (mesh) {
      createdMesh = mesh;
      get().appendGeometryBatch(modelId, [mesh]);
      revealAddedGeometryInModelView(get);
    }
  }

  const mutation: Mutation = {
    id: `mut_${ifcType.toLowerCase()}_${entityId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    type: 'CREATE_ENTITY',
    timestamp: Date.now(),
    modelId,
    entityId,
    attributeName: ifcType,
  };
  set((s) => recordHistory(s, modelId, [mutation]));

  const rawGuid = editor.getNewEntity(entityId)?.attributes?.[0];
  const guid = typeof rawGuid === 'string' && rawGuid.length > 0 ? rawGuid : null;
  get().mirrorEntityCreate(modelId, entityId, ifcType, guid, createdMesh);

  return { expressId: entityId };
}

/** Fork state and actions merged into `MutationSlice`. */
export interface ForkMutationSlice {
  /**
   * What a reshaped room looked like before and after, keyed by BATCH id.
   *
   * Reshaping writes two positional attributes, and undoing those alone puts
   * the IFC back while the drawing keeps the new outline: the mesh was
   * replaced and the quantities rewritten, and neither is an attribute the
   * generic handlers know about. So the pair is recorded here and the undo /
   * redo handlers swap it, exactly as `mutationMeshTranslations` does for a
   * moved element.
   *
   * Keyed by batch rather than by mutation because the two writes are one
   * gesture: whichever of them the handler reaches first restores the whole
   * shape, and doing it twice is harmless — dropping and re-appending the same
   * meshes is idempotent.
   */
  mutationShapeReplacements: Map<string, RoomShapeReplacement>;
  /**
   * The Qto values a reshape last wrote, per `modelId:expressId`.
   *
   * Undo needs to know whether there was one of OURS before: on the first
   * reshape there was not, and putting the room back means removing the set so
   * the file's own quantities show through again rather than writing a guess.
   */
  mutationShapeQuantities: Map<string, RoomQuantities>;
  /**
   * The model's mutation view, creating and registering one if it has none.
   *
   * Every authoring surface used to do this three-step dance itself — build a
   * `MutablePropertyView`, configure its on-demand extractor, register it — and
   * every surface that FORGOT it got a silent `null` out of `setAttribute` and
   * no mutation. One home, so a new editing surface cannot forget.
   *
   * `null` only when the model has no data store to author against.
   */
  ensureMutationView: (modelId: string) => MutablePropertyView | null;
  /**
   * Put existing elements into an `IfcSystem`, creating it if asked.
   *
   * For the class triage: a group that grouped well on its other attributes
   * and simply has no system can be given one, once, for every member
   * (Marc, 2026-08-15). Emits one `IfcRelAssignsToGroup` for the whole set
   * rather than one per element — that is what the relationship is for.
   */
  assignElementsToSystem: (
    modelId: string,
    expressIds: readonly number[],
    target: { existingId: number } | { name: string },
  ) => { systemId: number } | { error: string };

  /**
   * Define existing elements by an `IfcXxxType`, creating it if asked.
   *
   * The type class is derived from the elements' CURRENT class, so this must
   * run after any retype — see `lib/classTriage/groupAssignment`.
   */
  /**
   * Write a door number onto each door and relate it to the rooms it joins.
   *
   * One action rather than a loop of `setAttribute` calls in the panel: the
   * number and the two boundaries are one statement about the door, and half
   * of it in the file would be worse than none.
   */
  numberDoors: (
    modelId: string,
    entries: readonly {
      doorId: number;
      number: string;
      roomId: number;
      otherRoomId: number | null;
    }[],
  ) => {
    numbered: number;
    boundaries: number;
    /** Why some numbers were not written, when some were not. */
    refused: string | null;
  } | { error: string };

  defineElementsByType: (
    modelId: string,
    expressIds: readonly number[],
    target: { existingId: number } | { name: string },
  ) => { typeId: number } | { error: string };

  /**
   * Whether the active discipline role may change this entity.
   *
   * A role authors a discipline model: it adds. Anything it did not create
   * belongs to the reference model and is refused, so an accidental edit is
   * caught where it happens instead of surfacing later as an unexplained
   * difference in somebody else's model. The Standard role keeps full access —
   * correcting the reference IS sometimes the job, and that wants a mode chosen
   * on purpose. Refusing returns the reason so callers can say why.
   */
  canAuthorOn: (modelId: string, expressId: number) => EditPermission;
  /**
   * Build one Meldergruppe per Auslösezone: an `IfcDistributionCircuit` of the
   * detectors standing in that zone's rooms, aggregated under the active
   * installation, each detector marked `<Zone>.<nn>`.
   *
   * Derived rather than painted: which rooms belong together is a judgement
   * (the zone), which detectors follow from it is not. Re-running is the
   * ordinary way to work — a detector already in its group keeps its mark.
   */
  buildDetectorCircuits: (
    modelId: string,
  ) => { plan: CircuitPlan; created: number; marked: number } | { error: string };
  /**
   * Wire a run: ports, connections, the circuit, and the marks.
   *
   * The order is the input and cannot be derived — which detector hangs where
   * on the cable is a decision, not a consequence. Everything else follows
   * from it: each device gets an IN and an OUT port nested under it
   * (`IfcRelNests`, the IFC4 way), consecutive devices are joined with
   * `IfcRelConnectsPorts`, and the whole run is asserted as one
   * `IfcDistributionCircuit` so "which run is this on" stays one lookup rather
   * than a traversal that breaks on the first missing hop.
   *
   * The mark's counter IS the position on the cable, so re-wiring renumbers.
   */
  wireCircuit: (
    modelId: string,
    input: {
      /** Devices in wiring order. Without the controller. */
      readonly deviceIds: readonly number[];
      /** The controller the run hangs on, or `null` to have one created. */
      readonly controllerId?: number | null;
      /** Storey-local metres. Used only when a controller has to be created. */
      readonly controllerPosition?: readonly [number, number, number];
      /** Close the run back to its controller. */
      readonly ring?: boolean;
      /** Run name. Defaults to the next free `MK<nn>`. */
      readonly name?: string;
    },
  ) => {
    plan: WirePlan;
    circuitId: number;
    controllerId: number;
    controllerCreated: boolean;
    portsCreated: number;
    connections: number;
  } | { error: string };
  /**
   * Place the installation's alarm panel when the model has none.
   *
   * A detection installation without its panel is a set of detectors reporting
   * to nothing, and the omission is invisible — every device looks right. The
   * spot is a guess by room name (ground floor, by the entrance) and says so;
   * the existence is the part that must not be forgotten.
   */
  ensureAlarmPanel: (
    modelId: string,
  ) => { panelId: number; created: boolean; reason: string } | { error: string };
  /**
   * Give every Auslösezone a line controller to hang its runs off.
   *
   * A run has to start somewhere, and in a real installation the module is
   * mounted before anybody pulls cable. Placing them per zone up front is what
   * lets the wiring tool be used the way it is meant to be — click the module,
   * then the detectors — instead of having one invented at the first click.
   *
   * A zone that already has one is left alone, so this can be re-run.
   */
  ensureLineControllers: (
    modelId: string,
  ) => { created: number; skipped: number; zonesWithoutRoom: number } | { error: string };
  /**
   * Replace a room's outline, keeping the room.
   *
   * A wall comes out and the room behind it should grow into the space. The
   * alternative — delete and redraw — loses the room's number, the zone it is
   * painted into and the detectors contained in it, because every one of those
   * is a relationship pointing at this express id.
   *
   * `outline` is in storey-local metres. Quantities are rewritten from the new
   * polygon, each in the unit its own measure type is declared in.
   */
  reshapeSpace: (
    modelId: string,
    expressId: number,
    outline: ReadonlyArray<{ x: number; y: number }>,
  ) => { area: number; height: number } | { error: string };
  /** Add a free-standing IfcSensor (fire detector, etc.) anchored to a storey. */
  addSensor: (
    modelId: string,
    storeyExpressId: number,
    params: SensorInStoreParams
  ) => { expressId: number } | { error: string };
  /**
   * Commit a drawing mark as an `IfcAnnotation` on a storey.
   *
   * The 2D markup tools produce marks that live in the viewer session. This
   * turns one of them into model content — so it survives, exports, and reaches
   * whoever opens the file next — without removing the mark, which stays where
   * it was drawn. Keeping both is the point: the same note is often wanted as
   * a working scribble first and as a deliverable later, and having to decide
   * up front is what makes markup tools annoying.
   */
  addAnnotation: (
    modelId: string,
    storeyExpressId: number,
    params: AnnotationInStoreParams
  ) => { expressId: number } | { error: string };
  /**
   * Add a free-standing element of any catalog-selected IFC entity, anchored
   * to a storey. Also finds-or-creates a shared `IfcXxxType` for the catalog
   * entry and links the new element to it via `IfcRelDefinesByType`.
   *
   * The catalogue id lives on the Type's `ElementType`, which is the IFC field
   * for exactly this — a free-text sub-type label — and is what later
   * placements match on to reuse the Type instead of duplicating attributes
   * per instance. `Tag` carries the SHORT designation (`RM`, `HFM`) because
   * that is what an asset identifier and a drawing want; it used to carry the
   * id, which is how identifiers ended up reading
   * `..._fire.smoke-detector.001`.
   */
  addLibraryElement: (
    modelId: string,
    storeyExpressId: number,
    params: LibraryElementInStoreParams & {
      Discipline: CatalogEntry['discipline'];
      CatalogEntryId: string;
      /** The product's short designation — `RM`, `WM`, `HFM`. */
      CatalogEntryTag?: string;
      TechnicalData?: CatalogEntry['technicalData'];
      /**
       * The product's type AAS, when the catalog entry names one. Written onto
       * the shared `IfcXxxType` as `AAS_PSet_Connector`, so the model addresses
       * the product data instead of only copying it.
       */
      Aas?: CatalogEntry['aas'];
    }
  ) => { expressId: number } | { error: string };
  /**
   * The same, from an imported plan instead of from walls.
   *
   * Segments must already be in the model's own metre frame — placing an
   * underlay is what puts them there. Rooms come out at the drawn wall faces
   * rather than at wall centrelines, so they carry no gross area and no space
   * boundaries; see `generate-spaces-from-drawing.ts` for why.
   */
  generateSpacesFromDrawing: (
    modelId: string,
    storeyExpressId: number,
    segments: AutoSpaceSegment[],
    options?: GenerateSpacesFromDrawingOptions,
  ) => GenerateSpacesFromDrawingResult | { error: string };
}

/** Initial state of the fork's mutation records. */
export function createForkMutationState(): Pick<ForkMutationSlice, 'mutationShapeReplacements' | 'mutationShapeQuantities'> {
  return { mutationShapeReplacements: new Map(), mutationShapeQuantities: new Map() };
}

type ForkActions = Omit<ForkMutationSlice, 'mutationShapeReplacements' | 'mutationShapeQuantities'>;

/** The fork's actions, created with the slice's own `set`/`get`. */
export function createForkMutationActions(set: SetState, get: () => ViewerState): ForkActions {
  return {
  ensureMutationView: (modelId) => {
    // Upstream's write path creates and registers the view on demand.
    const state = get();
    return state.mutationViews.get(modelId) ?? modelEditTarget(state, modelId)?.view ?? null;
  },

  canAuthorOn: (modelId, expressId) => {
    // Normalised so a missing or unrecognised id lands on read-only rather than
    // in the discipline branch, which would refuse with a message about a
    // Fachrolle nobody selected.
    const activeSystemId = normalizeRoleId(get().activeDisciplineSystemId);
    const system = findDisciplineSystem(activeSystemId);
    // Both base roles answer without knowing the entity — Editor permits
    // everything, Viewer permits nothing — so skip the ownership lookup
    // entirely; this runs ahead of every mutation.
    if (!system) return mayEditEntity({ activeSystemId, isAuthored: false });

    // "Authored" is decided by the overlay, not by express-id ranges: an id
    // above the file's watermark is a good hint but not a guarantee once
    // snapshots restore ids allocated in an earlier session. Called
    // defensively because callers may hold a partial view.
    const view = get().mutationViews.get(modelId);
    return mayEditEntity({
      activeSystemId,
      isAuthored: view?.getNewEntity?.(expressId) != null,
      roleLabel: disciplineSystemName(system),
    });
  },

  assignElementsToSystem: (modelId, expressIds, target) => runGroupRelation(
    get, set, modelId, expressIds, 'System zuweisen',
    (editor, anchor) => {
      const systemId = 'existingId' in target
        ? target.existingId
        // IfcDistributionSystem and not a bare IfcSystem: it is the class the
        // rest of this app already creates and finds, so a system made here is
        // the same kind of thing as one made by placing a library element.
        : addDistributionSystemToStore(editor, anchor.ownerHistoryId, {
          PredefinedType: 'NOTDEFINED', Name: target.name.trim(),
        }, anchor.guidRandom).systemId;
      emitRelAssignsToGroup(
        editor, anchor.ownerHistoryId, expressIds, systemId, anchor.guidRandom,
      );
      return { systemId };
    },
  ),

  numberDoors: (modelId, entries) => runGroupRelation(
    get, set, modelId, entries.map((e) => e.doorId), 'Türnummern schreiben',
    (editor, anchor) => {
      let numbered = 0;
      let boundaries = 0;
      let refused: string | null = null;
      for (const entry of entries) {
        // The number goes in `Name`: `doorReference` reads that first, so the
        // plan shows it the moment it is written (Marc, 2026-08-13).
        if (get().setAttribute(modelId, entry.doorId, 'Name', entry.number)) {
          numbered += 1;
        } else {
          // A refused write is not a smaller success. Without this the action
          // reported "42 Raumbezüge angelegt" while every NUMBER had been
          // turned down — the boundaries go through the editor and do not ask
          // the same question — and the only visible symptom was a plan that
          // kept showing the old door marks.
          const permission = get().canAuthorOn(modelId, entry.doorId);
          refused ??= permission.allowed
            ? 'Das Schreiben der Türnummer wurde abgelehnt'
            : permission.reason;
        }
        // A boundary per room, so the door is findable from both sides. The
        // room the number came from is INTERNAL to a second room where there
        // is one, and EXTERNAL where the door leads outside.
        addSpaceBoundaryToStore(editor, anchor, {
          spaceId: entry.roomId,
          elementId: entry.doorId,
          internalOrExternal: entry.otherRoomId === null ? 'EXTERNAL' : 'INTERNAL',
          name: entry.number,
        });
        boundaries += 1;
        if (entry.otherRoomId !== null) {
          addSpaceBoundaryToStore(editor, anchor, {
            spaceId: entry.otherRoomId,
            elementId: entry.doorId,
            internalOrExternal: 'INTERNAL',
            name: entry.number,
          });
          boundaries += 1;
        }
      }
      if (refused !== null && numbered === 0) throw new Error(refused);
      return { numbered, boundaries, refused };
    },
  ),

  defineElementsByType: (modelId, expressIds, target) => runGroupRelation(
    get, set, modelId, expressIds, 'Typ zuweisen',
    (editor, anchor) => {
      let typeId: number;
      if ('existingId' in target) {
        typeId = target.existingId;
      } else {
        // Derived from what the elements ARE right now, which is why the
        // caller has to have written any retype first.
        const store = get().models.get(modelId)?.ifcDataStore;
        const current = store?.entities?.getTypeName(expressIds[0]);
        const typeClass = current ? typeClassFor(current) : null;
        if (!typeClass) throw new Error(`${current ?? 'Diese Klasse'} hat keine Typ-Klasse im Schema`);
        typeId = addLibraryTypeToStore(editor, anchor, {
          IfcEntity: typeClass, Name: target.name.trim(),
        }).typeId;
      }
      emitRelDefinesByType(
        editor, anchor.ownerHistoryId, expressIds, typeId, anchor.guidRandom,
      );
      return { typeId };
    },
  ),

  addLibraryElement: (modelId, storeyExpressId, params) => {
    const { Discipline, CatalogEntryId, CatalogEntryTag, TechnicalData, Aas, ...ifcParams } = params;
    return runForkElementBuilder(
      get, set, modelId, storeyExpressId, ifcParams.IfcEntity.toUpperCase(), `add ${ifcParams.IfcEntity}`,
      (editor, anchor) => {
        // Contain the element in the room it actually sits in, when the model
        // has one there. Falls back to the storey (the previous behaviour) for
        // a corridor, an unmodelled area, or a storey without spaces.
        //
        // The overlay is handed in so rooms created in THIS session count: the
        // ordinary sequence is detect rooms, then place devices into them, and
        // reading only the parsed file put every device in the storey instead.
        const store = get().models.get(modelId)?.ifcDataStore ?? get().ifcDataStore;
        const spaceId = resolveSpaceForPlacement(
          store, storeyExpressId, ifcParams.Position,
          get().mutationViews.get(modelId), get().mutationVersion,
        );
        const elementId = addLibraryElementToStore(editor, anchor, {
          ...ifcParams,
          ContainerId: spaceId ?? undefined,
        }).elementId;

        // Share one IfcXxxType per catalog product across all its placed
        // instances instead of repeating attributes per instance — find an
        // existing Type tagged with this catalog entry's id first (only
        // overlay-created entities can carry our tag convention; a
        // source-authored file wouldn't happen to match it).
        const typeEntity = `${ifcParams.IfcEntity}Type`;
        const view = get().mutationViews.get(modelId);
        let typeId: number | null = null;
        if (view) {
          for (const entity of view.getNewEntities()) {
            // Matched on ElementType (index 8), which is where the catalogue
            // id lives. `Tag` used to be the key and now carries the short
            // designation, which two products may legitimately share.
            if (entity.type === typeEntity && entity.attributes[8] === CatalogEntryId) {
              typeId = entity.expressId;
              break;
            }
          }
        }
        if (typeId === null) {
          typeId = addLibraryTypeToStore(editor, anchor, {
            IfcEntity: typeEntity,
            Name: ifcParams.Name,
            Tag: CatalogEntryTag || CatalogEntryId,
            ElementType: CatalogEntryId,
            PredefinedType: ifcParams.PredefinedType,
            TechnicalData,
          }).typeId;

          // The trade travels as a PROPERTY because it is one: no attribute on
          // `IfcTypeProduct` means "which trade", and borrowing one that means
          // something else would make the file lie to every other reader in
          // exchange for one convenience in the numbering rule. Written here
          // rather than through the builder so `@ifc-lite/create` keeps no
          // opinion about this repository's catalogue.
          const tradeCode = tradeCodeFor(Discipline);
          if (tradeCode) {
            editor.addPropertySet(typeId, TRADE_PSET, [
              { name: TRADE_PROPERTY, value: tradeCode, type: 'LABEL' },
            ]);
          }

          // The link to the product's type AAS, written on the TYPE because
          // that is what it describes: one product, however many placements.
          // The instance link — one physical device, one serial number — is a
          // different link on the occurrence, and it cannot be written here
          // because at placement time no such device exists yet.
          //
          // Alongside the trade code rather than through the builder, for the
          // same reason: `@ifc-lite/create` holds no opinion about this
          // repository's catalogue.
          if (Aas?.address) {
            editor.addPropertySet(typeId, AAS_CONNECTOR_PSET, aasConnectorProperties({
              address: Aas.address,
              kind: AAS_KIND.type,
              fetchDate: Aas.fetchDate,
              versionNumber: Aas.versionNumber,
            }));
          }
        }
        emitRelDefinesByType(editor, anchor.ownerHistoryId, [elementId], typeId, anchor.guidRandom);

        joinActiveDisciplineSystem(get, editor, anchor, modelId, elementId);

        return elementId;
      },
      {
        type: 'library',
        params: { Width: ifcParams.Width ?? 0.1, Depth: ifcParams.Depth ?? 0.1, Height: ifcParams.Height ?? 0.05 },
        position: ifcParams.Position,
        ifcEntity: ifcParams.IfcEntity,
        discipline: Discipline,
      },
    );
  },

  reshapeSpace: (modelId, expressId, outline) => {
    const mayCreate = mayCreateEntities(normalizeRoleId(get().activeDisciplineSystemId));
    if (!mayCreate.allowed) return { error: mayCreate.reason };
    // A room is REFERENCE-model content, and a discipline role may not touch
    // it — the same gate every other edit passes through. Checked here, up
    // front, because the write below goes through `setPositionalAttribute`,
    // which enforces it by returning null: silently, and after the profile has
    // already been emitted. That is what made a reshape on the Branddetektion
    // role look like it had worked and change nothing.
    const mayEdit = get().canAuthorOn(modelId, expressId);
    if (!mayEdit.allowed) return { error: mayEdit.reason };
    if (!get().canCollabEdit()) {
      return { error: 'Editing is disabled for your role in this shared session' };
    }
    const dataStore = get().models.get(modelId)?.ifcDataStore;
    if (!dataStore) return { error: `No model loaded for id "${modelId}"` };
    if (!get().ensureMutationView(modelId)) {
      return { error: 'Model has no editable mutation view yet' };
    }
    const view = get().mutationViews.get(modelId);
    const editor = getOrCreateStoreEditor(get, set, modelId);
    if (!view || !editor) return { error: 'Failed to create store editor' };

    const storeyId = dataStore.spatialHierarchy?.elementToStorey.get(expressId);
    if (storeyId === undefined) {
      return { error: 'Der Raum hängt an keinem Geschoss.' };
    }

    let result: ReturnType<typeof reshapeRoomOutline>;
    try {
      ensureStoreyPlacement(dataStore, editor, storeyId);
      result = reshapeRoomOutline(
        dataStore, view, editor, expressId, outline, getModelLengthUnitScale(dataStore),
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Umformen fehlgeschlagen' };
    }
    if ('error' in result) return result;

    // The shape itself goes through the undoable batch path, so one Ctrl+Z
    // points the solid back at its previous profile — which is still in the
    // overlay, untouched, and therefore restores the outline exactly.
    const shapeBatchId = get().setPositionalAttributesBatch(modelId, result.writes);

    // Quantities follow the shape, or the room schedule keeps the area the
    // room used to have — a number that looks right and is not. Each in the
    // unit its own measure type is declared in: an imperial file states FOOT
    // and SQUARE FOOT, and they are independent.
    let perimeter = 0;
    for (let i = 0; i < result.outline.length; i += 1) {
      const a = result.outline[i];
      const b = result.outline[(i + 1) % result.outline.length];
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    // What the room said before, so undo can put it back. `null` when this is
    // the first reshape: then undo removes our set and the file's own
    // quantities show through again.
    const previousQuantities = get().mutationShapeQuantities.get(`${modelId}:${expressId}`) ?? null;

    try {
      const anchor = resolveSpatialAnchor(dataStore, storeyId);
      editor.addQuantitySet(expressId, 'Qto_SpaceBaseQuantities', [
        { name: 'GrossFloorArea', value: toNativeArea(anchor, result.area), quantityType: 'AREA' },
        { name: 'NetFloorArea', value: toNativeArea(anchor, result.area), quantityType: 'AREA' },
        { name: 'GrossPerimeter', value: toNativeLength(anchor, perimeter), quantityType: 'LENGTH' },
        { name: 'Height', value: toNativeLength(anchor, result.height), quantityType: 'LENGTH' },
        {
          name: 'GrossVolume',
          value: toNativeVolume(anchor, result.area * result.height),
          quantityType: 'VOLUME',
        },
      ]);
      const written = new Map(get().mutationShapeQuantities);
      written.set(`${modelId}:${expressId}`, {
        area: result.area, perimeter, height: result.height,
      });
      set({ mutationShapeQuantities: written });
    } catch {
      // The shape is already written and correct; a quantity set that could
      // not be attached is worth neither losing the edit nor hiding, so it
      // rides out in the mutation version and the panel's area readout.
    }

    const globalId = toGlobalIdFromModels(get().models, modelId, expressId);
    const storeyElevation =
      dataStore.spatialHierarchy?.storeyElevations?.get(storeyId) ?? 0;
    const mesh = buildElementMesh({
      type: 'space',
      globalId,
      storeyElevation,
      payload: {
        type: 'space',
        params: { Width: 0, Depth: 0, Height: result.height },
        corners: result.outline.map((p) => [p.x, p.y, 0] as [number, number, number]),
      },
    });
    // Swapped in place, keeping the old mesh's identity — see
    // `replaceMeshesForEntity` for why not drop-then-append.
    const removedMeshes = mesh ? get().replaceMeshesForEntity([globalId, expressId], mesh) : [];
    // The renderer keys its own buffers by entity, so it has to be told
    // separately; it drops everything under that id and picks the replacement
    // up from the mesh list on the next rebuild.
    get().setPendingMeshRemovals(new Set([globalId]));

    // Mesh and quantities are not attributes, so the generic undo handlers
    // know nothing about them. Recorded here for the same reason a moved
    // element records its mesh translation — see `mutationShapeReplacements`.
    if (shapeBatchId && mesh) {
      const replacements = new Map(get().mutationShapeReplacements);
      replacements.set(shapeBatchId, {
        modelId,
        globalId,
        expressId,
        before: removedMeshes,
        after: [mesh],
        beforeQuantities: previousQuantities,
        afterQuantities: { area: result.area, perimeter, height: result.height },
      });
      set({ mutationShapeReplacements: replacements });
    }

    set((state) => ({
      dirtyModels: new Set(state.dirtyModels).add(modelId),
      mutationVersion: state.mutationVersion + 1,
    }));

    return { area: result.area, height: result.height };
  },

  buildDetectorCircuits: (modelId) => {
    const state = get();
    const view = state.mutationViews.get(modelId);
    const dataStore = state.models.get(modelId)?.ifcDataStore;
    if (!dataStore) return { error: `No model loaded for id "${modelId}"` };

    const system = findDisciplineSystem(state.activeDisciplineSystemId);
    if (!system) {
      return { error: 'Keine Anlage aktiv — auf die Rolle der Installation wechseln (z.B. Branddetektion).' };
    }

    const entities = view ? authoredEntities(view) : [];
    // Only the zones of the theme this installation triggers on. A room is in
    // one fire compartment AND one Auslösezone, and building groups from both
    // would put every detector in two.
    const theme = system.objectType === 'GasDetection' ? 'gas-trigger' : 'fire-trigger';
    // The file's zones AND this session's. Reading only the session was a real
    // defect, and an invisible one: zones painted, exported and reloaded are
    // parsed from then on, so the panel reported "keine Auslösezone gefunden"
    // on a model that visibly had eighteen of them. Writing stays restricted
    // to the session — see `readZonesForDisplay`; only READING is widened.
    const zones = readZonesForDisplay(
      parsedZonesOf(dataStore, RelationshipType.AssignsToGroup),
      readZones(entities),
    )
      .filter((zone) => themeOfZone(zone.objectType)?.id === theme)
      .map((zone) => ({ expressId: zone.expressId, name: zone.name, memberIds: zone.memberIds }));
    if (zones.length === 0) {
      return { error: 'Keine Auslösezone gefunden — zuerst Zonen anlegen und Räume hineinmalen.' };
    }

    // The detectors, with the room each stands in — EVERY device in the model,
    // not only the ones a room contains.
    //
    // `bySpace` was the only source here, and it made the number that matters
    // wrong in the one direction that hurts. A device hung on the storey
    // instead of a room is absent from `bySpace` entirely, so it was neither
    // grouped nor counted as ungrouped: it simply did not exist. Measured on a
    // real model — the panel reported one detector without a zone where there
    // were two, and the missing one was the one with no room at all, which is
    // exactly the case somebody needs to be told about before handover. Its
    // asset identifier even shows the hole (`LM.._FST.RM.001`).
    //
    // `roomId: null` is a case `planCircuits` already handles: such a device
    // joins no group and lands in `ungrouped`.
    const bySpace = dataStore.spatialHierarchy?.bySpace;
    const roomOf = new Map<number, number>();
    for (const [roomId, elementIds] of bySpace ?? []) {
      for (const id of elementIds) if (!roomOf.has(id)) roomOf.set(id, roomId);
    }
    const overlayTypes = new Map<number, string>();
    for (const entity of entities) overlayTypes.set(entity.expressId, entity.type);
    const devices: Array<{ id: number; roomId: number | null }> = [];
    const seen = new Set<number>();
    const consider = (id: number, typeName: string) => {
      if (seen.has(id) || !isDeviceType(typeName)) return;
      seen.add(id);
      devices.push({ id, roomId: roomOf.get(id) ?? null });
    };
    for (const [stepType, ids] of dataStore.entityIndex?.byType ?? []) {
      // `byType` is keyed by the file's raw STEP token; `getTypeName` gives the
      // EXPRESS spelling `isDeviceType` knows. Resolving per entity is what the
      // overlay path needs anyway, and the device classes are a small slice.
      for (const id of ids) {
        if (view?.isDeleted?.(id)) continue;
        consider(id, dataStore.entities?.getTypeName?.(id) || stepType);
      }
    }
    for (const entity of entities) consider(entity.expressId, entity.type);

    // Same widening, same reason — but the ownership test is stricter. A
    // circuit is only "ours" if it carries the ObjectType this tool writes;
    // any other IfcDistributionCircuit in the file belongs to somebody else
    // and must not be extended. Without this, the second run after a reload
    // built a duplicate group for every zone.
    const circuits = mergeOwnCircuits(
      parsedCircuitsOf(dataStore, RelationshipType.AssignsToGroup, CIRCUIT_OBJECT_TYPE, 'IFCGROUP'),
      readCircuits(entities, CIRCUIT_OBJECT_TYPE),
    );
    const plan = planCircuits({ zones, devices, circuits });

    const touched = plan.entries.flatMap((entry) => entry.deviceIds);
    if (touched.length === 0) {
      return { error: 'In den Auslösezonen steht kein Melder.' };
    }

    const result = runGroupRelation(
      get, set, modelId, touched, 'build detector circuits',
      (editor, anchor) => {
        // The session's system, then the file's, then a new one. Skipping the
        // middle step is what produced a second `Fire - Branddetektion` on
        // every reopened model — see `parsedDisciplineSystemOf`.
        const systemId = findDistributionSystem(
          get().mutationViews.get(modelId)?.getNewEntities() ?? [],
          system.predefinedType, system.objectType,
        ) ?? parsedDisciplineSystemOf(dataStore, system)
        ?? addDistributionSystemToStore(editor, anchor.ownerHistoryId, {
          PredefinedType: system.predefinedType,
          ObjectType: system.objectType,
          Name: disciplineSystemName(system),
        }, anchor.guidRandom).systemId;

        let created = 0;
        for (const entry of plan.entries) {
          let circuitId: number;
          if (entry.circuitId !== null) {
            circuitId = entry.circuitId;
          } else {
            // A plain `IfcGroup`, and no aggregation under the installation.
            // Both changes say the same thing: a Meldergruppe states that
            // these detectors trigger together, and nothing at all about how
            // they are wired. As an `IfcDistributionCircuit` aggregated under
            // the system it claimed to be a switched partition of the
            // installation — a cabling statement nobody had drawn. The wiring
            // now lives in `lib/wiring`, where somebody actually draws it.
            circuitId = addDistributionGroupToStore(editor, anchor.ownerHistoryId, {
              Name: entry.name,
              ObjectType: CIRCUIT_OBJECT_TYPE,
            }, anchor.guidRandom).groupId;
            created += 1;
          }

          const existing = readCircuits(
            authoredEntities(get().mutationViews.get(modelId)!), CIRCUIT_OBJECT_TYPE,
          ).find((c) => c.expressId === circuitId);
          const members = entry.deviceIds.map((id) => `#${id}`);
          if (existing?.relExpressId != null) {
            editor.setPositionalAttribute(existing.relExpressId, 4, members);
          } else {
            emitRelAssignsToGroup(editor, anchor.ownerHistoryId, entry.deviceIds, circuitId, anchor.guidRandom);
          }
        }
        // Nothing is marked here any more. The counter in a device's mark is
        // its POSITION ON THE CABLE, and only the wiring knows that — a second
        // counter derived from a zone would put two different numbers on one
        // detector and let whichever ran last win.
        return { created, marked: 0 };
      },
    );

    if ('error' in result) return result;
    return { plan, created: result.created, marked: result.marked };
  },

  wireCircuit: (modelId, input) => {
    const state = get();
    const dataStore = state.models.get(modelId)?.ifcDataStore;
    if (!dataStore) return { error: `No model loaded for id "${modelId}"` };

    const system = findDisciplineSystem(state.activeDisciplineSystemId);
    if (!system) {
      return { error: 'Keine Anlage aktiv — auf die Rolle der Installation wechseln (z.B. Branddetektion).' };
    }
    if (input.deviceIds.length === 0) return { error: 'Kein Gerät im Kreis.' };

    const view = state.mutationViews.get(modelId);
    const entities = view ? authoredEntities(view) : [];

    // Runs this tool already wrote, from the file and from the session. The
    // name decides the next free one, the members decide what is already
    // spoken for — a detector on two lines is a fault at the panel.
    const runs = mergeOwnCircuits(
      parsedCircuitsOf(
        dataStore, RelationshipType.AssignsToGroup, RUN_OBJECT_TYPE, 'IFCDISTRIBUTIONCIRCUIT',
      ),
      readCircuits(entities, RUN_OBJECT_TYPE, 'IfcDistributionCircuit'),
    );
    const name = input.name ?? nextRunName(runs.map((r) => r.name));
    const existing = runs.find((r) => r.name === name) ?? null;
    const alreadyWired = new Set<number>();
    for (const run of runs) {
      if (run.name === name) continue;
      for (const id of run.memberIds) alreadyWired.add(id);
    }

    // A controller may have to be made, and it must exist before the plan is
    // built — the plan numbers from it. Deferred into the editor callback
    // because that is the only place an express id can be minted.
    let plan: WirePlan | null = null;
    let controllerCreated = false;
    let portsCreated = 0;

    const result = runGroupRelation(
      get, set, modelId, input.deviceIds, 'wire circuit',
      (editor, controllerAnchor) => {
        let controllerId = input.controllerId ?? null;
        if (controllerId == null) {
          // Where a created line module goes: with the first device on the
          // run, in the room that device stands in.
          //
          // Not the model origin, which is where it landed first and where
          // nobody would ever look for it. The footprint centroid comes from
          // `spacesByStorey`, the same reader `resolveSpaceForPlacement` and
          // the panel placement use — so all three agree on the frame, and a
          // module dropped here is in the same coordinate space as the
          // detectors it feeds.
          const firstDevice = input.deviceIds[0];
          const roomOfFirst = firstDevice !== undefined
            ? [...(dataStore.spatialHierarchy?.bySpace ?? [])]
              .find(([, ids]) => ids.includes(firstDevice))?.[0]
            : undefined;
          const roomFootprint = roomOfFirst !== undefined
            ? [...spacesByStorey(dataStore, view, get().mutationVersion).values()]
              .flat().find((entry) => entry.spaceExpressId === roomOfFirst)?.polygon
            : undefined;
          const site = roomFootprint && roomFootprint.length > 0
            ? roomFootprint.reduce(
              (acc, point) => ({
                x: acc.x + point[0] / roomFootprint.length,
                y: acc.y + point[1] / roomFootprint.length,
              }),
              { x: 0, y: 0 },
            )
            : null;
          const position = input.controllerPosition
            ? ([...input.controllerPosition] as [number, number, number])
            : site
              ? ([site.x, site.y, PANEL_MOUNTING_HEIGHT_M] as [number, number, number])
              : ([0, 0, PANEL_MOUNTING_HEIGHT_M] as [number, number, number]);
          controllerId = addControllerToStore(editor, controllerAnchor, {
            Position: position,
            Name: `Linienmodul ${name}`,
            // The trade, on the same attribute the installation carries it
            // on — a controller reads as fire detection or intrusion the
            // same way its system does.
            ObjectType: system.objectType,
            PredefinedType: 'PROGRAMMABLE',
            Tag: name,
          }).elementId;
          controllerCreated = true;
        }

        const sequence = [
          controllerId,
          ...input.deviceIds,
          ...(input.ring ? [controllerId] : []),
        ];
        plan = planWiring({ sequence, circuitName: name, alreadyWired });

        // Ports: one IN and one OUT per participant, nested under it. Made for
        // every device on the run including the controller, because a hop
        // needs an end at both sides.
        const portsOf = new Map<number, { inPortId: number; outPortId: number }>();
        const ensurePorts = (expressId: number, role: 'head' | 'passThrough') => {
          const held = portsOf.get(expressId);
          if (held) return held;
          const made = addRunPortsToStore(
            editor, controllerAnchor.ownerHistoryId, expressId,
            {
              systemType: system.predefinedType,
              role,
              schema: controllerAnchor.schema ?? 'IFC4',
            },
            controllerAnchor.guidRandom,
          );
          portsCreated += 2;
          portsOf.set(expressId, made);
          return made;
        };
        // The controller feeds the line; everything on it passes through.
        ensurePorts(controllerId, 'head');
        for (const stop of plan.stops) ensurePorts(stop.expressId, 'passThrough');

        let connections = 0;
        for (const hop of plan.hops) {
          const from = portsOf.get(hop.fromExpressId);
          const to = portsOf.get(hop.toExpressId);
          if (!from || !to) continue;
          // OUT of the one, IN of the next — that ordering is what makes the
          // run walkable in the direction the cable was pulled.
          emitRelConnectsPorts(
            editor, controllerAnchor.ownerHistoryId, from.outPortId, to.inPortId,
            { name },
            controllerAnchor.guidRandom,
          );
          connections += 1;
        }

        // The circuit: asserted, so "which run is this on" stays one lookup.
        const systemId = findDistributionSystem(
          get().mutationViews.get(modelId)?.getNewEntities() ?? [],
          system.predefinedType, system.objectType,
        ) ?? parsedDisciplineSystemOf(dataStore, system)
        ?? addDistributionSystemToStore(editor, controllerAnchor.ownerHistoryId, {
          PredefinedType: system.predefinedType,
          ObjectType: system.objectType,
          Name: disciplineSystemName(system),
        }, controllerAnchor.guidRandom).systemId;

        let circuitId: number;
        if (existing) {
          circuitId = existing.expressId;
        } else {
          circuitId = addDistributionCircuitToStore(editor, controllerAnchor.ownerHistoryId, {
            Name: name,
            ObjectType: RUN_OBJECT_TYPE,
            PredefinedType: system.predefinedType,
          }, controllerAnchor.guidRandom).circuitId;
          emitRelAggregates(editor, controllerAnchor.ownerHistoryId, systemId, [circuitId]);
        }

        // The controller belongs to its own run — it is the head of the line,
        // not something outside it — AND to the installation. Only the first
        // was written at one point, and the omission was invisible until the
        // installation chain was drawn: the run was there and its controller
        // was not, because nothing said the controller was part of the system.
        const members = [controllerId, ...plan.stops.map((stop) => stop.expressId)];
        if (controllerCreated) {
          emitRelAssignsToGroup(
            editor, controllerAnchor.ownerHistoryId, [controllerId], systemId, controllerAnchor.guidRandom,
          );
        }
        if (existing?.relExpressId != null) {
          editor.setPositionalAttribute(existing.relExpressId, 4, members.map((id) => `#${id}`));
        } else {
          emitRelAssignsToGroup(
            editor, controllerAnchor.ownerHistoryId, members, circuitId, controllerAnchor.guidRandom,
          );
        }

        // The mark IS the position on the cable, so this overwrites rather
        // than continues. Re-wiring renumbers; that is the point.
        for (const stop of plan.stops) editor.setAttribute(stop.expressId, 'Tag', stop.mark);

        return { circuitId, controllerId, connections };
      },
    );

    if ('error' in result) return result;
    if (!plan) return { error: 'Verkabelung konnte nicht geplant werden' };
    return {
      plan,
      circuitId: result.circuitId,
      controllerId: result.controllerId,
      controllerCreated,
      portsCreated,
      connections: result.connections,
    };
  },

  ensureLineControllers: (modelId) => {
    const state = get();
    const dataStore = state.models.get(modelId)?.ifcDataStore;
    if (!dataStore) return { error: `No model loaded for id "${modelId}"` };

    const system = findDisciplineSystem(state.activeDisciplineSystemId);
    if (!system) {
      return { error: 'Keine Anlage aktiv — auf die Rolle der Installation wechseln.' };
    }

    const view = state.mutationViews.get(modelId);
    const entities = view ? authoredEntities(view) : [];

    // The zones this installation triggers on — file and session, the same
    // widened reading the detector groups use.
    const theme = system.objectType === 'GasDetection' ? 'gas-trigger' : 'fire-trigger';
    const zones = readZonesForDisplay(
      parsedZonesOf(dataStore, RelationshipType.AssignsToGroup),
      readZones(entities),
    ).filter((zone) => themeOfZone(zone.objectType)?.id === theme);
    if (zones.length === 0) {
      return { error: 'Keine Auslösezone gefunden — zuerst Zonen anlegen und Räume hineinmalen.' };
    }

    // Modules already there, by the zone they are named for. `Tag` carries the
    // zone name, which is what makes this re-runnable: a second pass finds its
    // own work rather than doubling it.
    const taken = new Set<string>();
    for (const entity of entities) {
      if (entity.type !== 'IfcController') continue;
      const tag = entity.attributes[7];
      if (typeof tag === 'string' && tag) taken.add(tag);
    }
    for (const expressId of dataStore.entityIndex?.byType?.get('IFCCONTROLLER') ?? []) {
      const tag = dataStore.entities?.getTag?.(expressId);
      if (tag) taken.add(tag);
    }

    const footprints = spacesByStorey(dataStore, view, state.mutationVersion);
    const storeyOfRoom = new Map<number, number>();
    for (const [storeyId, rooms] of footprints) {
      for (const room of rooms) storeyOfRoom.set(room.spaceExpressId, storeyId);
    }

    let created = 0;
    let skipped = 0;
    let zonesWithoutRoom = 0;

    for (const zone of zones) {
      if (taken.has(zone.name)) { skipped += 1; continue; }
      // The zone's first room decides where the module goes. Arbitrary among
      // the zone's rooms and deliberately so — it is a starting point somebody
      // drags, and putting it in the zone is the part that matters.
      const roomId = [...zone.memberIds].sort((a, b) => a - b)
        .find((id) => storeyOfRoom.has(id));
      if (roomId === undefined) { zonesWithoutRoom += 1; continue; }
      const storeyId = storeyOfRoom.get(roomId);
      if (storeyId === undefined) { zonesWithoutRoom += 1; continue; }
      const polygon = footprints.get(storeyId)
        ?.find((entry) => entry.spaceExpressId === roomId)?.polygon;
      if (!polygon || polygon.length === 0) { zonesWithoutRoom += 1; continue; }
      const centre = polygon.reduce(
        (acc, point) => ({
          x: acc.x + point[0] / polygon.length,
          y: acc.y + point[1] / polygon.length,
        }),
        { x: 0, y: 0 },
      );

      const result = runForkElementBuilder(
        get, set, modelId, storeyId, 'IFCCONTROLLER', 'place line controller',
        (editor, anchor) => {
          const controllerId = addControllerToStore(editor, anchor, {
            Position: [centre.x, centre.y, PANEL_MOUNTING_HEIGHT_M],
            Name: `Linienmodul ${zone.name}`,
            ObjectType: system.objectType,
            PredefinedType: 'PROGRAMMABLE',
            Tag: zone.name,
            ContainerId: roomId,
          }).elementId;
          joinActiveDisciplineSystem(get, editor, anchor, modelId, controllerId);
          return controllerId;
        },
        {
          type: 'sensor',
          params: { Width: 0.2, Depth: 0.12, Height: 0.25, PredefinedType: 'NOTDEFINED' },
          position: [centre.x, centre.y, PANEL_MOUNTING_HEIGHT_M],
        },
      );
      if (typeof result === 'object' && result !== null && 'error' in result) return result;
      created += 1;
    }

    return { created, skipped, zonesWithoutRoom };
  },

  ensureAlarmPanel: (modelId) => {
    const state = get();
    const dataStore = state.models.get(modelId)?.ifcDataStore;
    if (!dataStore) return { error: `No model loaded for id "${modelId}"` };

    const system = findDisciplineSystem(state.activeDisciplineSystemId);
    if (!system) {
      return { error: 'Keine Anlage aktiv — auf die Rolle der Installation wechseln.' };
    }

    const view = state.mutationViews.get(modelId);
    const entities = view ? authoredEntities(view) : [];

    // Already there? The file first, then this session. A second panel is
    // worse than none — two boxes each claiming to be THE panel.
    const parsedPanels = dataStore.entityIndex?.byType?.get('IFCUNITARYCONTROLELEMENT') ?? [];
    const existingParsed = parsedPanels.find((id) => !view?.isDeleted?.(id));
    if (existingParsed !== undefined) {
      return { panelId: existingParsed, created: false, reason: 'Zentrale bereits im Modell' };
    }
    const authored = entities.find((e) => e.type === 'IfcUnitaryControlElement');
    if (authored) {
      return { panelId: authored.expressId, created: false, reason: 'Zentrale in dieser Sitzung angelegt' };
    }

    const storeys = (dataStore.entityIndex?.byType?.get('IFCBUILDINGSTOREY') ?? []).map((id) => ({
      expressId: id,
      name: dataStore.entities?.getName?.(id) ?? '',
    }));
    const rooms = (dataStore.entityIndex?.byType?.get('IFCSPACE') ?? []).map((id) => ({
      expressId: id,
      name: dataStore.entities?.getName?.(id) ?? '',
      // No columnar LongName accessor exists; this re-parses the entity, the
      // same path `resolveEntityPredefinedType` takes. Charged once per room
      // in a one-off action. It matters: in a real model the room is NAMED
      // `0.01` and only its LongName says `Vorhalle`.
      longName: resolveEntityLongName(dataStore, id) ?? '',
      storeyId: dataStore.relationships?.getRelated(
        id, RelationshipType.Aggregates, 'inverse',
      )?.[0] ?? -1,
    }));
    const site = findAlarmPanelSite(rooms, storeys);
    if (!site) return { error: 'Das Modell hat kein Geschoss, in dem eine Zentrale stehen könnte' };

    // The room's footprint centroid, read through the SAME reader every
    // placement path uses (`spacesByStorey`), so the panel lands in the frame
    // `addSensor` and `resolveSpaceForPlacement` already agree on.
    //
    // Not the mesh centre. That is what this did first, and it put the panel
    // twenty metres off: `getEntityCenter` answers in the renderer's Y-up
    // metres, where the plan Y is `-z` and `y` is the HEIGHT. Measured on a
    // real model — X landed within 30 cm and Y was the room's mid-height.
    const footprint = site.roomId !== null
      ? spacesByStorey(dataStore, view, get().mutationVersion)
        .get(site.storeyId)?.find((entry) => entry.spaceExpressId === site.roomId)?.polygon
      : undefined;
    // `Vec2` is a tuple, not an object — the footprint is a polygon of
    // `[x, y]` pairs.
    const centre = footprint && footprint.length > 0
      ? footprint.reduce(
        (acc, point) => ({ x: acc.x + point[0] / footprint.length, y: acc.y + point[1] / footprint.length }),
        { x: 0, y: 0 },
      )
      : { x: 0, y: 0 };

    const result = runForkElementBuilder(
      get, set, modelId,
      // The storey the SITE names, not the file's first. `runGroupRelation`
      // anchors on the first storey it finds and says so — "any storey will
      // do" is true for a group and false for something placed. Using it here
      // chained the panel to the basement while its containment named a room
      // on the ground floor: a box below the building, exactly what it looked
      // like.
      site.storeyId,
      'IFCUNITARYCONTROLELEMENT', 'place alarm panel',
      (editor, anchor) => {
        const panelId = addAlarmPanelToStore(editor, anchor, {
          Position: [centre.x, centre.y, PANEL_MOUNTING_HEIGHT_M],
          Name: `Zentrale ${disciplineSystemName(system)}`,
          ObjectType: system.objectType,
          Tag: 'BMZ',
          ContainerId: site.roomId ?? undefined,
        }).elementId;

        const systemId = findDistributionSystem(
          get().mutationViews.get(modelId)?.getNewEntities() ?? [],
          system.predefinedType, system.objectType,
        ) ?? parsedDisciplineSystemOf(dataStore, system)
        ?? addDistributionSystemToStore(editor, anchor.ownerHistoryId, {
          PredefinedType: system.predefinedType,
          ObjectType: system.objectType,
          Name: disciplineSystemName(system),
        }, anchor.guidRandom).systemId;
        emitRelAssignsToGroup(
          editor, anchor.ownerHistoryId, [panelId], systemId, anchor.guidRandom,
        );
        return panelId;
      },
      {
        type: 'sensor',
        params: { Width: 0.5, Depth: 0.15, Height: 0.7, PredefinedType: 'NOTDEFINED' },
        position: [centre.x, centre.y, PANEL_MOUNTING_HEIGHT_M],
      },
    );

    if (typeof result === 'object' && result !== null && 'error' in result) return result;
    return {
      panelId: typeof result === 'number' ? result : (result as { expressId: number }).expressId,
      created: true,
      reason: site.reason,
    };
  },

  addSensor: (modelId, storeyExpressId, params) => runForkElementBuilder(
    get, set, modelId, storeyExpressId, 'IFCSENSOR', 'add sensor',
    (editor, anchor) => {
      // Same rule as addLibraryElement: contain the device in the room it
      // sits in when the model has one there, and fall back to the storey
      // otherwise. Both placement paths have to agree — a detector's
      // containment must not depend on which panel button dropped it.
      const store = get().models.get(modelId)?.ifcDataStore ?? get().ifcDataStore;
      const spaceId = resolveSpaceForPlacement(
        store, storeyExpressId, params.Position,
        get().mutationViews.get(modelId), get().mutationVersion,
      );
      const sensorId = addSensorToStore(editor, anchor, {
        ...params,
        ContainerId: spaceId ?? undefined,
      }).sensorId;
      // Same rule again: a sensor placed under an active discipline role
      // belongs to that installation. Without this a detector dropped as
      // `sensor` sat outside the system that a detector dropped from the
      // library joined — the same device, two different answers.
      joinActiveDisciplineSystem(get, editor, anchor, modelId, sensorId);
      return sensorId;
    },
    {
      type: 'sensor',
      params: { Width: params.Width ?? 0.1, Depth: params.Depth ?? 0.1, Height: params.Height ?? 0.05, PredefinedType: params.PredefinedType ?? 'NOTDEFINED' },
      position: params.Position,
    },
  ),

  addAnnotation: (modelId, storeyExpressId, params) => runForkElementBuilder(
    get, set, modelId, storeyExpressId, 'IFCANNOTATION', 'add annotation',
    (editor, anchor) => addAnnotationToStore(editor, anchor, params).annotationId,
    // No mesh payload: annotation geometry is 2D curves and text in an
    // 'Annotation' representation, and asking the mesher to solidify a note
    // would be asking the wrong question.
  ),

  generateSpacesFromDrawing: (modelId, storeyExpressId, segments, options) => {
    const state = get();
    const model = state.models.get(modelId);
    const dataStore = model?.ifcDataStore;
    if (!dataStore) return { error: `No model loaded for id "${modelId}"` };
    if (!state.mutationViews.get(modelId)) {
      return { error: 'Model has no editable mutation view yet' };
    }

    const editor = getOrCreateStoreEditor(get, set, modelId);
    if (!editor) return { error: 'Failed to create store editor' };

    let result: GenerateSpacesFromDrawingResult;
    try {
      // No overlay reader here, unlike the wall path: the drawing IS the input,
      // so there is no second source of geometry to merge in.
      result = generateSpacesFromDrawing(editor, dataStore, storeyExpressId, segments, options);
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to generate rooms' };
    }

    if (!result.emitted.length) return result;

    set((s) => {
      const newUndoStacks = new Map(s.undoStacks);
      const stack = [...(newUndoStacks.get(modelId) ?? [])];
      const ts = Date.now();
      for (const e of result.emitted) {
        stack.push({
          id: `mut_ifcspace_${e.result.spaceId}_${ts}_${Math.random().toString(36).substring(2, 9)}`,
          type: 'CREATE_ENTITY',
          timestamp: ts,
          modelId,
          entityId: e.result.spaceId,
          attributeName: 'IFCSPACE',
        });
      }
      newUndoStacks.set(modelId, stack);

      const newRedoStacks = new Map(s.redoStacks);
      newRedoStacks.set(modelId, []);

      const newDirty = new Set(s.dirtyModels);
      newDirty.add(modelId);

      return {
        undoStacks: newUndoStacks,
        redoStacks: newRedoStacks,
        dirtyModels: newDirty,
        mutationVersion: s.mutationVersion + 1,
      };
    });

    return result;
  },

  };
}
