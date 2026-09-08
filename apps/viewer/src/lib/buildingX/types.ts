/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a Building X structure export is made of.
 *
 * Split out from the transform for the reason the rest of `lib/` splits the
 * same way (`smartProperties/types.ts` and its siblings): the declarations are
 * read far more often than the walk that produces them — by the panel, the
 * runner, and anybody checking a payload against the OpenAPI spec — and none
 * of those should have to page past the traversal to find a field name.
 */

import type { SpatialNode } from '@ifc-lite/data';

/** The prefix the Structure API documentation's own `externalId` example uses. */
export const EXTERNAL_ID_PREFIX = 'IfcGuid:';

/** A GlobalId, in the form the `externalId` field is meant to carry it. */
export function externalIdFor(globalId: string): string {
  return `${EXTERNAL_ID_PREFIX}${globalId}`;
}

/**
 * A postal address for the building.
 *
 * `countryCode` is the only field the API requires, and it is the only one
 * here without a sensible empty value: an address record with nothing in it is
 * still accepted by Building X, so a missing street costs nothing while a
 * missing country costs the whole request.
 */
export interface BuildingXAddress {
  /** ISO 3166-1 alpha-3, e.g. `CHE`. Required by the API. */
  readonly countryCode: string;
  readonly locality?: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly street?: string;
}

/**
 * What the model cannot supply.
 *
 * All three are required by the Structure API on `Building` and none of them
 * is reliably in an IFC: a time zone is not modelled at all, and a postal
 * address is optional in practice even where `IfcPostalAddress` exists. Asking
 * for them once, on the product, is honest. Defaulting them silently would
 * produce a building in Zurich for a project in Hamburg.
 */
export interface StructureExportSettings {
  /** IANA zone, e.g. `Europe/Zurich`. Required by the API on every Building. */
  readonly timeZone: string;
  readonly address: BuildingXAddress;
  /**
   * IFC classes exported as `Equipment`, e.g. `IfcSensor`.
   *
   * Empty means locations only, which is a legitimate first run: the structure
   * is what Data Setup is slowest at, and devices usually arrive from the
   * field side rather than from the model.
   */
  readonly equipmentClasses: readonly string[];
}

/** Which Building X location type an IFC spatial node becomes. */
export type BuildingXLocationType = 'Campus' | 'Building' | 'Floor' | 'Room';

/** How a child names its parent. */
export type ParentRelationship =
  | 'isBuildingOf'
  | 'isFloorOf'
  | 'isRoomOf'
  /** Equipment is linked after the fact, through its own endpoint. */
  | 'hasLocation';

/**
 * One call, ready but for the parent's assigned id.
 *
 * `key` is this entry's own stable name inside the plan — the `externalId`,
 * which is derived from the GlobalId and therefore survives a re-export. A
 * runner keeps a map from `key` to the id Building X returned, and that is the
 * whole resolution mechanism.
 */
export interface StructureRequest {
  readonly method: 'POST' | 'PATCH';
  /** Path relative to `…/api/openness/structure/partitions/{partitionId}`. */
  readonly path: string;
  /** JSON:API body, complete except for the parent id noted below. */
  readonly body: unknown;
  /** This entry's `externalId`; how later entries refer back to it. */
  readonly key: string;
  /** The entry this one hangs from, or `null` for a root. */
  readonly parentKey: string | null;
  /**
   * Where the parent's assigned id belongs once it is known.
   *
   * Named rather than left as a placeholder string inside `body`, so the body
   * stays something a reader can check against the OpenAPI spec without
   * knowing this file's conventions.
   */
  readonly parentRelationship: ParentRelationship | null;
  /** Where in the model this came from. Never sent; it is for the report. */
  readonly source: {
    readonly ifcClass: string;
    readonly globalId: string;
    readonly name: string;
    /** Kept so a warning can point back at a row in the hierarchy panel. */
    readonly expressId: number;
  };
}

/** An element that should become `Equipment`, already resolved from the store. */
export interface EquipmentCandidate {
  readonly expressId: number;
  readonly globalId: string;
  readonly name: string;
  readonly ifcClass: string;
  /** The spatial node containing it — a room, or a storey. `null` if loose. */
  readonly containerId: number | null;
}

export interface StructureExportResult {
  /** In creation order: a parent always precedes everything hanging from it. */
  readonly requests: readonly StructureRequest[];
  /** What was left out or left incomplete, in the order it was noticed. */
  readonly warnings: readonly string[];
  readonly counts: Readonly<Record<BuildingXLocationType | 'Equipment', number>>;
}

export interface StructureExportInput {
  readonly project: SpatialNode;
  readonly globalIdOf: (expressId: number) => string;
  readonly equipment: readonly EquipmentCandidate[];
  readonly settings: StructureExportSettings;
  /**
   * Ids for `included` address records.
   *
   * These are local to one request — they wire the address to the building
   * inside the same payload — so minting them here does not contradict the
   * note at the top about `id` belonging to the platform. Injectable so a test
   * gets a stable payload to compare.
   */
  readonly newId?: () => string;
}

/**
 * The plan as the file that gets written.
 *
 * A wrapper object rather than a bare array: the counts and the warnings are
 * what somebody reads first when they open the file six weeks later, and a
 * version marker is what lets a runner refuse a file it does not understand
 * instead of half-importing it.
 */
export interface StructurePlanFile {
  readonly format: 'ifclite.buildingx.structure-plan';
  readonly version: 1;
  readonly base: string;
  readonly generatedAt: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
  readonly requests: readonly StructureRequest[];
}

/** The documented base every `path` is relative to. */
export const STRUCTURE_API_BASE =
  'https://eu.buildingx.siemens.com/api/openness/structure/partitions/{partitionId}';

export function toPlanFile(
  result: StructureExportResult,
  generatedAt: string,
): StructurePlanFile {
  return {
    format: 'ifclite.buildingx.structure-plan',
    version: 1,
    base: STRUCTURE_API_BASE,
    generatedAt,
    counts: result.counts,
    warnings: result.warnings,
    requests: result.requests,
  };
}
