/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import {
  MutablePropertyView,
  StoreEditor,
  type MutationEntityRef,
  type MutationStoreShape,
} from '@ifc-lite/mutations';
import { addAnchoredSpatialZoneToStore } from './spatial-zone-anchored.js';
import type { SpatialAnchor } from './anchor.js';

function makeEditor() {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= 200; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  const store: MutationStoreShape = { entityIndex: { byId } };
  const view = new MutablePropertyView(null, 'm1');
  return { editor: new StoreEditor(store, view), view };
}

const anchor: SpatialAnchor = {
  ownerHistoryId: 5, bodyContextId: 14, axisContextId: 0, storeyId: 43, storeyPlacementId: 54,
};

describe('addAnchoredSpatialZoneToStore', () => {
  it('writes the IfcSpatialZone attribute order', () => {
    const { editor, view } = makeEditor();
    const { spatialZoneId } = addAnchoredSpatialZoneToStore(editor, anchor, {
      Name: 'BA-01', Position: [0, 0, 0], Width: 10, Depth: 8, Height: 3,
      PredefinedType: 'FIRESAFETY', LongName: 'Brandabschnitt 01',
    });

    const entity = view.getNewEntities().find((e) => e.expressId === spatialZoneId)!;
    expect(entity.type).toBe('IfcSpatialZone');
    // GlobalId, OwnerHistory, Name, Description, ObjectType,
    // ObjectPlacement, Representation, LongName, PredefinedType
    expect(entity.attributes).toHaveLength(9);
    expect(entity.attributes[2]).toBe('BA-01');
    expect(entity.attributes[7]).toBe('Brandabschnitt 01');
    expect(entity.attributes[8]).toBe('.FIRESAFETY.');
  });

  it('HAS geometry — the whole distinction from IfcZone', () => {
    // A fire compartment has an extent: you can cut a section through it and
    // ask for its area. Both slots must be filled with real references.
    const { editor, view } = makeEditor();
    const { spatialZoneId } = addAnchoredSpatialZoneToStore(editor, anchor, {
      Name: 'BA-01', Position: [0, 0, 0], Width: 10, Depth: 8, Height: 3,
    });

    const entity = view.getNewEntities().find((e) => e.expressId === spatialZoneId)!;
    expect(String(entity.attributes[5])).toMatch(/^#\d+$/); // ObjectPlacement
    expect(String(entity.attributes[6])).toMatch(/^#\d+$/); // Representation
  });

  it('defaults to NOTDEFINED rather than guessing a kind', () => {
    const { editor, view } = makeEditor();
    const { spatialZoneId } = addAnchoredSpatialZoneToStore(editor, anchor, {
      Name: 'Z', Position: [0, 0, 0], Width: 1, Depth: 1, Height: 1,
    });

    const entity = view.getNewEntities().find((e) => e.expressId === spatialZoneId)!;
    expect(entity.attributes[8]).toBe('.NOTDEFINED.');
  });

  it('accepts an arbitrary footprint polygon', () => {
    const { editor, view } = makeEditor();
    const { spatialZoneId } = addAnchoredSpatialZoneToStore(editor, anchor, {
      Name: 'BA-02', Height: 3,
      OuterCurve: [[0, 0], [6, 0], [6, 4], [3, 7], [0, 4]],
      PredefinedType: 'SECURITY',
    });

    const entity = view.getNewEntities().find((e) => e.expressId === spatialZoneId)!;
    expect(entity.attributes[8]).toBe('.SECURITY.');
    expect(String(entity.attributes[6])).toMatch(/^#\d+$/);
  });

  it('is NOT aggregated into the storey', () => {
    // A fire compartment routinely spans several storeys; filing it under one
    // would state something false. It is placed relative to the storey, not
    // made a part of it.
    const { editor, view } = makeEditor();
    addAnchoredSpatialZoneToStore(editor, anchor, {
      Name: 'BA-01', Position: [0, 0, 0], Width: 10, Depth: 8, Height: 3,
    });

    const aggregates = view.getNewEntities().filter((e) => e.type === 'IfcRelAggregates');
    expect(aggregates).toHaveLength(0);
  });

  it('emits $ when the model has no owner history', () => {
    const { editor, view } = makeEditor();
    const { spatialZoneId } = addAnchoredSpatialZoneToStore(
      editor,
      { ...anchor, ownerHistoryId: null },
      { Name: 'Z', Position: [0, 0, 0], Width: 1, Depth: 1, Height: 1 },
    );

    const entity = view.getNewEntities().find((e) => e.expressId === spatialZoneId)!;
    expect(entity.attributes[1]).toBeNull();
  });

  it('rejects a degenerate footprint instead of writing an unusable body', () => {
    const { editor } = makeEditor();
    expect(() => addAnchoredSpatialZoneToStore(editor, anchor, {
      Name: 'Z', Height: 3, OuterCurve: [[0, 0], [1, 1]],
    })).toThrow(/three points/);
  });

  it('rejects a non-positive height', () => {
    const { editor } = makeEditor();
    expect(() => addAnchoredSpatialZoneToStore(editor, anchor, {
      Name: 'Z', Position: [0, 0, 0], Width: 1, Depth: 1, Height: 0,
    })).toThrow(/Height/);
  });

  it('emits native-unit geometry for a millimetre model', () => {
    // Params are metres. Without conversion a compartment baked into a mm
    // model reopens 1000x too small.
    const { editor, view } = makeEditor();
    const { spatialZoneId } = addAnchoredSpatialZoneToStore(
      editor,
      { ...anchor, lengthUnitScale: 0.001 } as SpatialAnchor,
      { Name: 'Z', Position: [0, 0, 0], Width: 10, Depth: 8, Height: 3 },
    );

    const byId = new Map(view.getNewEntities().map((e) => [e.expressId, e]));
    const zone = byId.get(spatialZoneId)!;
    const solid = view.getNewEntities().find((e) => e.type === 'IfcExtrudedAreaSolid')!;
    // Depth is the extrusion: 3 m in a mm file is 3000.
    expect(solid.attributes[3]).toBe(3000);
    expect(zone.type).toBe('IfcSpatialZone');
  });
});
