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
import {
  addDistributionSystemToStore,
  emitRelAssignsToGroup,
  findDistributionSystem,
} from './distribution-system.js';

function makeEditor() {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= 100; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  const store: MutationStoreShape = { entityIndex: { byId } };
  const view = new MutablePropertyView(null, 'm1');
  return { editor: new StoreEditor(store, view), view };
}

describe('addDistributionSystemToStore', () => {
  it('writes the IfcDistributionSystem attribute order', () => {
    const { editor, view } = makeEditor();
    const { systemId } = addDistributionSystemToStore(editor, 5, {
      PredefinedType: 'FIREPROTECTION',
      ObjectType: 'FireDetection',
      Name: 'Fire · Branddetektion',
    });

    const entity = view.getNewEntities().find((e) => e.expressId === systemId)!;
    expect(entity.type).toBe('IfcDistributionSystem');
    // GlobalId, OwnerHistory, Name, Description, ObjectType, LongName, PredefinedType
    expect(entity.attributes).toHaveLength(7);
    expect(entity.attributes[1]).toBe('#5');
    expect(entity.attributes[2]).toBe('Fire · Branddetektion');
    expect(entity.attributes[3]).toBeNull();
    expect(entity.attributes[4]).toBe('FireDetection');
    expect(entity.attributes[5]).toBeNull();
    expect(entity.attributes[6]).toBe('.FIREPROTECTION.');
  });

  it('leaves the owner-history reference empty when there is none', () => {
    const { editor, view } = makeEditor();
    const { systemId } = addDistributionSystemToStore(editor, null, { PredefinedType: 'SECURITY' });
    const entity = view.getNewEntities().find((e) => e.expressId === systemId)!;
    expect(entity.attributes[1]).toBeNull();
    expect(entity.attributes[4]).toBeNull();
  });
});

describe('emitRelAssignsToGroup', () => {
  it('writes the IfcRelAssignsToGroup attribute order', () => {
    const { editor, view } = makeEditor();
    const { systemId } = addDistributionSystemToStore(editor, 5, { PredefinedType: 'CONTROL' });
    const relId = emitRelAssignsToGroup(editor, 5, [42, 43], systemId);

    const rel = view.getNewEntities().find((e) => e.expressId === relId)!;
    expect(rel.type).toBe('IfcRelAssignsToGroup');
    // GlobalId, OwnerHistory, Name, Description, RelatedObjects, RelatedObjectsType, RelatingGroup
    expect(rel.attributes).toHaveLength(7);
    expect(rel.attributes[4]).toEqual(['#42', '#43']);
    expect(rel.attributes[5]).toBeNull();
    expect(rel.attributes[6]).toBe(`#${systemId}`);
  });
});

describe('findDistributionSystem', () => {
  it('finds a system by PredefinedType and ObjectType', () => {
    const { editor, view } = makeEditor();
    const { systemId } = addDistributionSystemToStore(editor, 5, {
      PredefinedType: 'FIREPROTECTION', ObjectType: 'FireDetection',
    });

    expect(findDistributionSystem(view.getNewEntities(), 'FIREPROTECTION', 'FireDetection')).toBe(systemId);
  });

  it('separates installations that share a PredefinedType', () => {
    // All four fire systems are FIREPROTECTION; only ObjectType tells them
    // apart, so matching on PredefinedType alone would merge them.
    const { editor, view } = makeEditor();
    const detection = addDistributionSystemToStore(editor, 5, {
      PredefinedType: 'FIREPROTECTION', ObjectType: 'FireDetection',
    }).systemId;
    const suppression = addDistributionSystemToStore(editor, 5, {
      PredefinedType: 'FIREPROTECTION', ObjectType: 'FireSuppression',
    }).systemId;

    expect(detection).not.toBe(suppression);
    expect(findDistributionSystem(view.getNewEntities(), 'FIREPROTECTION', 'FireDetection')).toBe(detection);
    expect(findDistributionSystem(view.getNewEntities(), 'FIREPROTECTION', 'FireSuppression')).toBe(suppression);
  });

  it('reports no match for an installation that has not been authored', () => {
    const { editor, view } = makeEditor();
    addDistributionSystemToStore(editor, 5, { PredefinedType: 'FIREPROTECTION', ObjectType: 'FireDetection' });
    expect(findDistributionSystem(view.getNewEntities(), 'SECURITY', 'AccessControl')).toBeNull();
  });

  it('ignores unrelated authored entities', () => {
    const { editor, view } = makeEditor();
    editor.addEntity('IfcWall', ['guid', null, 'Wall', null, null, '#1', '#2', null]);
    expect(findDistributionSystem(view.getNewEntities(), 'CONTROL', 'PrimarySystems')).toBeNull();
  });
});
