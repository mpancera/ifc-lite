/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A compartment body is the rooms, and the assertions here are about that:
 * one prism per room in ONE representation, the rooms referenced rather than
 * contained, and coordinates small enough to survive a georeferenced model.
 */

import { describe, expect, it } from 'vitest';
import {
  MutablePropertyView,
  StoreEditor,
  type MutationEntityRef,
  type MutationStoreShape,
} from '@ifc-lite/mutations';
import { addCompartmentZoneToStore } from './compartment-zone.js';
import type { SpatialAnchor } from './anchor.js';

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const ANCHOR: SpatialAnchor = {
  ownerHistoryId: 5,
  bodyContextId: 14,
  axisContextId: 15,
  storeyId: 43,
  storeyPlacementId: 54,
};

function session() {
  const view = new MutablePropertyView(null, 'm1');
  return { view, editor: new StoreEditor(makeStore(50), view) };
}

const ROOM_A = {
  Footprint: [[0, 0], [4, 0], [4, 3], [0, 3]] as Array<[number, number]>,
  BaseZ: 0,
  Height: 2.8,
};
const ROOM_B = {
  Footprint: [[5, 0], [9, 0], [9, 3], [5, 3]] as Array<[number, number]>,
  BaseZ: 3.2,
  Height: 2.8,
};

function entities(view: MutablePropertyView) {
  return view.getNewEntities();
}

describe('addCompartmentZoneToStore', () => {
  it('puts one prism per room into ONE body', () => {
    const { editor, view } = session();
    const result = addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01', parts: [ROOM_A, ROOM_B], RelatedElements: [7, 8],
    });

    expect(result.solids).toBe(2);
    const solids = entities(view).filter((e) => e.type === 'IfcExtrudedAreaSolid');
    expect(solids).toHaveLength(2);
    const reps = entities(view).filter((e) => e.type === 'IfcShapeRepresentation');
    expect(reps).toHaveLength(1);
    // The whole point: Items is a SET, and a compartment is several rooms.
    expect(reps[0].attributes[3]).toHaveLength(2);
  });

  it('is a FIRESAFETY zone by default', () => {
    const { editor, view } = session();
    const result = addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01', parts: [ROOM_A], RelatedElements: [],
    });

    const zone = entities(view).find((e) => e.expressId === result.zoneId);
    expect(zone?.type).toBe('IfcSpatialZone');
    // Nine attributes: IfcSpatialZone derives from IfcSpatialElement, so there
    // is no CompositionType.
    expect(zone?.attributes).toHaveLength(9);
    expect(zone?.attributes[8]).toBe('.FIRESAFETY.');
  });

  it('carries the ObjectType a receiving check asks for', () => {
    const { editor, view } = session();
    const result = addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01', ObjectType: 'FIRECOMPARTMENT', parts: [ROOM_A], RelatedElements: [],
    });

    const zone = entities(view).find((e) => e.expressId === result.zoneId);
    expect(zone?.attributes[4]).toBe('FIRECOMPARTMENT');
  });

  it('REFERENCES its rooms, so the storey that contains them still does', () => {
    const { editor, view } = session();
    const result = addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01', parts: [ROOM_A], RelatedElements: [7, 8],
    });

    const rel = entities(view).find((e) => e.expressId === result.relReferencedId);
    // Not IfcRelContainedInSpatialStructure: containment is exclusive, and
    // re-parenting a room to a zone would rewrite the building's hierarchy.
    expect(rel?.type).toBe('IfcRelReferencedInSpatialStructure');
    expect(rel?.attributes[4]).toEqual(['#7', '#8']);
    expect(rel?.attributes[5]).toBe(`#${result.zoneId}`);
  });

  it('writes no relationship when nothing was referenced', () => {
    const { editor } = session();
    const result = addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01', parts: [ROOM_A], RelatedElements: [],
    });

    expect(result.relReferencedId).toBeNull();
  });

  it('states profiles relative to the zone, so a georeferenced model stays readable', () => {
    // Swiss coordinates put a building at 2.6 million. A profile written in
    // those has points differing in the seventh digit — fine in a double, gone
    // the moment anything downstream keeps it in a float.
    const { editor, view } = session();
    addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01',
      parts: [{
        Footprint: [[2665486, 1259317], [2665490, 1259317], [2665490, 1259320], [2665486, 1259320]],
        BaseZ: 381.3,
        Height: 2.8,
      }],
      RelatedElements: [],
    });

    const points = entities(view)
      .filter((e) => e.type === 'IfcCartesianPoint' && (e.attributes[0] as number[]).length === 2)
      .map((e) => e.attributes[0] as number[]);
    expect(points.length).toBeGreaterThan(0);
    for (const [x, y] of points) {
      expect(Math.abs(x)).toBeLessThan(100);
      expect(Math.abs(y)).toBeLessThan(100);
    }
  });

  it('keeps each room at its own floor height', () => {
    // The one thing rooms on different storeys cannot share, and the reason
    // the base is on the solid rather than on the zone.
    const { editor, view } = session();
    addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01', parts: [ROOM_A, ROOM_B], RelatedElements: [],
    });

    const zs = entities(view)
      .filter((e) => e.type === 'IfcCartesianPoint' && (e.attributes[0] as number[]).length === 3)
      .map((e) => (e.attributes[0] as number[])[2]);
    expect(zs).toContain(0);
    expect(zs).toContain(3.2);
  });

  it('attaches a property set to the zone', () => {
    const { editor, view } = session();
    const result = addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01',
      parts: [ROOM_A],
      RelatedElements: [],
      PropertySet: {
        name: 'CHIBB_FireCompartmentRequirements',
        properties: [{ name: 'FireRatingWalls', value: 'EI60' }],
      },
    });

    const pset = entities(view).find((e) => e.expressId === result.propertySetId);
    expect(pset?.type).toBe('IfcPropertySet');
    expect(pset?.attributes[2]).toBe('CHIBB_FireCompartmentRequirements');

    const value = entities(view).find((e) => e.type === 'IfcPropertySingleValue');
    expect(value?.attributes[0]).toBe('FireRatingWalls');
    // The typed marker, not a hand-built token: NominalValue is a SELECT and
    // a plain string would be escaped into a quoted literal.
    expect(value?.attributes[2]).toEqual({ typed: { type: 'IfcLabel', value: 'EI60' } });

    const rel = entities(view).find((e) => e.type === 'IfcRelDefinesByProperties');
    expect(rel?.attributes[4]).toEqual([`#${result.zoneId}`]);
  });

  it('refuses a compartment with no rooms rather than writing an empty body', () => {
    const { editor } = session();

    expect(() => addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01', parts: [], RelatedElements: [7],
    })).toThrow(/no rooms/);
  });

  it('refuses a degenerate part before writing anything', () => {
    // Checked for every part up front: the emit loop would otherwise leave
    // half a compartment in the overlay and report failure.
    const { editor, view } = session();

    expect(() => addCompartmentZoneToStore(editor, ANCHOR, {
      Name: 'BA-01',
      parts: [ROOM_A, { ...ROOM_B, Height: 0 }],
      RelatedElements: [],
    })).toThrow(/positive Height/);
    expect(entities(view)).toHaveLength(0);
  });

  it('refuses IFC2X3, which has no IfcSpatialZone', () => {
    const { editor } = session();

    expect(() => addCompartmentZoneToStore(editor, { ...ANCHOR, schema: 'IFC2X3' }, {
      Name: 'BA-01', parts: [ROOM_A], RelatedElements: [],
    })).toThrow(/IFC4 or later/);
  });
});
