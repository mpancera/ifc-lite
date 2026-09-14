/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * An `IfcSpatialZone` whose body is the rooms it holds.
 *
 * `addSpatialZonesToStore` emits a zone somebody DREW: one box or one prism,
 * positioned by hand. This emits a zone that was DERIVED: a fire compartment
 * is not a shape anybody drew, it is the set of rooms that were assigned to
 * it, and its body is those rooms.
 *
 * # Several prisms, one body
 *
 * `IfcShapeRepresentation.Items` is a SET, so one room becomes one
 * `IfcExtrudedAreaSolid` and they all sit in one `Body` representation of one
 * zone. The alternative — union the footprints into a single profile — needs
 * polygon boolean arithmetic, and would produce a shape that is no longer the
 * rooms: every wall between two rooms of the compartment would be swallowed,
 * and a concave result would exercise exactly the code paths a convex-only
 * pipeline gets wrong in silence.
 *
 * Leaving the separating walls OUT is not a limitation, it is the statement: a
 * compartment is the space it encloses, and the walls that bound it are the
 * compartment-forming ELEMENTS, which carry their own requirements.
 *
 * # The rooms are referenced, never contained
 *
 * `IfcRelReferencedInSpatialStructure` is many-to-many and additive, so a room
 * keeps the storey that contains it. Containing it here instead would re-parent
 * the building's real hierarchy to a zone, which is the one thing zone
 * emission must never do.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import { IfcSpatialZoneTypeEnum } from '@ifc-lite/parser';
import type { StoreEditor } from '@ifc-lite/mutations';
import { toNativeLength, toNativePoint3, type SpatialAnchor } from './anchor.js';
import { emitBodyRepresentation, emitPolygonProfile, ownerHistoryRef } from './_emit-helpers.js';

/** One room of the compartment, as a prism. Coordinates are IFC-axes (Z-up)
 *  world METRES — the caller has already undone its own render frame. */
export interface CompartmentPart {
  /** The room's outline, X/Y world metres. At least three points; the ring may
   *  be given open or closed. */
  Footprint: ReadonlyArray<readonly [number, number]>;
  /** World Z of the room's floor, metres. */
  BaseZ: number;
  /** Extrusion height along +Z, metres. */
  Height: number;
}

export interface CompartmentZoneParams {
  /** `IfcRoot.Name` — the compartment's own name, e.g. "BA-01". */
  Name: string;
  /** `IfcRoot.Description`. The caller's to use: the viewer stamps which
   *  authored zone this was derived from, so a later run finds its own. */
  Description?: string;
  LongName?: string;
  /** Defaults to `FIRESAFETY`, which is what a Brandabschnitt is. */
  PredefinedType?: `${IfcSpatialZoneTypeEnum}`;
  /** The refinement. Required by the schema when `PredefinedType` is
   *  `USERDEFINED`, and by the Swiss check for a Brandabschnitt regardless. */
  ObjectType?: string;
  /** One per room. A compartment with none is refused — see below. */
  parts: readonly CompartmentPart[];
  /** Rooms to reference, by expressId. Usually the same rooms `parts` came
   *  from, but kept separate: a room with no usable geometry still belongs to
   *  the compartment even though it contributes no prism. */
  RelatedElements: readonly number[];
  /** Written into one `IfcPropertySet` on the zone, e.g. the compartment's
   *  fire-resistance requirements. Values are emitted as `IfcLabel`. */
  PropertySet?: { name: string; properties: ReadonlyArray<{ name: string; value: string }> };
}

export interface CompartmentZoneResult {
  zoneId: number;
  /** `null` when the compartment referenced no elements. */
  relReferencedId: number | null;
  /** `null` when no property set was asked for. */
  propertySetId: number | null;
  /** How many prisms the body ended up with. */
  solids: number;
}

const SPATIAL_ZONE_TYPES: ReadonlySet<string> = new Set<string>(Object.values(IfcSpatialZoneTypeEnum));

/** A ring the profile emitter can use: at least three points, all finite. */
function checkPart(part: CompartmentPart, name: string, index: number): void {
  if (part.Footprint.length < 3) {
    throw new Error(`addCompartmentZoneToStore: "${name}" part ${index} has fewer than 3 points`);
  }
  for (const [x, y] of part.Footprint) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`addCompartmentZoneToStore: "${name}" part ${index} has a non-finite point`);
    }
  }
  if (!Number.isFinite(part.BaseZ)) {
    throw new Error(`addCompartmentZoneToStore: "${name}" part ${index} needs a finite BaseZ`);
  }
  if (!Number.isFinite(part.Height) || part.Height <= 0) {
    throw new Error(`addCompartmentZoneToStore: "${name}" part ${index} needs a positive Height`);
  }
}

/**
 * Emit one `IfcSpatialZone` for a compartment, with one prism per room.
 *
 * Every part is checked before the first entity is written: the emit loop
 * would otherwise leave half a compartment in the overlay and report failure.
 */
