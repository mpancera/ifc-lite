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
import { emitRelAssignsToGroup } from './distribution-system.js';
import { addZoneToStore, findZone } from './zone.js';

function makeEditor() {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= 100; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  const store: MutationStoreShape = { entityIndex: { byId } };
  const view = new MutablePropertyView(null, 'm1');
  return { editor: new StoreEditor(store, view), view };
}

describe('addZoneToStore', () => {
  it('writes the IfcZone attribute order', () => {
    const { editor, view } = makeEditor();
    const { zoneId } = addZoneToStore(editor, 5, {
      Name: 'AZ-A',
      ObjectType: 'TriggerZone',
      LongName: 'Auslösezone A',
    });

    const entity = view.getNewEntities().find((e) => e.expressId === zoneId)!;
    expect(entity.type).toBe('IfcZone');
    // GlobalId, OwnerHistory, Name, Description, ObjectType, LongName
    expect(entity.attributes).toHaveLength(6);
    expect(entity.attributes[1]).toBe('#5');
    expect(entity.attributes[2]).toBe('AZ-A');
    expect(entity.attributes[3]).toBeNull();
    expect(entity.attributes[4]).toBe('TriggerZone');
    expect(entity.attributes[5]).toBe('Auslösezone A');
  });

  it('carries NO geometry — that is the whole distinction from IfcSpatialZone', () => {
    // A trigger zone is defined by which rooms it covers; asking for its
    // volume is a category error. Six attributes means no placement slot and
    // no representation slot exist to fill.
    const { editor, view } = makeEditor();
    const { zoneId } = addZoneToStore(editor, null, { Name: 'AZ-A' });

    const entity = view.getNewEntities().find((e) => e.expressId === zoneId)!;
    expect(entity.attributes).toHaveLength(6);
  });

  it('emits $ for a missing owner history', () => {
    const { editor, view } = makeEditor();
    const { zoneId } = addZoneToStore(editor, null, { Name: 'AZ-A' });

    const entity = view.getNewEntities().find((e) => e.expressId === zoneId)!;
    expect(entity.attributes[1]).toBeNull();
  });

  it('groups rooms through the same IfcRelAssignsToGroup a system uses', () => {
    // IfcZone is an IfcSystem is an IfcGroup, so membership needs no new
    // relationship type.
    const { editor, view } = makeEditor();
    const { zoneId } = addZoneToStore(editor, 5, { Name: 'AZ-A' });
    const relId = emitRelAssignsToGroup(editor, 5, [21, 22, 23], zoneId);

    const rel = view.getNewEntities().find((e) => e.expressId === relId)!;
    expect(rel.type).toBe('IfcRelAssignsToGroup');
    expect(rel.attributes[4]).toEqual(['#21', '#22', '#23']);
    expect(rel.attributes[6]).toBe(`#${zoneId}`);
  });
});

describe('findZone', () => {
  it('finds a zone this session authored, by name', () => {
    const { editor, view } = makeEditor();
    const { zoneId } = addZoneToStore(editor, 5, { Name: 'AZ-A', ObjectType: 'TriggerZone' });

    expect(findZone(view.getNewEntities(), 'AZ-A')).toBe(zoneId);
  });

  it('separates zones that share a name but not a kind', () => {
    const { editor, view } = makeEditor();
    addZoneToStore(editor, 5, { Name: 'A', ObjectType: 'TriggerZone' });
    const { zoneId } = addZoneToStore(editor, 5, { Name: 'A', ObjectType: 'EvacuationZone' });

    expect(findZone(view.getNewEntities(), 'A', 'EvacuationZone')).toBe(zoneId);
  });

  it('returns null for a name nobody authored', () => {
    const { editor, view } = makeEditor();
    addZoneToStore(editor, 5, { Name: 'AZ-A' });

    expect(findZone(view.getNewEntities(), 'AZ-B')).toBeNull();
  });

  it('ignores other entity types that happen to carry the name', () => {
    const { editor, view } = makeEditor();
    editor.addEntity('IfcSpace', ['guid', null, 'AZ-A', null, null, null, null, null, null, null, null]);

    expect(findZone(view.getNewEntities(), 'AZ-A')).toBeNull();
  });
});
