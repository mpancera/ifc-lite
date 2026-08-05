/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Anchored builder for `IfcZone` — a grouping of SPACES that carries no
 * geometry of its own.
 *
 * The distinction from `IfcSpatialZone` is the whole point and is easy to get
 * wrong. An `IfcZone` says "these rooms belong together" and nothing more: it
 * has no placement, no representation, no area. A trigger zone in a fire-alarm
 * concept is exactly that — it is defined by which rooms it covers, and asking
 * for its volume is a category error. `IfcSpatialZone` is the opposite: a real
 * spatial element with its own body, which is what a fire compartment is.
 *
 * Membership is `IfcRelAssignsToGroup`, reused from the distribution-system
 * builder — an `IfcZone` is an `IfcSystem`, which is an `IfcGroup`, so the same
 * relationship applies unchanged.
 *
 * IFC restricts what may be a member: spaces, spatial zones and other zones.
 * A detector therefore cannot be a direct member, and does not need to be —
 * "the detectors in this zone" follows from the rooms the zone groups and the
 * spatial containment the detectors already have.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { generateIfcGuid, type RandomSource } from '@ifc-lite/encoding';
import { ownerHistoryRef } from './_emit-helpers.js';

export interface ZoneInStoreParams {
  Name: string;
  Description?: string;
  /**
   * What kind of zone this is, e.g. `'TriggerZone'`. `IfcZone` has no
   * `PredefinedType` at all — the schema gives it none — so `ObjectType` is
   * the only place a refinement can live.
   */
  ObjectType?: string;
  LongName?: string;
}

/**
 * Create an `IfcZone`.
 *
 * Attribute order: IfcRoot (GlobalId, OwnerHistory, Name, Description) +
 * IfcObject (ObjectType) + IfcGroup/IfcSystem adds nothing + IfcZone
 * (LongName).
 */
export function addZoneToStore(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  params: ZoneInStoreParams,
  random?: RandomSource,
): { zoneId: number } {
  const zoneId = editor.addEntity('IfcZone', [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    params.Name,
    params.Description ?? null,
    params.ObjectType ?? null,
    params.LongName ?? null,
  ]).expressId;

  return { zoneId };
}

/** An overlay entity as `MutablePropertyView.getNewEntities()` returns it. */
interface OverlayEntityLike {
  expressId: number;
  type: string;
  attributes: readonly unknown[];
}

/**
 * The express id of an already-authored zone with this name, or `null`.
 *
 * Scans authored entities only. A zone that came in with the file is not
 * matched: assigning rooms to it would silently write into a grouping somebody
 * else owns, which is the same reasoning `findDistributionSystem` follows.
 */
export function findZone(
  newEntities: Iterable<OverlayEntityLike>,
  name: string,
  objectType?: string,
): number | null {
  for (const entity of newEntities) {
    if (entity.type !== 'IfcZone') continue;
    if (entity.attributes[2] !== name) continue;
    if (objectType !== undefined) {
      const entityObjectType = entity.attributes[4];
      if ((typeof entityObjectType === 'string' ? entityObjectType : null) !== objectType) continue;
    }
    return entity.expressId;
  }
  return null;
}
