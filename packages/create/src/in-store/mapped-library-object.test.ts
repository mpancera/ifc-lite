/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { SpatialAnchor } from './anchor.js';
import {
  addMappedOccurrenceToStore,
  addRepresentationMapToStore,
  emitRelAssignsToProduct,
} from './mapped-library-object.js';
import { addLibraryTypeToStore } from './library-type.js';

function makeEditor() {
  const store = {
    entityIndex: { byId: new Map([[1, { expressId: 1 }]]) },
  } as never;
  return new StoreEditor(store, new MutablePropertyView());
}

function anchorFor(lengthUnitScale = 1): SpatialAnchor {
  return {
    ownerHistoryId: 1,
    bodyContextId: 1,
    axisContextId: 1,
    storeyId: 1,
    storeyPlacementId: 1,
    lengthUnitScale,
    // Seeded so two runs produce the same GlobalIds and a diff is readable.
    guidRandom: () => 0.42,
  };
}

function entitiesOf(editor: StoreEditor) {
  return [...editor.getNewEntities()];
}

function one(editor: StoreEditor, type: string) {
  const found = entitiesOf(editor).filter((e) => e.type === type);
  expect(found).toHaveLength(1);
  return found[0];
}

describe('addRepresentationMapToStore', () => {
  it('anchors the map at the object’s own origin', () => {
    // Not at the occurrence's position: the source was modelled around its own
    // insertion point, and an offset here would sit invisibly between what the
    // author drew and what gets placed.
    const editor = makeEditor();
    const { mapId } = addRepresentationMapToStore(editor, { shapeRepresentationId: 99 });

    const map = entitiesOf(editor).find((e) => e.expressId === mapId)!;
    expect(map.type).toBe('IfcRepresentationMap');
    expect(map.attributes[1]).toBe('#99');

    const origin = one(editor, 'IfcAxis2Placement3D');
    const point = entitiesOf(editor).find((e) => `#${e.expressId}` === origin.attributes[0])!;
    expect(point.attributes[0]).toEqual([0, 0, 0]);
    // Identity: no axis, no reference direction.
    expect(origin.attributes[1]).toBeNull();
    expect(origin.attributes[2]).toBeNull();
  });
});

describe('the type that carries the map', () => {
  it('writes the maps into RepresentationMaps, which is index 6', () => {
    // GlobalId, OwnerHistory, Name, Description, ApplicableOccurrence,
    // HasPropertySets, RepresentationMaps. Off by one and the maps land in
    // HasPropertySets, where a reader finds property sets that are geometry.
    const editor = makeEditor();
    const { typeId } = addLibraryTypeToStore(editor, anchorFor(), {
      IfcEntity: 'IfcFireSuppressionTerminalType',
      Name: 'Handfeuerloescher',
      RepresentationMapIds: [77],
    });

    const type = entitiesOf(editor).find((e) => e.expressId === typeId)!;
    expect(type.attributes[6]).toEqual(['#77']);
    expect(type.attributes[5]).toBeNull();
  });

  it('leaves RepresentationMaps empty when there is no geometry to share', () => {
    // The ordinary catalogue placement builds a box per occurrence and has no
    // map; an empty list there would be a different statement from "none".
    const editor = makeEditor();
    const { typeId } = addLibraryTypeToStore(editor, anchorFor(), {
      IfcEntity: 'IfcSensorType',
    });
    expect(entitiesOf(editor).find((e) => e.expressId === typeId)!.attributes[6]).toBeNull();
  });
});

