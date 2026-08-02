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
import { addLibraryTypeToStore, emitRelDefinesByType } from './library-type.js';

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

describe('addLibraryTypeToStore', () => {
  it('emits a Type entity with the IfcTypeObject/IfcElementType header + PredefinedType', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(20), view);

    const { typeId } = addLibraryTypeToStore(
      editor,
      { ownerHistoryId: 5, bodyContextId: 0, axisContextId: 0, storeyId: 0, storeyPlacementId: 0 },
      { IfcEntity: 'IfcSensorType', Name: 'Rauchmelder', Tag: 'fire.smoke-detector', PredefinedType: 'SMOKESENSOR' },
    );

    const entity = view.getNewEntities().find((e) => e.expressId === typeId);
    expect(entity?.type).toBe('IfcSensorType');
    expect(entity?.attributes[2]).toBe('Rauchmelder'); // Name
    expect(entity?.attributes[7]).toBe('fire.smoke-detector'); // Tag
    expect(entity?.attributes[9]).toBe('.SMOKESENSOR.'); // PredefinedType
  });

  it('drops PredefinedType for IFC2X3', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(20), view);
    const { typeId } = addLibraryTypeToStore(
      editor,
      { ownerHistoryId: 5, bodyContextId: 0, axisContextId: 0, storeyId: 0, storeyPlacementId: 0, schema: 'IFC2X3' },
      { IfcEntity: 'IfcSensorType', PredefinedType: 'SMOKESENSOR' },
    );
    const entity = view.getNewEntities().find((e) => e.expressId === typeId);
    expect(entity?.attributes).toHaveLength(9);
  });

  it('attaches TechnicalData as a Pset the properties panel reads (not raw HasPropertySets)', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(20), view);

    const { typeId } = addLibraryTypeToStore(
      editor,
      { ownerHistoryId: 5, bodyContextId: 0, axisContextId: 0, storeyId: 0, storeyPlacementId: 0 },
      {
        IfcEntity: 'IfcSensorType',
        TechnicalData: { OperatingVoltage: '24V DC', IPRating: 'IP42', ChannelCount: 2, IsWireless: false },
      },
    );

    const entity = view.getNewEntities().find((e) => e.expressId === typeId);
    expect(entity?.attributes[5]).toBeNull(); // HasPropertySets stays $ — Pset attached via the overlay instead
    const pset = view.getForEntity(typeId).find((p) => p.name === 'CustomTechnicalData');
    expect(pset).toBeDefined();
    expect(pset?.properties.map((p) => p.name).sort()).toEqual(
      ['ChannelCount', 'IPRating', 'IsWireless', 'OperatingVoltage'].sort(),
    );
  });

  it('does not attach a Pset when TechnicalData is empty/absent', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(20), view);
    const { typeId } = addLibraryTypeToStore(
      editor,
      { ownerHistoryId: 5, bodyContextId: 0, axisContextId: 0, storeyId: 0, storeyPlacementId: 0 },
      { IfcEntity: 'IfcSensorType' },
    );
    expect(view.getForEntity(typeId)).toHaveLength(0);
  });

  it('rejects a missing IfcEntity', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(10), view);
    expect(() => addLibraryTypeToStore(
      editor,
      { ownerHistoryId: 1, bodyContextId: 0, axisContextId: 0, storeyId: 0, storeyPlacementId: 0 },
      { IfcEntity: '' },
    )).toThrow(/IfcEntity/);
  });
});

describe('emitRelDefinesByType', () => {
  it('links related objects to a type via IfcRelDefinesByType', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(makeStore(20), view);

    const relId = emitRelDefinesByType(editor, 5, [100, 101], 200);

    const rel = view.getNewEntities().find((e) => e.expressId === relId);
    expect(rel?.type).toBe('IfcRelDefinesByType');
    expect(rel?.attributes[4]).toEqual(['#100', '#101']); // RelatedObjects
    expect(rel?.attributes[5]).toBe('#200'); // RelatingType
  });
});
