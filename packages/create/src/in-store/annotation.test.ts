/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  MutablePropertyView,
  StoreEditor,
  type MutationEntityRef,
  type MutationStoreShape,
} from '@ifc-lite/mutations';
import { addAnnotationToStore } from './annotation.js';

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const ANCHOR = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, storeyId: 43, storeyPlacementId: 54 };

function build(params: Parameters<typeof addAnnotationToStore>[2], anchor = ANCHOR) {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(60), view);
  const result = addAnnotationToStore(editor, anchor, params);
  const byId = new Map(view.getNewEntities().map((e) => [e.expressId, e]));
  return { result, byId };
}

describe('addAnnotationToStore', () => {
  it('emits an IfcAnnotation with SEVEN attributes — it is an IfcProduct, not an IfcElement', () => {
    // The trap this test exists for: every other builder here uses
    // `ifcElementHeader`, which appends a Tag. IfcAnnotation has no Tag, so
    // borrowing that helper would emit an entity with one attribute too many.
    const { result, byId } = build({
      geometry: { kind: 'polyline', points: [[0, 0], [1, 0]] },
      Name: 'Notiz',
    });
    const ann = byId.get(result.annotationId);
    expect(ann?.type).toBe('IfcAnnotation');
    expect(ann?.attributes).toHaveLength(7);
    expect(ann?.attributes[1]).toBe('#5');                      // OwnerHistory
    expect(ann?.attributes[2]).toBe('Notiz');                   // Name
    expect(ann?.attributes[5]).toBe(`#${result.placementId}`);  // ObjectPlacement
    expect(ann?.attributes[6]).toBe(`#${result.productShapeId}`);
  });

  it('adds PredefinedType only on IFC4X3, where the attribute exists', () => {
    const on4x3 = build(
      { geometry: { kind: 'polyline', points: [[0, 0], [1, 1]] } },
      { ...ANCHOR, schema: 'IFC4X3' } as typeof ANCHOR,
    );
    expect(on4x3.byId.get(on4x3.result.annotationId)?.attributes).toHaveLength(8);

    const on2x3 = build(
      { geometry: { kind: 'polyline', points: [[0, 0], [1, 1]] } },
      { ...ANCHOR, schema: 'IFC2X3' } as typeof ANCHOR,
    );
    expect(on2x3.byId.get(on2x3.result.annotationId)?.attributes).toHaveLength(7);
  });

  it('puts the geometry in an Annotation representation, never Body', () => {
    // A viewer that meshes 'Body' representations must not try to solidify a
    // note; that is the difference between a drawing mark and a wall.
    const { result, byId } = build({
      geometry: { kind: 'polyline', points: [[0, 0], [2, 0], [2, 2]] },
    });
    const rep = byId.get(result.shapeRepId);
    expect(rep?.type).toBe('IfcShapeRepresentation');
    expect(rep?.attributes[1]).toBe('Annotation');
    expect(rep?.attributes[2]).toBe('Annotation2D');
  });

  it('closes a marked area by repeating the first point', () => {
    const { byId } = build({
      geometry: { kind: 'polyline', points: [[0, 0], [2, 0], [2, 2]], closed: true },
    });
    const polyline = [...byId.values()].find((e) => e.type === 'IfcPolyline');
    expect(polyline?.attributes[0]).toHaveLength(4); // 3 points + the repeat
  });

  it('leaves an open polyline open — a dimension line is not an area', () => {
    const { byId } = build({
      geometry: { kind: 'polyline', points: [[0, 0], [2, 0], [2, 2]], closed: false },
    });
    const polyline = [...byId.values()].find((e) => e.type === 'IfcPolyline');
    expect(polyline?.attributes[0]).toHaveLength(3);
  });

  it('emits a text literal with its layout box', () => {
    const { result, byId } = build({
      geometry: { kind: 'text', text: 'Brandmelder prüfen', position: [3, 4], width: 2, height: 0.3 },
    });
    const literal = [...byId.values()].find((e) => e.type === 'IfcTextLiteralWithExtent');
    expect(literal?.attributes[0]).toBe('Brandmelder prüfen');
    expect(literal?.attributes[4]).toBe('top-left');
    const extent = [...byId.values()].find((e) => e.type === 'IfcPlanarExtent');
    expect(extent?.attributes).toEqual([2, 0.3]);
    expect(byId.get(result.shapeRepId)?.attributes[2]).toBe('Text');
  });

  it('scales into the file\'s own length unit', () => {
    // A millimetre file must not receive metre numbers; the note would land a
    // thousand times too far from the plan it annotates.
    const { byId } = build(
      { geometry: { kind: 'polyline', points: [[1, 2], [3, 4]] } },
      { ...ANCHOR, lengthUnitScale: 0.001 } as typeof ANCHOR,
    );
    const polyline = [...byId.values()].find((e) => e.type === 'IfcPolyline');
    const refs = polyline?.attributes[0] as string[];
    const coords = refs.map((ref) => byId.get(Number(ref.slice(1)))?.attributes[0]);
    expect(coords).toEqual([[1000, 2000], [3000, 4000]]);
  });

  it('files the annotation on the storey it was drawn on', () => {
    const { result, byId } = build({
      geometry: { kind: 'polyline', points: [[0, 0], [1, 1]] },
    });
    const rel = byId.get(result.relContainedId);
    expect(rel?.type).toBe('IfcRelContainedInSpatialStructure');
    expect(rel?.attributes[4]).toEqual([`#${result.annotationId}`]);
    expect(rel?.attributes[5]).toBe('#43');
  });

  it('refuses geometry that cannot be drawn', () => {
    expect(() => build({ geometry: { kind: 'polyline', points: [[0, 0]] } })).toThrow(/at least 2 points/);
    expect(() => build({
      geometry: { kind: 'text', text: '   ', position: [0, 0], width: 1, height: 0.3 },
    })).toThrow(/non-empty/);
  });
});
