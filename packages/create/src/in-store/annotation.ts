/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Anchored builder for IfcAnnotation — drafting content that belongs to the
 * model rather than to one viewing session: a note, a marked area, a revision
 * cloud, a dimension line.
 *
 * # Why this is not shaped like the element builders
 * `IfcAnnotation` is an `IfcProduct`, NOT an `IfcElement`. It has no `Tag`
 * attribute, so it cannot use `ifcElementHeader` — that emits eight attributes
 * and would produce an invalid entity here. Its geometry is 2D curves and text
 * in an 'Annotation' representation, not a swept solid in a 'Body' one, so it
 * also shares none of the profile/extrusion helpers.
 *
 * # Where it sits
 * On its storey's own plane, at the storey datum (local Z = 0), placed exactly
 * the way a placed element is. A plan is drawn on a floor; a note on that plan
 * belongs to that floor, and giving it a height nobody asked for would put it
 * somewhere no drawing shows it.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { generateIfcGuid } from '@ifc-lite/encoding';
import { toNativeLength, toNativePoint2, toNativePoint3, type SpatialAnchor } from './anchor.js';
import {
  emitLocalPlacement,
  emitRelContainedInSpatialStructure,
  ownerHistoryRef,
} from './_emit-helpers.js';

/** A 2D point in storey-local coordinates (metres). */
export type AnnotationPoint2D = readonly [number, number];

export type AnnotationGeometry =
  | {
      readonly kind: 'polyline';
      /** Storey-local points, metres. Two or more. */
      readonly points: ReadonlyArray<AnnotationPoint2D>;
      /** Repeat the first point at the end, for an area or a cloud. */
      readonly closed?: boolean;
    }
  | {
      readonly kind: 'text';
      readonly text: string;
      /** Top-left of the text box, storey-local metres. */
      readonly position: AnnotationPoint2D;
      /** Layout box, metres. Height doubles as the nominal text height. */
      readonly width: number;
      readonly height: number;
    };

export interface AnnotationInStoreParams {
  readonly geometry: AnnotationGeometry;
  readonly Name?: string;
  readonly Description?: string;
  readonly ObjectType?: string;
}

export interface AnnotationBuildResult {
  annotationId: number;
  placementId: number;
  shapeRepId: number;
  productShapeId: number;
  relContainedId: number;
}

/**
 * `IfcAnnotation` gained a `PredefinedType` only in IFC4X3; emitting it on
 * IFC4 or IFC2X3 would overrun the attribute list.
 */
function annotationAttributeTail(schema: string): unknown[] {
  return schema === 'IFC4X3' ? ['.USERDEFINED.'] : [];
}

function emitPolylineItem(
  editor: StoreEditor,
  points: ReadonlyArray<AnnotationPoint2D>,
  closed: boolean,
): number {
  const sequence = closed && points.length > 2 ? [...points, points[0]] : [...points];
  const pointIds = sequence.map(
    (pt) => editor.addEntity('IfcCartesianPoint', [[pt[0], pt[1]]]).expressId,
  );
  return editor.addEntity('IfcPolyline', [pointIds.map((id) => `#${id}`)]).expressId;
}

function emitTextItem(
  editor: StoreEditor,
  text: string,
  position: AnnotationPoint2D,
  width: number,
  height: number,
): number {
  const originPt = editor.addEntity('IfcCartesianPoint', [[position[0], position[1]]]).expressId;
  const placement = editor.addEntity('IfcAxis2Placement2D', [`#${originPt}`, null]).expressId;
  const extent = editor.addEntity('IfcPlanarExtent', [width, height]).expressId;
  return editor.addEntity('IfcTextLiteralWithExtent', [
    text,
    `#${placement}`,
    '.RIGHT.',
    `#${extent}`,
    'top-left',
  ]).expressId;
}

export function addAnnotationToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: AnnotationInStoreParams,
): AnnotationBuildResult {
  const { geometry } = params;
  const schema = anchor.schema ?? 'IFC4';

  // The placement carries the plane; the geometry is 2D on it. Anchoring at the
  // storey origin keeps the item coordinates readable as plan coordinates
  // rather than as offsets from an arbitrary insertion point.
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, toNativePoint3(anchor, [0, 0, 0]));

  let itemId: number;
  let representationType: string;
  if (geometry.kind === 'text') {
    if (!geometry.text.trim()) {
      throw new Error('addAnnotationToStore: text annotation needs a non-empty string');
    }
    itemId = emitTextItem(
      editor,
      geometry.text,
      toNativePoint2(anchor, geometry.position),
      toNativeLength(anchor, geometry.width),
      toNativeLength(anchor, geometry.height),
    );
    representationType = 'Text';
  } else {
    if (geometry.points.length < 2) {
      throw new Error('addAnnotationToStore: polyline annotation needs at least 2 points');
    }
    itemId = emitPolylineItem(
      editor,
      geometry.points.map((p) => toNativePoint2(anchor, p) as AnnotationPoint2D),
      geometry.closed ?? false,
    );
    representationType = 'Annotation2D';
  }

  // 'Annotation' rather than 'Body': this is drafting content, and a viewer
  // that meshes 'Body' representations must not try to solidify a note.
  const shapeRepId = editor.addEntity('IfcShapeRepresentation', [
    `#${anchor.bodyContextId}`,
    'Annotation',
    representationType,
    [`#${itemId}`],
  ]).expressId;
  const productShapeId = editor.addEntity('IfcProductDefinitionShape', [
    null,
    null,
    [`#${shapeRepId}`],
  ]).expressId;

  // IfcAnnotation: GlobalId, OwnerHistory, Name, Description, ObjectType,
  // ObjectPlacement, Representation (+ PredefinedType on IFC4X3). No Tag.
  const attrs: unknown[] = [
    generateIfcGuid(anchor.guidRandom),
    ownerHistoryRef(anchor.ownerHistoryId),
    params.Name ?? 'Annotation',
    params.Description ?? null,
    params.ObjectType ?? null,
    `#${placementId}`,
    `#${productShapeId}`,
    ...annotationAttributeTail(schema),
  ];

  const annotationId = editor.addEntity(
    'IfcAnnotation',
    attrs as Parameters<StoreEditor['addEntity']>[1],
  ).expressId;

  const relContainedId = emitRelContainedInSpatialStructure(
    editor,
    anchor.ownerHistoryId,
    annotationId,
    anchor.storeyId,
    anchor.guidRandom,
  );

  return { annotationId, placementId, shapeRepId, productShapeId, relContainedId };
}
