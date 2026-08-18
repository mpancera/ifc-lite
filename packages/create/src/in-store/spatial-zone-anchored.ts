// Verankerter Bauer fuer `IfcSpatialZone` MIT eigener Geometrie.
//
// Nicht zu verwechseln mit `spatial-zone.ts` daneben: dort werden gezeichnete
// Zonen als `IfcSpatialZone` emittiert und Elemente ueber
// `IfcRelReferencedInSpatialStructure` additiv angehaengt. Hier entsteht die
// Zone selbst als raeumliches Element mit Platzierung und Koerper - Rechteck
// oder Polygon, extrudiert, in der Laengeneinheit der Datei.
//
// Beides wurde unabhaengig voneinander gebaut und beim Zusammenfuehren im
// August 2026 nebeneinandergestellt, statt eines davon aufzugeben: der eine
// Weg beschreibt eine vorhandene Zone, der andere erzeugt eine mit
// Ausdehnung - etwa einen Brandabschnitt, dessen Flaeche man messen und
// schneiden koennen muss.

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Anchored builder for `IfcSpatialZone` — a spatial region WITH geometry.
 *
 * The counterpart to `IfcZone` (see `zone.ts`): where a zone is a bare
 * grouping of rooms, a spatial zone is a real spatial element with a placement
 * and a body. A fire compartment has an extent — you can ask for its area, cut
 * a section through it, colour it in 3D — and that is exactly what
 * `IfcSpatialZone` is for. Its `PredefinedType` domain says as much:
 * `FIRESAFETY`, `SECURITY`, `THERMAL`, `VENTILATION`, `OCCUPANCY`,
 * `TRANSPORT`, `LIGHTING`, `CONSTRUCTION`, `INTERFERENCE`, `RESERVATION`.
 *
 * Geometry mirrors `addSpaceToStore`: a rectangle or an arbitrary footprint
 * polygon, extruded to a height, in the file's native length unit.
 *
 * Unlike a space, a spatial zone is NOT aggregated into the storey. IFC treats
 * it as a spatial element that may overlap the spatial hierarchy rather than
 * subdivide it — a fire compartment routinely spans several storeys, and
 * forcing it under one of them would state something false. It is placed
 * relative to the storey's placement so its coordinates stay comparable, and
 * left unaggregated.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { StoreEditor } from '@ifc-lite/mutations';
import { toNativeLength, type SpatialAnchor } from './anchor.js';
import {
  emitBodyRepresentation,
  emitExtrudedSolid,
  emitLocalPlacement,
  emitPolygonProfile,
  emitRectangleProfile,
  ownerHistoryRef,
} from './_emit-helpers.js';

/** `IfcSpatialZoneTypeEnum`, as carried in the bundled IFC4.3 schema. */
export type AnchoredSpatialZonePredefinedType =
  | 'CONSTRUCTION' | 'FIRESAFETY' | 'INTERFERENCE' | 'LIGHTING' | 'OCCUPANCY'
  | 'RESERVATION' | 'SECURITY' | 'THERMAL' | 'TRANSPORT' | 'VENTILATION'
  | 'USERDEFINED' | 'NOTDEFINED';

interface AnchoredSpatialZoneCommon {
  Name: string;
  Description?: string;
  /** Refinement when `PredefinedType` is `USERDEFINED`. */
  ObjectType?: string;
  LongName?: string;
  /** Defaults to `NOTDEFINED` — an honest "unclassified", not a guess. */
  PredefinedType?: AnchoredSpatialZonePredefinedType;
  /** Extrusion height in metres. */
  Height: number;
}

export interface AnchoredSpatialZoneRectangleParams extends AnchoredSpatialZoneCommon {
  /** Placement origin in metres, relative to the storey. */
  Position: [number, number, number];
  Width: number;
  Depth: number;
}

export interface AnchoredSpatialZonePolygonParams extends AnchoredSpatialZoneCommon {
  Position?: [number, number, number];
  /** Footprint in metres, in the storey's XY plane. */
  OuterCurve: Array<[number, number]>;
}

export type AnchoredSpatialZoneParams =
  | AnchoredSpatialZoneRectangleParams
  | AnchoredSpatialZonePolygonParams;

function isPolygonParams(
  params: AnchoredSpatialZoneParams,
): params is AnchoredSpatialZonePolygonParams {
  return Array.isArray((params as AnchoredSpatialZonePolygonParams).OuterCurve);
}

/**
 * Create an `IfcSpatialZone`.
 *
 * Attribute order: IfcRoot (GlobalId, OwnerHistory, Name, Description) +
 * IfcObject (ObjectType) + IfcProduct (ObjectPlacement, Representation) +
 * IfcSpatialElement (LongName) + IfcSpatialZone (PredefinedType).
 */
export function addAnchoredSpatialZoneToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: AnchoredSpatialZoneParams,
): { spatialZoneId: number } {
  if (params.Height <= 0) {
    throw new Error('addAnchoredSpatialZoneToStore: Height must be positive');
  }

  const polygon = isPolygonParams(params);
  if (polygon) {
    if (params.OuterCurve.length < 3) {
      throw new Error('addAnchoredSpatialZoneToStore: OuterCurve needs at least three points');
    }
  } else if (params.Width <= 0 || params.Depth <= 0) {
    throw new Error('addAnchoredSpatialZoneToStore: Width and Depth must be positive');
  }

  // Params are metres; the file may be millimetres. Converting here is what
  // keeps a compartment baked into a mm model from exporting 1000× too small.
  const n = (metres: number) => toNativeLength(anchor, metres);
  const origin: [number, number, number] = polygon
    ? params.Position ?? [0, 0, 0]
    : params.Position;

  const placementId = emitLocalPlacement(
    editor,
    anchor.storeyPlacementId,
    [n(origin[0]), n(origin[1]), n(origin[2])],
  );
  const profileId = polygon
    ? emitPolygonProfile(editor, params.OuterCurve.map(([x, y]): [number, number] => [n(x), n(y)]))
    : emitRectangleProfile(editor, n(params.Width), n(params.Depth), n(params.Width / 2), n(params.Depth / 2));
  const solidId = emitExtrudedSolid(editor, profileId, n(params.Height));
  const { productShapeId } = emitBodyRepresentation(editor, anchor.bodyContextId, solidId);

  const spatialZoneId = editor.addEntity('IfcSpatialZone', [
    generateIfcGuid(anchor.guidRandom),
    ownerHistoryRef(anchor.ownerHistoryId),
    params.Name,
    params.Description ?? null,
    params.ObjectType ?? null,
    `#${placementId}`,
    `#${productShapeId}`,
    params.LongName ?? null,
    `.${params.PredefinedType ?? 'NOTDEFINED'}.`,
  ]).expressId;

  return { spatialZoneId };
}