describe('addMappedOccurrenceToStore', () => {
  it('shows the shared geometry through a mapped item', () => {
    const editor = makeEditor();
    const result = addMappedOccurrenceToStore(editor, anchorFor(), {
      IfcEntity: 'IfcFireSuppressionTerminal',
      mapId: 55,
      Position: [1, 2, 0],
    });

    const mapped = one(editor, 'IfcMappedItem');
    expect(mapped.attributes[0]).toBe('#55');
    expect(result.mappedItemId).toBe(mapped.expressId);

    const shape = one(editor, 'IfcShapeRepresentation');
    // The representation type names what the ITEMS are, and the one item here
    // is a mapped item. Repeating the source's own 'SweptSolid' would send a
    // reader looking for a solid and hand them a reference.
    expect(shape.attributes[2]).toBe('MappedRepresentation');
    expect(shape.attributes[3]).toEqual([`#${mapped.expressId}`]);
  });

  it('carries the unit factor on the operator, not in the geometry', () => {
    // A metre source in a millimetre model. Nothing about the shared geometry
    // changes; the occurrence states the factor.
    const editor = makeEditor();
    addMappedOccurrenceToStore(editor, anchorFor(0.001), {
      IfcEntity: 'IfcSensor',
      mapId: 55,
      Position: [0, 0, 0],
      Scale: 1000,
    });

    const operator = one(editor, 'IfcCartesianTransformationOperator3D');
    expect(operator.attributes[3]).toEqual({ real: 1000 });
  });

  it('writes an unscaled occurrence as a REAL, not an integer', () => {
    // `IfcCartesianTransformationOperator3D.Scale` is a REAL. Serialised as
    // `1` it is a STEP INTEGER, which a strict reader rejects.
    const editor = makeEditor();
    addMappedOccurrenceToStore(editor, anchorFor(), {
      IfcEntity: 'IfcSensor',
      mapId: 55,
      Position: [0, 0, 0],
    });

    expect(one(editor, 'IfcCartesianTransformationOperator3D').attributes[3]).toEqual({ real: 1 });
  });

  it('puts the position in the placement and leaves the operator at the origin', () => {
    // Keeping the two apart is what lets somebody move the object later by
    // editing one placement, instead of hunting for an offset in a transform.
    const editor = makeEditor();
    addMappedOccurrenceToStore(editor, anchorFor(), {
      IfcEntity: 'IfcSensor',
      mapId: 55,
      Position: [1.5, -2, 0.25],
    });

    const points = entitiesOf(editor).filter((e) => e.type === 'IfcCartesianPoint');
    const coords = points.map((p) => p.attributes[0]);
    expect(coords).toContainEqual([1.5, -2, 0.25]);
    // The operator's own origin stays at zero.
    expect(coords).toContainEqual([0, 0, 0]);
  });

  it('converts the position into the model’s own unit', () => {
    // The POSITION is a plain coordinate in this file and must be in this
    // file's unit — unlike the mapped geometry, which the operator scales.
    const editor = makeEditor();
    addMappedOccurrenceToStore(editor, anchorFor(0.001), {
      IfcEntity: 'IfcSensor',
      mapId: 55,
      Position: [1.5, -2, 0.25],
      Scale: 1000,
    });

    const coords = entitiesOf(editor)
      .filter((e) => e.type === 'IfcCartesianPoint')
      .map((p) => p.attributes[0]);
    expect(coords).toContainEqual([1500, -2000, 250]);
  });

  it('contains the occurrence in the storey unless told otherwise', () => {
    const editor = makeEditor();
    const inStorey = addMappedOccurrenceToStore(editor, anchorFor(), {
      IfcEntity: 'IfcSensor', mapId: 55, Position: [0, 0, 0],
    });
    expect(inStorey.containerId).toBe(1);

    const inSpace = addMappedOccurrenceToStore(editor, anchorFor(), {
      IfcEntity: 'IfcSensor', mapId: 55, Position: [0, 0, 0], ContainerId: 42,
    });
    expect(inSpace.containerId).toBe(42);
  });

  it('refuses a scale that cannot mean anything', () => {
    const editor = makeEditor();
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => addMappedOccurrenceToStore(editor, anchorFor(), {
        IfcEntity: 'IfcSensor', mapId: 55, Position: [0, 0, 0], Scale: scale,
      })).toThrow(/Scale/);
    }
  });

  it('omits PredefinedType on IFC2X3, where the attribute does not exist', () => {
    const editor = makeEditor();
    addMappedOccurrenceToStore(editor, { ...anchorFor(), schema: 'IFC2X3' }, {
      IfcEntity: 'IfcSensor', mapId: 55, Position: [0, 0, 0], PredefinedType: 'SMOKESENSOR',
    });

    const sensor = one(editor, 'IfcSensor');
    expect(sensor.attributes).not.toContain('.SMOKESENSOR.');
  });
});

describe('emitRelAssignsToProduct', () => {
  it('relates the companion bodies to the device instead of making them parts of it', () => {
    // A clearance in front of an extinguisher is an agreement, not matter.
    // Aggregated into the device, the file would say the device is 80 cm deep.
    const editor = makeEditor();
    const relId = emitRelAssignsToProduct(editor, 1, [10, 11], 9, () => 0.42);

    const rel = entitiesOf(editor).find((e) => e.expressId === relId)!;
    expect(rel.type).toBe('IfcRelAssignsToProduct');
    expect(rel.attributes[4]).toEqual(['#10', '#11']);
    expect(rel.attributes[6]).toBe('#9');
  });
});
