/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The `Room` spatial level, and what distinguishes it from `Container`.
 *
 * `Container` resolves the immediate spatial parent and falls back to the
 * storey, so every storey-contained element reports a storey — which makes it
 * impossible to tell "sits on the storey" from "no room yet". `Room` reports
 * only a real IfcSpace.
 */

import { describe, it, expect } from 'vitest';
import { IfcTypeEnum } from '@ifc-lite/data';
import { executeList } from './engine.js';
import type { ListDataProvider, ListDefinition } from './types.js';

const IN_ROOM = 1;
const ON_STOREY = 2;

function provider(withRooms = true): ListDataProvider {
  const names = new Map([[IN_ROOM, 'Melder A'], [ON_STOREY, 'Melder B']]);
  const base: ListDataProvider = {
    getEntitiesByType: (t) => (t === IfcTypeEnum.IfcSensor ? [IN_ROOM, ON_STOREY] : []),
    getEntityName: (id) => names.get(id) ?? '',
    getEntityGlobalId: (id) => `g${id}`,
    getEntityDescription: () => '',
    getEntityObjectType: () => '',
    getEntityTag: () => '',
    getEntityTypeName: (id) => (names.has(id) ? 'IfcSensor' : ''),
    getPropertySets: () => [],
    getQuantitySets: () => [],
    getAllEntityIds: () => [...names.keys()],
    // Falls back to the storey for the element that has no room, as the real
    // adapter does.
    getContainerName: (id) => (id === IN_ROOM ? '06' : 'E00'),
    getStoreyName: () => 'E00',
  };
  if (!withRooms) return base;
  return { ...base, getSpaceName: (id) => (id === IN_ROOM ? '06' : '') };
}

function defWith(level: string): ListDefinition {
  return {
    id: 'rooms', name: 'rooms', createdAt: 0, updatedAt: 0,
    entityTypes: [IfcTypeEnum.IfcSensor],
    conditions: [],
    columns: [{ id: 'spatial', source: 'spatial', propertyName: level }],
  };
}

const cells = (level: string, p = provider()) =>
  executeList(defWith(level), p).rows.map((r) => r.values[0]);

describe('spatial column · Room level', () => {
  it('reports the room for an element inside one', () => {
    expect(cells('Room')[0]).toBe('06');
  });

  it('leaves an element with no room EMPTY rather than naming its storey', () => {
    // The whole reason the level exists: a room column full of storey names
    // cannot answer "which elements have no room yet".
    expect(cells('Room')[1]).toBeNull();
    expect(cells('Container')[1]).toBe('E00');
  });

  it('is case-insensitive on the level string, like the other levels', () => {
    expect(cells('room')[0]).toBe('06');
  });

  it('a provider without getSpaceName yields an empty column, not an error', () => {
    // Server-backed and legacy providers must keep working.
    expect(cells('Room', provider(false))).toEqual([null, null]);
  });
});
