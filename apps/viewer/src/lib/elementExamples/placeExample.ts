/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Put a read Elementbeispiel into the model being edited.
 *
 * The sync half of placing one — everything from "the file is parsed" to "the
 * entities are in the overlay". Fetching and parsing happen in the store
 * action around it, so this stays a pure function of an `ExampleModel`, an
 * anchor and a position, and can be tested by reading the STEP it produces.
 *
 * # What lands in the model
 * The FIRST time an example is placed, per product (the device, then each
 * companion):
 *   - its representation(s), copied entity by entity with every express id
 *     renumbered and the source's context replaced by this model's;
 *   - an `IfcRepresentationMap` over each copied representation;
 * plus, for the device, an `IfcXxxType` holding its maps.
 *
 * Every placement, including the first:
 *   - an occurrence per product that shows the map through an `IfcMappedItem`,
 *     placed at the click point and carrying the unit factor;
 *   - the type related to the device with `IfcRelDefinesByType`;
 *   - the companions related to the device with `IfcRelAssignsToProduct`.
 *
 * # One definition, many instances
 * The split above is the point: a library entry is an accessory, like a block
 * in a CAD tool, and the second Handfeuerlöscher in a building is another
 * OCCURRENCE of the first one's definition — not a second definition that
 * happens to look the same. What makes the two placements the same product is
 * `typeKey`; `exampleGeometryReuse.ts` holds what the first one built.
 *
 * # The unit factor, once
 * `source metres-per-unit / target metres-per-unit`. A metre example in a
 * millimetre model gives 1000. It rides on the occurrence's transformation
 * operator rather than being baked into the coordinates, because deciding
 * which attribute of which entity carries a length needs schema knowledge this
 * repository does not have — see `mapped-library-object.ts`.
 */

import {
  addLibraryTypeToStore,
  addMappedOccurrenceToStore,
  addRepresentationMapToStore,
  copySubgraph,
  emitRelAssignsToProduct,
  emitRelDefinesByType,
  type SpatialAnchor,
} from '@ifc-lite/create';
import type { StoreEditor } from '@ifc-lite/mutations';
import { ENTITIES_IFC4 } from '@ifc-lite/data';
import type { ExampleModel, ExampleProduct } from './exampleModel.js';
import {
  findPlacedType,
  rememberExampleGeometry,
  reuseExampleGeometry,
  type ExampleGeometryRecord,
} from './exampleGeometryReuse.js';

export interface PlaceExampleParams {
  /** Where the example's own origin lands, in storey-local metres. */
  position: [number, number, number];
  /** The TARGET model's metres per unit (1 for metres, 0.001 for millimetres). */
  targetLengthUnitScale: number;
  /** Spatial element to contain the occurrences in. Defaults to the storey. */
  containerId?: number;
  /**
   * The library entry's identity — what makes two placements the same product.
   *
   * Written onto the type as `ElementType` and used to find that type again.
   * Built by `lib/catalog/libraryTypeKey.ts`, which borrows the AAS's split
   * between a type's `globalAssetId` and an instance's `specificAssetIds`.
   */
  typeKey: string;
}

export interface PlaceExampleResult {
  /** The placed device. */
  deviceId: number;
  /** Clearances, detection areas, plan symbols — each its own product. */
  companionIds: number[];
  /** The type carrying the shared geometry, when the entity has one. */
  typeId: number | null;
}

/** Memoised `IFCSENSOR` → `IFCSENSORTYPE`, from the schema's own table. */
const typeEntityCache = new Map<string, string | null>();

/**
 * The companion type entity, or `null` where the schema defines none.
 *
 * Asked of the schema rather than assembled by appending `Type`: that rule is
 * right often enough to look correct and wrong where it matters —
 * `IfcAnnotation` and `IfcVirtualElement` have no type entity at all, and a
 * placement that invented `IfcAnnotationType` would fail at the editor's name
 * check with an error about a typo.
 */
function typeEntityFor(entityType: string): string | null {
  const key = entityType.toUpperCase();
  const cached = typeEntityCache.get(key);
  if (cached !== undefined) return cached;
  const info = ENTITIES_IFC4.find((e) => e.name.toUpperCase() === key);
  const resolved = info?.typeEntity ?? null;
  typeEntityCache.set(key, resolved);
  return resolved;
}

/** Copy one product's representations and wrap each in a map. */
function mapsFor(
  editor: StoreEditor,
  model: ExampleModel,
  product: ExampleProduct,
  substitutions: Map<number, number>,
): number[] {
  const maps: number[] = [];
  for (const representation of product.representations) {
    const copied = copySubgraph(editor, model.read, representation.expressId, { substitutions });
    maps.push(addRepresentationMapToStore(editor, { shapeRepresentationId: copied }).mapId);
  }
  return maps;
}

