/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The two boxes a detection installation hangs off.
 *
 * # Two devices, two classes, and they are not interchangeable
 * A **line controller** is the small unit each run terminates at — the loop
 * card, the line module. Every circuit has one, and the same shape recurs
 * across trades: fire detection, intruder detection, access control all put a
 * controller between the devices and the panel. That is `IfcController`, whose
 * `PredefinedType` describes control BEHAVIOUR (`PROGRAMMABLE`, `TWOPOSITION`,
 * …) rather than the trade — so the trade goes in `ObjectType`, the attribute
 * IFC provides for exactly that refinement.
 *
 * The **panel** is the one box the whole installation reports to. IFC has a
 * dedicated value for it: `IfcUnitaryControlElement` with `PredefinedType =
 * ALARMPANEL`. `IfcController` is the wrong class for it — a panel is not a
 * control loop — and the distinction is worth keeping because a schedule that
 * cannot tell the panel from thirty line cards is not a schedule.
 *
 * # IFC2X3 does not have `IfcUnitaryControlElement`
 * It arrived in IFC4. Rather than write an entity the schema has no name for,
 * {@link addAlarmPanelToStore} refuses — an invalid file that loads is worse
 * than a build that stops and says why.
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

/** `IfcControllerTypeEnum` (IFC4 / IFC4X3), without the dots. */
export type ControllerPredefinedType =
  | 'FLOATING'
  | 'MULTIPOSITION'
  | 'PROGRAMMABLE'
  | 'PROPORTIONAL'
  | 'TWOPOSITION'
  | 'USERDEFINED'
  | 'NOTDEFINED';

interface BoxDeviceParams {
  /** Base-centre, in storey-local coordinates (metres). */
  Position: [number, number, number];
  Width?: number;
  Depth?: number;
  Height?: number;
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
  /** Spatial element it stands in — the room, when one is known. */
  ContainerId?: number;
}

export interface ControllerInStoreParams extends BoxDeviceParams {
  /** Defaults to `PROGRAMMABLE` — a line controller is a programmed unit. */
  PredefinedType?: ControllerPredefinedType;
}

export interface AlarmPanelInStoreParams extends BoxDeviceParams {
  /** Ignored: an alarm panel is `ALARMPANEL` by definition. Kept for symmetry. */
  PredefinedType?: 'ALARMPANEL';
}

export interface ControlElementBuildResult {
  elementId: number;
  placementId: number;
  productShapeId: number;
  relContainedId: number;
}

/**
 * The shared body: a box on the storey, contained in a room when one is given.
 *
 * Identical in shape to `addSensorToStore`, and deliberately so — a controller
 * placed a different way would sit differently in every schedule and every
 * plan that already knows how to read a placed device.
 */
function addBoxDevice(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  ifcClass: string,
  params: BoxDeviceParams,
  tail: Array<string | null>,
  defaults: { width: number; depth: number; height: number },
  headerName: string,
): ControlElementBuildResult {
  const width = params.Width ?? defaults.width;
  const depth = params.Depth ?? defaults.depth;
  const height = params.Height ?? defaults.height;
  if (width <= 0 || depth <= 0 || height <= 0) {
    throw new Error(`add${headerName}ToStore: Width, Depth and Height must be positive`);
  }

  const position = toNativePoint3(anchor, params.Position);
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, position);
  const profileId = emitRectangleProfile(
    editor, toNativeLength(anchor, width), toNativeLength(anchor, depth),
  );
  const solidId = emitExtrudedSolid(editor, profileId, toNativeLength(anchor, height));
  const { productShapeId } = emitBodyRepresentation(editor, anchor.bodyContextId, solidId);

  const attrs = ifcElementHeader(
    anchor.ownerHistoryId, placementId, productShapeId, params, headerName, anchor.guidRandom,
  );
  for (const value of tail) attrs.push(value);

  const elementId = editor.addEntity(
    ifcClass, attrs as Parameters<StoreEditor['addEntity']>[1],
  ).expressId;
  const relContainedId = emitRelContainedInSpatialStructure(
    editor, anchor.ownerHistoryId, elementId, params.ContainerId ?? anchor.storeyId, anchor.guidRandom,
  );
  return { elementId, placementId, productShapeId, relContainedId };
}

/**
 * A line controller — the unit one circuit hangs on.
 *
 * `ObjectType` carries the trade (`FireDetection`, `IntrusionDetection`, …),
 * matching what `addDistributionSystemToStore` does with the same attribute,
 * so the discipline reads the same on the installation and on its controllers.
 */
export function addControllerToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: ControllerInStoreParams,
): ControlElementBuildResult {
  const isIFC2X3 = (anchor.schema ?? 'IFC4') === 'IFC2X3';
  return addBoxDevice(
    editor, anchor, 'IfcController', params,
    // IFC2X3's IfcController has no PredefinedType, the same caveat as
    // IfcSensor's.
    isIFC2X3 ? [] : [`.${params.PredefinedType ?? 'PROGRAMMABLE'}.`],
    { width: 0.2, depth: 0.12, height: 0.25 },
    'Controller',
  );
}

/**
 * The alarm panel — one per installation, the box everything reports to.
 *
 * Bigger than a controller because it is: a wall-mounted panel, not a module.
 * The size only matters for it being findable in the 3D view, which is the
 * whole point of placing one automatically rather than leaving a hole.
 */
export function addAlarmPanelToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: AlarmPanelInStoreParams,
): ControlElementBuildResult {
  if ((anchor.schema ?? 'IFC4') === 'IFC2X3') {
    throw new Error(
      'addAlarmPanelToStore: IfcUnitaryControlElement does not exist in IFC2X3 — '
      + 'it was introduced in IFC4. Use addControllerToStore, or export as IFC4.',
    );
  }
  return addBoxDevice(
    editor, anchor, 'IfcUnitaryControlElement', params,
    ['.ALARMPANEL.'],
    { width: 0.5, depth: 0.15, height: 0.7 },
    'AlarmPanel',
  );
}
