/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Place a library object whose geometry came from ANOTHER file: the geometry
 * once, the occurrences many times, through `IfcMappedItem`.
 *
 * # Why a representation map and not a copy per occurrence
 * Three reasons, and the third is the one that decided it.
 *
 * 1. It is what a representation map is FOR. A library object placed n times
 *    is the textbook case: `IfcRepresentationMap` on the `IfcXxxType`, an
 *    `IfcMappedItem` per occurrence. Every authoring system reads it, and
 *    ifc-lite's renderer has a dedicated path for it with caching and
 *    instancing (`rust/geometry/src/router/mapped_item.rs`).
 * 2. The geometry is written once however many extinguishers stand in the
 *    building, instead of once per occurrence.
 * 3. THE UNITS. A file states one length unit. The source's numbers are in
 *    the SOURCE's unit, and copying them verbatim into a millimetre model
 *    would make a half-metre cylinder half a millimetre tall. Converting them
 *    would mean knowing which attribute of which entity carries a length —
 *    and this repository's schema tables deliberately do not carry attribute
 *    types ("out of scope for the auditor", `ifc-schema/types.ts`). So there
 *    is no general, honest way to scale the numbers themselves.
 *
 *    `IfcCartesianTransformationOperator3D.Scale` is exactly the place IFC
 *    provides for this, and it needs no schema knowledge at all: one factor,
 *    source unit over target unit, on the occurrence. That is not a
 *    workaround — a mapped item's operator is defined to transform its
 *    source, and scaling is one of the things it transforms.
 *
 * # What the caller has already done
 * Copied the source's representation into this model's overlay
 * (`copy-subgraph.ts`), with the source's representation context substituted
 * by this model's. These functions take the resulting
 * `IfcShapeRepresentation` and build the map, the type link and the
 * occurrences around it.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { StoreEditor } from '@ifc-lite/mutations';
import { toNativePoint3, type SpatialAnchor } from './anchor.js';
import {
  emitLocalPlacement,
  emitRelContainedInSpatialStructure,
  ifcElementHeader,
  ownerHistoryRef,
} from './_emit-helpers.js';

export interface RepresentationMapParams {
  /**
   * The `IfcShapeRepresentation` already copied into this model — the 'Body'
   * one, not the `IfcProductDefinitionShape` around it. A representation map
   * maps a REPRESENTATION; handing it the product shape produces a record
   * that validates against nothing.
   */
  shapeRepresentationId: number;
}

/**
 * The shared geometry, as a map anchored at the object's own origin.
 *
 * The mapping origin is the identity placement, deliberately: the source
 * object was modelled around its own insertion point, and moving it here
 * would put a second, invisible offset between what the author drew and what
 * gets placed. Where an occurrence sits is the occurrence's business, and it
 * says so in its `IfcLocalPlacement`.
 */
export function addRepresentationMapToStore(
  editor: StoreEditor,
  params: RepresentationMapParams,
): { mapId: number; originId: number } {
  const point = editor.addEntity('IfcCartesianPoint', [[0, 0, 0]]).expressId;
  const originId = editor.addEntity('IfcAxis2Placement3D', [`#${point}`, null, null]).expressId;
  const mapId = editor.addEntity('IfcRepresentationMap', [
    `#${originId}`,
    `#${params.shapeRepresentationId}`,
  ]).expressId;
  return { mapId, originId };
}

export interface MappedOccurrenceParams {
  /** The IFC entity to emit, e.g. `'IfcFireSuppressionTerminal'`. */
  IfcEntity: string;
  /** The `IfcRepresentationMap` this occurrence shows. */
  mapId: number;
  /** Where the object's own origin lands, in storey-local metres. */
  Position: [number, number, number];
  /**
   * Source length unit over target length unit — metres per source unit
   * divided by metres per target unit.
   *
   * 1 when both files agree. 1000 for a metre source in a millimetre model.
   * See the file doc for why this is a factor on the occurrence and not a
   * conversion of the numbers.
   */
  Scale?: number;
  PredefinedType?: string;
  ObjectType?: string;
  Name?: string;
  Description?: string;
  Tag?: string;
  /** Spatial element the occurrence is contained in. Defaults to the storey. */
  ContainerId?: number;
}

