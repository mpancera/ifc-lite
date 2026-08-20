/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Anchored builders for `IfcDistributionSystem` — the IFC grouping that says
 * "these elements form one installation" (a fire-detection system, an access-
 * control system, a room-automation system).
 *
 * IFC models this as an `IfcGroup`, not as spatial containment: an element
 * stays contained in its storey and is additionally *assigned* to the system
 * via `IfcRelAssignsToGroup`. Both statements are independent, which is why
 * assigning a system never disturbs the placement the element builders emit.
 *
 * `PredefinedType` carries the standard `IfcDistributionSystemEnum` value
 * (`FIREPROTECTION`, `SECURITY`, `CONTROL`, …). The finer distinction inside
 * one of those — fire *detection* vs. fire *suppression*, both `FIREPROTECTION`
 * — has no standard enum value, so it goes in `ObjectType`, the attribute IFC
 * provides for exactly that refinement.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { generateIfcGuid, type RandomSource } from '@ifc-lite/encoding';
import { ownerHistoryRef } from './_emit-helpers.js';

export interface DistributionSystemInStoreParams {
  /** `IfcDistributionSystemEnum` value without dots, e.g. `'FIREPROTECTION'`. */
  PredefinedType: string;
  /**
   * Refinement within the PredefinedType, e.g. `'FireDetection'`. Also the
   * key `findDistributionSystem` matches on, so one system per
   * PredefinedType + ObjectType pair is reused rather than duplicated.
   */
  ObjectType?: string;
  Name?: string;
  Description?: string;
  LongName?: string;
}

/**
 * Create an `IfcDistributionSystem`.
 *
 * Attribute order: IfcRoot (GlobalId, OwnerHistory, Name, Description) +
 * IfcObject (ObjectType) + IfcDistributionSystem (LongName, PredefinedType).
 */
export function addDistributionSystemToStore(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  params: DistributionSystemInStoreParams,
  random?: RandomSource,
): { systemId: number } {
  const systemId = editor.addEntity('IfcDistributionSystem', [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    params.Name ?? null,
    params.Description ?? null,
    params.ObjectType ?? null,
    params.LongName ?? null,
    `.${params.PredefinedType}.`,
  ]).expressId;

  return { systemId };
}

/**
 * Create an `IfcDistributionCircuit` — a named partition of a system.
 *
 * IFC's own word for a subdivision of an installation: the fire-detection
 * system is one `IfcDistributionSystem`, and the Meldergruppen that partition
 * it are circuits under it. As a bare `IfcGroup` a Meldergruppe would say
 * nothing about the installation it divides; as a circuit aggregated under its
 * system it says exactly that, and stays an `IfcGroup` subtype, so membership
 * is the same `IfcRelAssignsToGroup` as everything else.
 *
 * Attribute order is the system's — `IfcDistributionCircuit` adds none of its
 * own: IfcRoot (GlobalId, OwnerHistory, Name, Description) + IfcObject
 * (ObjectType) + IfcSystem (LongName) + IfcDistributionSystem
 * (PredefinedType).
 */
export function addDistributionCircuitToStore(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  params: DistributionSystemInStoreParams,
  random?: RandomSource,
): { circuitId: number } {
  const circuitId = editor.addEntity('IfcDistributionCircuit', [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    params.Name ?? null,
    params.Description ?? null,
    params.ObjectType ?? null,
    params.LongName ?? null,
    `.${params.PredefinedType}.`,
  ]).expressId;

  return { circuitId };
}

/**
 * Aggregate objects under a parent — here, circuits under their system.
 *
 * Attribute order: IfcRoot (GlobalId, OwnerHistory, Name, Description) +
 * IfcRelDecomposes (RelatingObject) + IfcRelAggregates (RelatedObjects).
 */
export function emitRelAggregates(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  relatingObjectId: number,
  relatedObjectIds: readonly number[],
  random?: RandomSource,
): number {
  return editor.addEntity('IfcRelAggregates', [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    null,
    null,
    `#${relatingObjectId}`,
    relatedObjectIds.map((id) => `#${id}`),
  ]).expressId;
}

/**
 * Assign elements to a system (or any other `IfcGroup`).
 *
 * Attribute order: IfcRoot (GlobalId, OwnerHistory, Name, Description) +
 * IfcRelAssigns (RelatedObjects, RelatedObjectsType) +
 * IfcRelAssignsToGroup (RelatingGroup).
 *
 * Emits a fresh rel per call rather than growing an existing one, matching
 * `emitRelDefinesByType` / `emitRelContainedInSpatialStructure`.
 */
export function emitRelAssignsToGroup(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  relatedObjectIds: readonly number[],
  relatingGroupId: number,
  random?: RandomSource,
): number {
  return editor.addEntity('IfcRelAssignsToGroup', [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    null,
    null,
    relatedObjectIds.map((id) => `#${id}`),
    null,
    `#${relatingGroupId}`,
  ]).expressId;
}

/** An overlay entity as `MutablePropertyView.getNewEntities()` returns it. */
interface OverlayEntityLike {
  expressId: number;
  type: string;
  attributes: readonly unknown[];
}

/**
 * The express id of an already-authored system matching `PredefinedType` +
 * `ObjectType`, or `null`. Lets a caller create one system per installation
 * and assign every later placement to it, instead of one system per element.
 *
 * Scans authored entities only — a system that already exists in the parsed
 * file is not matched, since reusing it would silently write into a system the
 * user did not author here.
 */
export function findDistributionSystem(
  newEntities: Iterable<OverlayEntityLike>,
  predefinedType: string,
  objectType?: string,
): number | null {
  for (const entity of newEntities) {
    if (entity.type !== 'IfcDistributionSystem') continue;
    if (entity.attributes[6] !== `.${predefinedType}.`) continue;
    const entityObjectType = entity.attributes[4];
    const wanted = objectType ?? null;
    if ((typeof entityObjectType === 'string' ? entityObjectType : null) !== wanted) continue;
    return entity.expressId;
  }
  return null;
}
