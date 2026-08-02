/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import {
  EntityTableBuilder,
  RelationshipGraphBuilder,
  RelationshipType,
  StringTable,
} from '@ifc-lite/data';
import { SpatialHierarchyBuilder } from './spatial-hierarchy-builder.js';

const PROJECT = 1;
const SITE = 2;
const BUILDING = 3;
const STOREY = 4;
const SPACE = 5;
const SENSOR = 6;
const WALL = 7;

/**
 * Project -> site -> building -> storey. The storey contains a wall AND
 * aggregates a space; the space contains a sensor — the shape produced by
 * placing a device into the room that encloses it.
 */
function buildHierarchy() {
  const strings = new StringTable();
  const entities = new EntityTableBuilder(7, strings);
  entities.add(PROJECT, 'IFCPROJECT', 'g-project', 'Project', '', '');
  entities.add(SITE, 'IFCSITE', 'g-site', 'Site', '', '');
  entities.add(BUILDING, 'IFCBUILDING', 'g-building', 'Building', '', '');
  entities.add(STOREY, 'IFCBUILDINGSTOREY', 'g-storey', 'E00', '', '');
  entities.add(SPACE, 'IFCSPACE', 'g-space', 'Buero 0.14', '', '');
  entities.add(SENSOR, 'IFCSENSOR', 'g-sensor', 'Rauchmelder', '', '', true);
  entities.add(WALL, 'IFCWALL', 'g-wall', 'Wand', '', '', true);

  const rels = new RelationshipGraphBuilder();
  rels.addEdge(PROJECT, SITE, RelationshipType.Aggregates, 100);
  rels.addEdge(SITE, BUILDING, RelationshipType.Aggregates, 101);
  rels.addEdge(BUILDING, STOREY, RelationshipType.Aggregates, 102);
  rels.addEdge(STOREY, SPACE, RelationshipType.Aggregates, 103);
  rels.addEdge(STOREY, WALL, RelationshipType.ContainsElements, 104);
  rels.addEdge(SPACE, SENSOR, RelationshipType.ContainsElements, 105);

  return new SpatialHierarchyBuilder().buildFromCache(entities.build(), rels.build());
}

describe('space-contained elements', () => {
  it('resolves the storey of an element contained in a space', () => {
    // Regression: `elementToStorey` was filled from storey-like containers
    // only, so a device placed in a room had no storey at all and every
    // "which storey is this on" lookup came back blank for it.
    const hierarchy = buildHierarchy();
    expect(hierarchy?.elementToStorey.get(SENSOR)).toBe(STOREY);
  });

  it('still resolves an element contained directly in the storey', () => {
    const hierarchy = buildHierarchy();
    expect(hierarchy?.elementToStorey.get(WALL)).toBe(STOREY);
  });

  it('keeps the space itself mapped to its storey', () => {
    const hierarchy = buildHierarchy();
    expect(hierarchy?.elementToStorey.get(SPACE)).toBe(STOREY);
  });

  it('reports the space as the element container, not the storey', () => {
    // The storey assignment is a roll-up; the element's actual container is
    // still the room, and the two must not be conflated.
    const hierarchy = buildHierarchy();
    expect(hierarchy?.elementToContainer.get(SENSOR)).toBe(SPACE);
    expect(hierarchy?.bySpace.get(SPACE)).toContain(SENSOR);
  });
});
