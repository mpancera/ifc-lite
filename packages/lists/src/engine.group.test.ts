/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The `group` column/condition source: IFC group membership via
 * `IfcRelAssignsToGroup` — which zone a room is in, which system a duct
 * belongs to.
 *
 * Not to be confused with `zone` (issue #1810, `engine.zone.test.ts`), whose
 * zones are viewer-side boxes that never reach the file. These memberships are
 * real entities and survive an export, which is the whole reason a list needs
 * to filter on them.
 */

import { describe, it, expect } from 'vitest';
import { IfcTypeEnum } from '@ifc-lite/data';
import { executeList } from './engine.js';
import type { ListDataProvider, ListDefinition } from './types.js';

type Group = { name: string; ifcType: string };

function createProvider(groups: Map<number, Group[]>): ListDataProvider {
  return {
    getEntitiesByType: (t) => (t === IfcTypeEnum.IfcSpace ? [1, 2, 3] : []),
    getEntityName: (id) => `Room-${id}`,
    getEntityGlobalId: (id) => `guid-${id}`,
    getEntityDescription: () => '',
    getEntityObjectType: () => '',
    getEntityTag: () => '',
    getEntityTypeName: () => 'IfcSpace',
    getPropertySets: () => [],
    getQuantitySets: () => [],
    getEntityGroupNames: (id) => groups.get(id) ?? [],
  };
}

function rooms(
  columns: ListDefinition['columns'],
  conditions: ListDefinition['conditions'] = [],
): ListDefinition {
  return {
    id: 't', name: 'T', createdAt: 0, updatedAt: 0,
    entityTypes: [IfcTypeEnum.IfcSpace], conditions, columns,
  };
}

const zoneColumn = [{ id: 'c', source: 'group' as const, propertyName: 'Zone', label: 'Zone' }];

describe('group column', () => {
  it('shows the zone a room belongs to', () => {
    const provider = createProvider(new Map([[1, [{ name: 'AZ-A', ifcType: 'IfcZone' }]]]));

    const result = executeList(rooms(zoneColumn), provider);

    expect(result.rows[0].values[0]).toBe('AZ-A');
  });

  it('joins every zone when a room is in several', () => {
    // IFC allows it, and showing only the first would make the list lie.
    const provider = createProvider(new Map([[1, [
      { name: 'AZ-A', ifcType: 'IfcZone' },
      { name: 'Brandabschnitt 2', ifcType: 'IfcSpatialZone' },
    ]]]));

    expect(executeList(rooms(zoneColumn), provider).rows[0].values[0])
      .toBe('AZ-A, Brandabschnitt 2');
  });

  it('leaves a room in no zone empty', () => {
    const result = executeList(rooms(zoneColumn), createProvider(new Map()));

    expect(result.rows[0].values[0]).toBeNull();
  });

  it('filters systems out of a Zone column', () => {
    // A room in a zone AND a system must show the zone only — otherwise the
    // column named Zone answers a different question for some rows.
    const provider = createProvider(new Map([[1, [
      { name: 'BMA', ifcType: 'IfcDistributionSystem' },
      { name: 'AZ-A', ifcType: 'IfcZone' },
    ]]]));

    expect(executeList(rooms(zoneColumn), provider).rows[0].values[0]).toBe('AZ-A');
  });

  it('shows systems under a System column', () => {
    const provider = createProvider(new Map([[1, [
      { name: 'BMA', ifcType: 'IfcDistributionSystem' },
      { name: 'AZ-A', ifcType: 'IfcZone' },
    ]]]));
    const columns = [{ id: 'c', source: 'group' as const, propertyName: 'System', label: 'System' }];

    expect(executeList(rooms(columns), provider).rows[0].values[0]).toBe('BMA');
  });

  it('shows everything under All', () => {
    const provider = createProvider(new Map([[1, [
      { name: 'BMA', ifcType: 'IfcDistributionSystem' },
      { name: 'AZ-A', ifcType: 'IfcZone' },
    ]]]));
    const columns = [{ id: 'c', source: 'group' as const, propertyName: 'All', label: 'Group' }];

    expect(executeList(rooms(columns), provider).rows[0].values[0]).toBe('BMA, AZ-A');
  });

  it('treats an unrecognised filter as Zone', () => {
    // Same forgiving rule the `spatial` level selector follows.
    const provider = createProvider(new Map([[1, [{ name: 'AZ-A', ifcType: 'IfcZone' }]]]));
    const columns = [{ id: 'c', source: 'group' as const, propertyName: 'Quatsch', label: 'Z' }];

    expect(executeList(rooms(columns), provider).rows[0].values[0]).toBe('AZ-A');
  });

  it('is empty for a provider that has no group data at all', () => {
    const provider = { ...createProvider(new Map()), getEntityGroupNames: undefined };

    expect(executeList(rooms(zoneColumn), provider).rows[0].values[0]).toBeNull();
  });

  it('de-duplicates a zone named twice', () => {
    const provider = createProvider(new Map([[1, [
      { name: 'AZ-A', ifcType: 'IfcZone' },
      { name: 'AZ-A', ifcType: 'IfcSpatialZone' },
    ]]]));

    expect(executeList(rooms(zoneColumn), provider).rows[0].values[0]).toBe('AZ-A');
  });
});

describe('group condition', () => {
  const provider = createProvider(new Map([
    [1, [{ name: 'AZ-A', ifcType: 'IfcZone' }]],
    [2, [{ name: 'AZ-B', ifcType: 'IfcZone' }]],
  ]));

  it('filters rooms down to one zone', () => {
    const list = rooms(zoneColumn, [
      { id: 'f', source: 'group', propertyName: 'Zone', operator: 'equals', value: 'AZ-A' },
    ]);

    expect(executeList(list, provider).rows.map((r) => r.entityId)).toEqual([1]);
  });

  it('finds the rooms that are in no zone yet', () => {
    // The everyday question after painting: what did I miss? `exists` alone
    // could not ask it — hence `notExists`.
    const list = rooms(zoneColumn, [
      { id: 'f', source: 'group', propertyName: 'Zone', operator: 'notExists', value: '' },
    ]);

    expect(executeList(list, provider).rows.map((r) => r.entityId)).toEqual([3]);
  });

  it('finds the rooms that are in some zone', () => {
    const list = rooms(zoneColumn, [
      { id: 'f', source: 'group', propertyName: 'Zone', operator: 'exists', value: '' },
    ]);

    expect(executeList(list, provider).rows.map((r) => r.entityId)).toEqual([1, 2]);
  });

  it('matches part of a name', () => {
    const list = rooms(zoneColumn, [
      { id: 'f', source: 'group', propertyName: 'Zone', operator: 'contains', value: 'AZ-' },
    ]);

    expect(executeList(list, provider).rows.map((r) => r.entityId)).toEqual([1, 2]);
  });
});
