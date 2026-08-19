/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Anchored builder for IfcSensor — a free-standing MEP/building-
 * automation device (fire/smoke/heat detector, movement sensor, etc.),
 * placed as a small box at a single point. Mirrors `door.ts`'s shape:
 * no host/void relationship, just a Body representation + a direct
 * `IfcRelContainedInSpatialStructure` to the room it sits in, or to the
 * storey when the caller does not know a room.
 *
 * `IfcSensor.PredefinedType` (IfcSensorTypeEnum) only exists from IFC4
 * onward — IFC2X3 has no such attribute, so emitting it there would
 * produce an invalid attribute count (same caveat as `IfcColumn` in
 * `column.ts`).
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

/** IfcSensorTypeEnum (IFC4 / IFC4X3), without the leading/trailing dots. */
export type SensorPredefinedType =
  | 'CO2SENSOR'
  | 'CONDUCTANCESENSOR'
  | 'CONTACTSENSOR'
  | 'COSENSOR'
  | 'EARTHQUAKESENSOR'
  | 'FIRESENSOR'
  | 'FLOWSENSOR'
  | 'FOREIGNOBJECTDETECTIONSENSOR'
  | 'FROSTSENSOR'
  | 'GASSENSOR'
  | 'HEATSENSOR'
  | 'HUMIDITYSENSOR'
  | 'IDENTIFIERSENSOR'
  | 'IONCONCENTRATIONSENSOR'
  | 'LEVELSENSOR'
  | 'LIGHTSENSOR'
  | 'MOISTURESENSOR'
  | 'MOVEMENTSENSOR'
  | 'OBSTACLESENSOR'
  | 'PHSENSOR'
  | 'PRESSURESENSOR'
  | 'RADIATIONSENSOR'
  | 'RADIOACTIVITYSENSOR'
  | 'RAINSENSOR'
  | 'SMOKESENSOR'
  | 'SNOWDEPTHSENSOR'
  | 'SOUNDSENSOR'
  | 'TEMPERATURESENSOR'
  | 'WINDSENSOR'
  | 'USERDEFINED'
  | 'NOTDEFINED';

export interface SensorInStoreParams {
  /** Base-centre of the device, in storey-local coordinates (metres). */
  Position: [number, number, number];
  /** Footprint width along storey-local X (metres). Defaults to 0.1. */
  Width?: number;
  /** Footprint depth along storey-local Y (metres). Defaults to 0.1. */
  Depth?: number;
  /** Extrusion height along +Z (metres). Defaults to 0.05. */
  Height?: number;
  /** IFC4/4X3 PredefinedType enum. Defaults to NOTDEFINED. Ignored on IFC2X3. */
  PredefinedType?: SensorPredefinedType;
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
  /**
   * Spatial element the sensor is contained in — typically the `IfcSpace`
   * enclosing `Position`. Defaults to `anchor.storeyId`.
   *
   * Same contract as `addLibraryElementToStore`: an element is contained in
   * exactly ONE spatial element, IFC allows that element to be an `IfcSpace`,
   * and the storey is still reached transitively through the space's
   * `IfcRelAggregates`. Stating a detector against its room is what makes
   * "which detectors are in this room" answerable from the file alone —
   * measured at a real model, a storey-contained detector leaves the
   * element-room-storey chain with no edges at all.
   *
   * The geometric placement stays chained to the storey either way:
   * containment is spatial decomposition, `IfcLocalPlacement` is a coordinate
   * system, and re-parenting the placement would move the device.
   */
  ContainerId?: number;
}

export interface SensorBuildResult {
  sensorId: number;
  placementId: number;
  profileId: number;
  solidId: number;
  shapeRepId: number;
  productShapeId: number;
  relContainedId: number;
}

export function addSensorToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: SensorInStoreParams,
): SensorBuildResult {
  const width = params.Width ?? 0.1;
  const depth = params.Depth ?? 0.1;
  const height = params.Height ?? 0.05;
  if (width <= 0 || depth <= 0 || height <= 0) {
    throw new Error('addSensorToStore: Width, Depth, and Height must be positive');
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
  const attrs = ifcElementHeader(anchor.ownerHistoryId, placementId, productShapeId, params, 'Sensor', anchor.guidRandom);
  if (!isIFC2X3) {
    attrs.push(`.${params.PredefinedType ?? 'NOTDEFINED'}.`);
  }

  const sensorId = editor.addEntity('IfcSensor', attrs as Parameters<StoreEditor['addEntity']>[1]).expressId;
  const containerId = params.ContainerId ?? anchor.storeyId;
  const relContainedId = emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, sensorId, containerId, anchor.guidRandom);

  return { sensorId, placementId, profileId, solidId, shapeRepId, productShapeId, relContainedId };
}