/**
 * The example's definition in this model: reused when it is already there,
 * written once when it is not.
 *
 * A remembered record is only taken when it describes the SAME example — the
 * companion count has to line up, or an example that changed between two
 * placements in one session would place its new clearance against its old
 * symbol. Cheap to check and the only thing that can drift under one key.
 */
function ensureExampleGeometry(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  model: ExampleModel,
  typeKey: string,
): ExampleGeometryRecord {
  const remembered = reuseExampleGeometry(editor, typeKey);
  if (remembered && remembered.companionMapIds.length === model.companions.length) {
    return remembered;
  }

  const typeEntity = typeEntityFor(model.device.type);
  // No note, but the overlay may still hold the type from before a page
  // reload. Its maps are the device's, so only the companions are copied
  // again — see `findPlacedType`.
  const placed = typeEntity ? findPlacedType(editor, typeEntity, typeKey) : null;

  // One substitution map for the whole example, so geometry shared between the
  // device and a companion is copied once — and so the context substitution is
  // stated in a single place.
  //
  // Every representation context of the source maps to this model's BODY
  // context, including an annotation's. The anchor offers no annotation
  // context, and a 2D symbol declared against the body context still draws;
  // declared against a context this file does not have, it would not exist.
  const substitutions = new Map<number, number>(
    model.contextIds.map((id) => [id, anchor.bodyContextId]),
  );
  // The source's owner history needs no substitution: the walk starts at an
  // `IfcShapeRepresentation`, and nothing under a representation refers to one.
  // Only `IfcRoot` subtypes do, and none is copied — the occurrences are built
  // fresh, with this model's.

  const deviceMapIds = placed
    ? placed.deviceMapIds
    : mapsFor(editor, model, model.device, substitutions);
  const companionMapIds = model.companions.map(
    (companion) => mapsFor(editor, model, companion, substitutions),
  );

  const typeId = placed?.typeId ?? (typeEntity
    ? addLibraryTypeToStore(editor, anchor, {
        IfcEntity: typeEntity,
        Name: model.device.name ?? undefined,
        // The identity, in the slot this codebase already uses for a catalogue
        // key — `addLibraryElement` matches its own types on the same one.
        ElementType: typeKey,
        PredefinedType: model.device.predefinedType ?? undefined,
        RepresentationMapIds: deviceMapIds,
      }).typeId
    : null);

  const record: ExampleGeometryRecord = { typeId, deviceMapIds, companionMapIds };
  rememberExampleGeometry(editor, typeKey, record);
  return record;
}

export function placeExampleInStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  model: ExampleModel,
  params: PlaceExampleParams,
): PlaceExampleResult {
  const target = params.targetLengthUnitScale || 1;
  const scale = model.lengthUnitScale / target;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(
      `placeExampleInStore: cannot relate the example's unit (${model.lengthUnitScale}) to the model's (${target})`,
    );
  }

  const { typeId, deviceMapIds, companionMapIds } = ensureExampleGeometry(
    editor, anchor, model, params.typeKey,
  );

  const device = addMappedOccurrenceToStore(editor, anchor, {
    IfcEntity: model.device.type,
    // A product with several representations is shown through the first; the
    // rest stay on the type, where another view can reach them.
    mapId: deviceMapIds[0],
    Position: params.position,
    Scale: scale,
    PredefinedType: model.device.predefinedType ?? undefined,
    ObjectType: model.device.objectType ?? undefined,
    Name: model.device.name ?? undefined,
    Description: model.device.description ?? undefined,
    Tag: model.device.tag ?? undefined,
    ContainerId: params.containerId,
  });

  if (typeId !== null) {
    emitRelDefinesByType(editor, anchor.ownerHistoryId, [device.elementId], typeId, anchor.guidRandom);
  }

  const companionIds: number[] = [];
  for (const [index, companion] of model.companions.entries()) {
    const maps = companionMapIds[index] ?? [];
    if (maps.length === 0) continue;
    const placed = addMappedOccurrenceToStore(editor, anchor, {
      IfcEntity: companion.type,
      mapId: maps[0],
      // The SAME position as the device: a clearance is modelled relative to
      // the object it belongs to, and the example already holds that offset in
      // its own coordinates.
      Position: params.position,
      Scale: scale,
      PredefinedType: companion.predefinedType ?? undefined,
      ObjectType: companion.objectType ?? undefined,
      Name: companion.name ?? undefined,
      ContainerId: params.containerId,
    });
    companionIds.push(placed.elementId);
  }

  if (companionIds.length > 0) {
    emitRelAssignsToProduct(
      editor,
      anchor.ownerHistoryId,
      companionIds,
      device.elementId,
      anchor.guidRandom,
    );
  }

  return { deviceId: device.elementId, companionIds, typeId };
}
