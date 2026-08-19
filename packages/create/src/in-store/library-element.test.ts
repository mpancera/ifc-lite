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
import { addLibraryElementToStore } from './library-element.js';

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

describe('addLibraryElementToStore', () => {
  it('contains the element in the room when one was resolved, else in the storey', () => {
    // The contract the block schema depends on: a device states the room it
    // sits in, so element-room-storey is a chain and not three islands.
    // Asserted here as well as on the sensor builder, because a catalog
    // element and a plain sensor must not disagree about their container.
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(80), view);
    const anchor = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, storeyId: 43, storeyPlacementId: 54 };

    const roomed = addLibraryElementToStore(editor, anchor, {
      IfcEntity: 'IfcSensor', Position: [1, 1, 0], ContainerId: 61,
    });
    const loose = addLibraryElementToStore(editor, anchor, {
      IfcEntity: 'IfcSensor', Position: [9, 9, 0],
    });

    const byId = new Map(view.getNewEntities().map((e) => [e.expressId, e]));
    expect(byId.get(roomed.relContainedId)?.attributes[5]).toBe('#61');
    expect(byId.get(loose.relContainedId)?.attributes[5]).toBe('#43');
  });

  it('emits the requested IFC entity with header + PredefinedType', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(40), view);

    const result = addLibraryElementToStore(
      editor,
      { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, storeyId: 43, storeyPlacementId: 54 },
      { IfcEntity: 'IfcAlarm', Position: [1, 2, 0], PredefinedType: 'SIREN' },
    );

    const element = view.getNewEntities().find((e) => e.expressId === result.elementId);
    expect(element?.type).toBe('IfcAlarm');
    expect(element?.attributes[2]).toBe('Alarm');  // default Name
    expect(element?.attributes[8]).toBe('.SIREN.');
  });

  it('supports different entities from the same builder (data-driven catalog)', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(40), view);

    const sensor = addLibraryElementToStore(
      editor,
      { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, storeyId: 43, storeyPlacementId: 54 },
      { IfcEntity: 'IfcSensor', Position: [0, 0, 0], PredefinedType: 'FIRESENSOR' },
    );
    const camera = addLibraryElementToStore(
      editor,
      { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, storeyId: 43, storeyPlacementId: 54 },
      { IfcEntity: 'IfcAudioVisualAppliance', Position: [3, 0, 0], PredefinedType: 'CAMERA' },
    );

    const byId = new Map(view.getNewEntities().map((e) => [e.expressId, e]));
    expect(byId.get(sensor.elementId)?.type).toBe('IfcSensor');
    expect(byId.get(camera.elementId)?.type).toBe('IfcAudioVisualAppliance');
  });

  it('supports USERDEFINED + ObjectType (e.g. Glasbruchmelder)', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(40), view);

    const result = addLibraryElementToStore(
      editor,
      { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, storeyId: 43, storeyPlacementId: 54 },
      {
        IfcEntity: 'IfcSensor',
        Position: [0, 0, 0],
        PredefinedType: 'USERDEFINED',
        ObjectType: 'GLASSBREAKSENSOR',
      },
    );

    const element = view.getNewEntities().find((e) => e.expressId === result.elementId);
    expect(element?.attributes[4]).toBe('GLASSBREAKSENSOR');  // ObjectType (IfcObject header)
    expect(element?.attributes[8]).toBe('.USERDEFINED.');
  });

  it('drops PredefinedType for IFC2X3', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(40), view);
    const result = addLibraryElementToStore(
      editor,
      { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, storeyId: 43, storeyPlacementId: 54, schema: 'IFC2X3' },
      { IfcEntity: 'IfcSensor', Position: [0, 0, 0], PredefinedType: 'FIRESENSOR' },
    );
    const element = view.getNewEntities().find((e) => e.expressId === result.elementId);
    expect(element?.attributes).toHaveLength(8);
  });

  it('rejects a missing IfcEntity', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(10), view);
    expect(() => addLibraryElementToStore(
      editor,
      { ownerHistoryId: 1, bodyContextId: 2, axisContextId: 3, storeyId: 3, storeyPlacementId: 4 },
      { IfcEntity: '', Position: [0, 0, 0] },
    )).toThrow(/IfcEntity/);
  });

  it('rejects non-positive dimensions', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(10), view);
    expect(() => addLibraryElementToStore(
      editor,
      { ownerHistoryId: 1, bodyContextId: 2, axisContextId: 3, storeyId: 3, storeyPlacementId: 4 },
      { IfcEntity: 'IfcSensor', Position: [0, 0, 0], Width: 0 },
    )).toThrow(/positive/);
  });
});
