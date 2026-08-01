/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Anchored builder for a generic single-click "library" element — any IFC
 * entity shaped like `header + optional single PredefinedType enum` with
 * no further own attributes (e.g. `IfcSensor`, `IfcAlarm`,
 * `IfcAudioVisualAppliance`, and most other `IfcDistributionControlElement`
 * / simple `IfcFlowTerminal` subtypes). This is the same shape `sensor.ts`
 * hardcodes for `IfcSensor` specifically, generalised so a data-driven
 * element catalog (many entity types) doesn't need one bespoke builder
 * file per type.
 *
 * Callers are responsible for only requesting entities that actually
 * match this shape — this builder has no schema access to validate that
 * `ifcEntity` is one of them. Entities with extra own attributes (e.g.
 * `IfcDoor`'s OverallWidth/OverallHeight) need their own builder.
 *
 * `PredefinedType` only exists from IFC4 onward on these entities — IFC2X3
 * has no such attribute, so it's omitted there (same caveat as
 * `column.ts` / `sensor.ts`).
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { toNativeLength, toNativePoint3, type SpatialAnchor } from './anchor.js';
import {
  emitBodyRepresentation,
  emitExtrudedSolid,
  emitLocalPlacement,
  emitRectangleProfile,
  emitRelContainedInSpatialStructure,
  ifcElementHeader,
} from './_emit-helpers.js';

export interface LibraryElementInStoreParams {
  /** The IFC entity to emit, e.g. `'IfcSensor'`, `'IfcAlarm'`, `'IfcAudioVisualAppliance'`. */
  IfcEntity: string;
  /** Base-centre of the device, in storey-local coordinates (metres). */
  Position: [number, number, number];
  /** Footprint width along storey-local X (metres). Defaults to 0.1. */
  Width?: number;
  /** Footprint depth along storey-local Y (metres). Defaults to 0.1. */
  Depth?: number;
  /** Extrusion height along +Z (metres). Defaults to 0.05. */
  Height?: number;
  /** PredefinedType enum value (without dots), e.g. `'FIRESENSOR'`, `'SIREN'`, `'CAMERA'`. Ignored on IFC2X3. */
  PredefinedType?: string;
  /** Free-text refinement when `PredefinedType === 'USERDEFINED'` (e.g. `'GLASSBREAKSENSOR'`). */
  ObjectType?: string;
  Name?: string;
  Description?: string;
  Tag?: string;
}

export interface LibraryElementBuildResult {
  elementId: number;
  placementId: number;
  profileId: number;
  solidId: number;
  shapeRepId: number;
  productShapeId: number;
  relContainedId: number;
}

export function addLibraryElementToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: LibraryElementInStoreParams,
): LibraryElementBuildResult {
  if (!params.IfcEntity) {
    throw new Error('addLibraryElementToStore: IfcEntity is required');
  }
  const width = params.Width ?? 0.1;
  const depth = params.Depth ?? 0.1;
  const height = params.Height ?? 0.05;
  if (width <= 0 || depth <= 0 || height <= 0) {
    throw new Error('addLibraryElementToStore: Width, Depth, and Height must be positive');
  }

  const nativeParams = {
    ...params,
    Position: toNativePoint3(anchor, params.Position),
    Width: toNativeLength(anchor, width),
    Depth: toNativeLength(anchor, depth),
    Height: toNativeLength(anchor, height),
  };

  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, nativeParams.Position);
  const profileId = emitRectangleProfile(editor, nativeParams.Width, nativeParams.Depth);
  const solidId = emitExtrudedSolid(editor, profileId, nativeParams.Height);
  const { shapeRepId, productShapeId } = emitBodyRepresentation(editor, anchor.bodyContextId, solidId);

  const isIFC2X3 = (anchor.schema ?? 'IFC4') === 'IFC2X3';
  const attrs = ifcElementHeader(anchor.ownerHistoryId, placementId, productShapeId, params, params.IfcEntity.replace(/^Ifc/, ''), anchor.guidRandom);
  if (!isIFC2X3 && params.PredefinedType) {
    attrs.push(`.${params.PredefinedType}.`);
  }

  const elementId = editor.addEntity(params.IfcEntity, attrs as Parameters<StoreEditor['addEntity']>[1]).expressId;
  const relContainedId = emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, elementId, anchor.storeyId, anchor.guidRandom);

  return { elementId, placementId, profileId, solidId, shapeRepId, productShapeId, relContainedId };
}