export function addCompartmentZoneToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: CompartmentZoneParams,
): CompartmentZoneResult {
  if ((anchor.schema ?? 'IFC4') === 'IFC2X3') {
    throw new Error('addCompartmentZoneToStore: IfcSpatialZone requires IFC4 or later');
  }
  if (params.parts.length === 0) {
    // A zone with an empty Body representation is not valid IFC, and a
    // compartment with no rooms is not a compartment. The caller decides what
    // to tell the user; this refuses to write nonsense.
    throw new Error(`addCompartmentZoneToStore: "${params.Name}" has no rooms to build a body from`);
  }
  const predefinedType = params.PredefinedType ?? 'FIRESAFETY';
  if (!SPATIAL_ZONE_TYPES.has(predefinedType)) {
    throw new Error(`addCompartmentZoneToStore: "${predefinedType}" is not an IfcSpatialZoneTypeEnum value`);
  }
  if (predefinedType === 'USERDEFINED' && !params.ObjectType) {
    throw new Error('addCompartmentZoneToStore: PredefinedType USERDEFINED requires an ObjectType');
  }
  params.parts.forEach((part, index) => checkPart(part, params.Name, index));

  const owner = ownerHistoryRef(anchor.ownerHistoryId ?? null);

  // The zone sits at the corner of what it covers and every profile is stated
  // RELATIVE to that. A georeferenced model puts rooms at coordinates in the
  // millions, and a profile written in those is a polygon whose points differ
  // in the seventh digit — readable in double precision, unreadable the moment
  // anything downstream keeps it in a float.
  let ox = Infinity;
  let oy = Infinity;
  for (const part of params.parts) {
    for (const [x, y] of part.Footprint) {
      if (x < ox) ox = x;
      if (y < oy) oy = y;
    }
  }
  const originId = editor.addEntity('IfcCartesianPoint', [toNativePoint3(anchor, [ox, oy, 0])]).expressId;
  const axisId = editor.addEntity('IfcAxis2Placement3D', [`#${originId}`, null, null]).expressId;
  const placementId = editor.addEntity('IfcLocalPlacement', [null, `#${axisId}`]).expressId;

  const solidIds = params.parts.map((part) => {
    const profileId = emitPolygonProfile(
      editor,
      part.Footprint.map(([x, y]): [number, number] => [
        toNativeLength(anchor, x - ox),
        toNativeLength(anchor, y - oy),
      ]),
    );
    // The solid's own placement carries the room's floor height, which is the
    // one thing a body of rooms on different storeys cannot share.
    const basePoint = editor.addEntity('IfcCartesianPoint', [
      toNativePoint3(anchor, [0, 0, part.BaseZ]),
    ]).expressId;
    const solidAxis = editor.addEntity('IfcAxis2Placement3D', [`#${basePoint}`, null, null]).expressId;
    const direction = editor.addEntity('IfcDirection', [[0, 0, 1]]).expressId;
    return editor.addEntity('IfcExtrudedAreaSolid', [
      `#${profileId}`,
      `#${solidAxis}`,
      `#${direction}`,
      toNativeLength(anchor, part.Height),
    ]).expressId;
  });

  const { productShapeId } = emitBodyRepresentation(editor, anchor.bodyContextId, solidIds);

  const zoneId = editor.addEntity('IfcSpatialZone', [
    generateIfcGuid(anchor.guidRandom),
    owner,
    params.Name,
    params.Description ?? null,
    params.ObjectType ?? null,
    `#${placementId}`,
    `#${productShapeId}`,
    params.LongName ?? null,
    `.${predefinedType}.`,
  ]).expressId;

  let relReferencedId: number | null = null;
  if (params.RelatedElements.length > 0) {
    relReferencedId = editor.addEntity('IfcRelReferencedInSpatialStructure', [
      generateIfcGuid(anchor.guidRandom),
      owner,
      null,
      null,
      params.RelatedElements.map((id) => `#${id}`),
      `#${zoneId}`,
    ]).expressId;
  }

  let propertySetId: number | null = null;
  if (params.PropertySet && params.PropertySet.properties.length > 0) {
    const propertyIds = params.PropertySet.properties.map((property) =>
      editor.addEntity('IfcPropertySingleValue', [
        property.name,
        null,
        // The typed-value marker, not a hand-built token: `NominalValue` is a
        // SELECT and has to carry its type. Written as a plain string it would
        // be escaped into a quoted literal and stop being an IfcValue at all.
        { typed: { type: 'IfcLabel', value: property.value } },
        null,
      ]).expressId);
    propertySetId = editor.addEntity('IfcPropertySet', [
      generateIfcGuid(anchor.guidRandom),
      owner,
      params.PropertySet.name,
      null,
      propertyIds.map((id) => `#${id}`),
    ]).expressId;
    editor.addEntity('IfcRelDefinesByProperties', [
      generateIfcGuid(anchor.guidRandom),
      owner,
      null,
      null,
      [`#${zoneId}`],
      `#${propertySetId}`,
    ]);
  }

  return { zoneId, relReferencedId, propertySetId, solids: solidIds.length };
}