export interface MappedOccurrenceResult {
  elementId: number;
  placementId: number;
  mappedItemId: number;
  shapeRepId: number;
  productShapeId: number;
  relContainedId: number;
  containerId: number;
}

export function addMappedOccurrenceToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: MappedOccurrenceParams,
): MappedOccurrenceResult {
  if (!params.IfcEntity) {
    throw new Error('addMappedOccurrenceToStore: IfcEntity is required');
  }
  const scale = params.Scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`addMappedOccurrenceToStore: Scale must be positive and finite, got ${scale}`);
  }

  const position = toNativePoint3(anchor, params.Position);
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, position);

  // The operator carries the unit factor and nothing else: axes omitted means
  // the identity rotation, and the local origin is the map's own origin. The
  // occurrence's POSITION is in the placement above, not here — keeping the
  // two apart is what lets a reader move the object by editing one placement.
  const operatorOrigin = editor.addEntity('IfcCartesianPoint', [[0, 0, 0]]).expressId;
  const operatorId = editor.addEntity('IfcCartesianTransformationOperator3D', [
    null, // Axis1
    null, // Axis2
    `#${operatorOrigin}`, // LocalOrigin
    // `{ real }` forces a decimal point: `1` would serialise as a STEP
    // INTEGER, and `IfcCartesianTransformationOperator3D.Scale` is a REAL.
    { real: scale },
    null, // Axis3
  ]).expressId;

  const mappedItemId = editor.addEntity('IfcMappedItem', [
    `#${params.mapId}`,
    `#${operatorId}`,
  ]).expressId;

  // `MappedRepresentation`, not `SweptSolid` or `Brep`: the representation
  // type names what the ITEMS of this representation are, and its one item is
  // a mapped item. Naming the source's own type here is the mistake that makes
  // a reader look for a swept solid and find a reference.
  const shapeRepId = editor.addEntity('IfcShapeRepresentation', [
    `#${anchor.bodyContextId}`,
    'Body',
    'MappedRepresentation',
    [`#${mappedItemId}`],
  ]).expressId;

  const productShapeId = editor.addEntity('IfcProductDefinitionShape', [
    null,
    null,
    [`#${shapeRepId}`],
  ]).expressId;

  const isIFC2X3 = (anchor.schema ?? 'IFC4') === 'IFC2X3';
  const attrs = ifcElementHeader(
    anchor.ownerHistoryId,
    placementId,
    productShapeId,
    params,
    params.IfcEntity.replace(/^Ifc/, ''),
    anchor.guidRandom,
  );
  if (!isIFC2X3 && params.PredefinedType) {
    attrs.push(`.${params.PredefinedType}.`);
  }
  const elementId = editor.addEntity(
    params.IfcEntity,
    attrs as Parameters<StoreEditor['addEntity']>[1],
  ).expressId;

  const containerId = params.ContainerId ?? anchor.storeyId;
  const relContainedId = emitRelContainedInSpatialStructure(
    editor,
    anchor.ownerHistoryId,
    elementId,
    containerId,
    anchor.guidRandom,
  );

  return {
    elementId,
    placementId,
    mappedItemId,
    shapeRepId,
    productShapeId,
    relContainedId,
    containerId,
  };
}

/**
 * Attach a companion product — a clearance body, a detection area, a plan
 * symbol — to the device it belongs to.
 *
 * `IfcRelAssignsToProduct` rather than aggregation: these are not PARTS of the
 * device. A clearance in front of an extinguisher is an agreement, not matter,
 * and saying the device is 80 cm deep would be false. They are their own
 * objects, related to it.
 */
export function emitRelAssignsToProduct(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  relatedObjectIds: readonly number[],
  relatingProductId: number,
  random?: Parameters<typeof generateIfcGuid>[0],
): number {
  return editor.addEntity('IfcRelAssignsToProduct', [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    null,
    null,
    relatedObjectIds.map((id) => `#${id}`),
    null, // RelatedObjectsType
    `#${relatingProductId}`,
  ]).expressId;
}
