/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IfcTypeEnum, type SpatialNode } from '@ifc-lite/data';
import {
  buildStructureRequests, externalIdFor, floorNumberFromName, labelFor, toPlanFile,
  type StructureExportSettings, type StructureRequest,
} from './structureExport.js';

function node(
  expressId: number,
  type: IfcTypeEnum,
  name: string,
  children: SpatialNode[] = [],
  longName?: string,
): SpatialNode {
  return { expressId, type, name, longName, children, elements: [] };
}

const SETTINGS: StructureExportSettings = {
  timeZone: 'Europe/Zurich',
  address: { countryCode: 'CHE', locality: 'Baden', postalCode: '5400' },
  equipmentClasses: [],
};

/** GlobalIds are just `g<expressId>` so a payload is readable in a diff. */
const globalIdOf = (expressId: number) => `g${expressId}`;

function run(project: SpatialNode, settings = SETTINGS, equipment = []) {
  return buildStructureRequests({
    project,
    globalIdOf,
    equipment,
    settings,
    newId: () => '00000000-0000-4000-8000-000000000000',
  });
}

/** One building, one storey, one room — the shape almost every model has. */
function simpleProject(): SpatialNode {
  return node(1, IfcTypeEnum.IfcProject, 'Projekt', [
    node(2, IfcTypeEnum.IfcSite, 'Grundstück', [
      node(3, IfcTypeEnum.IfcBuilding, 'Haus', [
        node(4, IfcTypeEnum.IfcBuildingStorey, '01', [
          node(5, IfcTypeEnum.IfcSpace, '1.06'),
        ]),
      ]),
    ]),
  ]);
}

function bodyOf(request: StructureRequest): any {
  return request.body;
}

describe('floorNumberFromName', () => {
  it('reads a plain number, with or without a sign or leading zero', () => {
    assert.equal(floorNumberFromName('01'), 1);
    assert.equal(floorNumberFromName('00'), 0);
    assert.equal(floorNumberFromName('-2'), -2);
    assert.equal(floorNumberFromName(' 3 '), 3);
  });

  it('refuses names that only look numeric', () => {
    // `U1` is the case the strictness exists for: read as 1 it would place a
    // basement above ground, and it is a basement on every Swiss project.
    assert.equal(floorNumberFromName('U1'), null);
    assert.equal(floorNumberFromName('EG'), null);
    assert.equal(floorNumberFromName('1.OG'), null);
    assert.equal(floorNumberFromName('Level 3'), null);
    assert.equal(floorNumberFromName(''), null);
  });
});

describe('labelFor', () => {
  it('prefers Name and falls back to LongName', () => {
    assert.equal(labelFor(node(1, IfcTypeEnum.IfcSpace, '1.06', [], 'Sitzung')), '1.06');
    assert.equal(labelFor(node(1, IfcTypeEnum.IfcSpace, '  ', [], 'Sitzung')), 'Sitzung');
    assert.equal(labelFor(node(1, IfcTypeEnum.IfcSpace, '', [])), '');
  });
});

describe('buildStructureRequests — locations', () => {
  it('produces building, floor and room in creation order', () => {
    const result = run(simpleProject());
    assert.deepEqual(
      result.requests.map((request) => bodyOf(request).data.type),
      ['Building', 'Floor', 'Room'],
    );
    assert.deepEqual(result.counts, {
      Campus: 0, Building: 1, Floor: 1, Room: 1, Equipment: 0,
    });
  });

  it('writes the GlobalId into externalId, prefixed the way the API documents it', () => {
    const result = run(simpleProject());
    const room = result.requests[2];
    assert.equal(bodyOf(room).data.attributes.externalId, 'IfcGuid:g5');
    assert.equal(room.key, externalIdFor('g5'));
  });

  it('hangs each location from the one above by key', () => {
    const [building, floor, room] = run(simpleProject()).requests;
    assert.equal(building.parentKey, null);
    assert.equal(building.parentRelationship, null);
    assert.equal(floor.parentKey, building.key);
    assert.equal(floor.parentRelationship, 'isFloorOf');
    assert.equal(room.parentKey, floor.key);
    assert.equal(room.parentRelationship, 'isRoomOf');
  });

  it('leaves the parent id empty rather than inventing one', () => {
    const [, floor] = run(simpleProject()).requests;
    // The whole point of the plan format: the body is API-shaped, and exactly
    // one field is knowingly blank until the parent has been created.
    assert.equal(bodyOf(floor).data.relationships.isFloorOf.data.id, '');
    assert.equal(bodyOf(floor).data.relationships.isFloorOf.data.type, 'Building');
  });

  it('gives every building the address and time zone the API requires', () => {
    const [building] = run(simpleProject()).requests;
    assert.equal(bodyOf(building).data.attributes.timeZone, 'Europe/Zurich');
    const included = bodyOf(building).included[0];
    assert.equal(included.type, 'Address');
    assert.deepEqual(included.attributes, {
      countryCode: 'CHE', locality: 'Baden', postalCode: '5400',
    });
    // And the relationship points at that very record.
    assert.equal(
      bodyOf(building).data.relationships.hasPostalAddress.data.id,
      included.id,
    );
  });

  it('omits address fields that were left blank instead of sending empty strings', () => {
    const result = run(simpleProject(), {
      ...SETTINGS,
      address: { countryCode: 'CHE', street: '   ' },
    });
    assert.deepEqual(bodyOf(result.requests[0]).included[0].attributes, { countryCode: 'CHE' });
  });

  it('drops a single-building site rather than adding a pointless campus', () => {
    const result = run(simpleProject());
    assert.equal(result.counts.Campus, 0);
    assert.equal(result.requests[0].parentKey, null);
  });

  it('keeps the site as a campus once it groups more than one building', () => {
    const project = node(1, IfcTypeEnum.IfcProject, 'Projekt', [
      node(2, IfcTypeEnum.IfcSite, 'Areal', [
        node(3, IfcTypeEnum.IfcBuilding, 'Haus A', []),
        node(6, IfcTypeEnum.IfcBuilding, 'Haus B', []),
      ]),
    ]);
    const result = run(project);
    assert.equal(result.counts.Campus, 1);
    assert.deepEqual(
      result.requests.map((request) => bodyOf(request).data.type),
      ['Campus', 'Building', 'Building'],
    );
    assert.equal(result.requests[1].parentRelationship, 'isBuildingOf');
    assert.equal(result.requests[1].parentKey, result.requests[0].key);
  });

  it('sets floorNumber only when the storey name is unambiguous, and says when it is not', () => {
    const project = node(1, IfcTypeEnum.IfcProject, 'P', [
      node(3, IfcTypeEnum.IfcBuilding, 'Haus', [
        node(4, IfcTypeEnum.IfcBuildingStorey, '01', []),
        node(5, IfcTypeEnum.IfcBuildingStorey, 'U1', []),
      ]),
    ]);
    const result = run(project);
    assert.equal(bodyOf(result.requests[1]).data.attributes.floorNumber, 1);
    assert.equal('floorNumber' in bodyOf(result.requests[2]).data.attributes, false);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /U1/);
  });

  it('skips an unnamed room and says so', () => {
    const project = node(1, IfcTypeEnum.IfcProject, 'P', [
      node(3, IfcTypeEnum.IfcBuilding, 'Haus', [
        node(4, IfcTypeEnum.IfcBuildingStorey, '00', [
          node(5, IfcTypeEnum.IfcSpace, '   '),
        ]),
      ]),
    ]);
    const result = run(project);
    assert.equal(result.counts.Room, 0);
    assert.equal(result.warnings.length, 1);
  });
});

describe('buildStructureRequests — equipment', () => {
  const withSensor = { ...SETTINGS, equipmentClasses: ['IfcSensor'] };

  it('creates the equipment and then places it, because the API has no other way', () => {
    const result = buildStructureRequests({
      project: simpleProject(),
      globalIdOf,
      equipment: [
        { expressId: 9, globalId: 'g9', name: 'RM-001', ifcClass: 'IfcSensor', containerId: 5 },
      ],
      settings: withSensor,
      newId: () => '00000000-0000-4000-8000-000000000000',
    });
    const equipment = result.requests.filter((request) => request.path.startsWith('/equipment'));
    const placement = result.requests.filter((request) => request.parentRelationship === 'hasLocation');
    assert.equal(equipment.length, 1);
    assert.equal(placement.length, 1);
    assert.equal(equipment[0].method, 'POST');
    assert.equal(placement[0].method, 'PATCH');
    // The placement names the room the sensor sits in.
    assert.equal(placement[0].parentKey, externalIdFor('g5'));
    assert.equal(result.counts.Equipment, 1);
  });

  it('ignores classes the product did not ask for', () => {
    const result = buildStructureRequests({
      project: simpleProject(),
      globalIdOf,
      equipment: [
        { expressId: 9, globalId: 'g9', name: 'Wand', ifcClass: 'IfcWall', containerId: 5 },
      ],
      settings: withSensor,
      newId: () => '00000000-0000-4000-8000-000000000000',
    });
    assert.equal(result.counts.Equipment, 0);
  });

  it('still creates a loose device, and counts them in one warning rather than many', () => {
    const result = buildStructureRequests({
      project: simpleProject(),
      globalIdOf,
      equipment: [
        { expressId: 9, globalId: 'g9', name: 'A', ifcClass: 'IfcSensor', containerId: null },
        { expressId: 10, globalId: 'g10', name: 'B', ifcClass: 'IfcSensor', containerId: 999 },
      ],
      settings: withSensor,
      newId: () => '00000000-0000-4000-8000-000000000000',
    });
    assert.equal(result.counts.Equipment, 2);
    assert.equal(result.requests.filter((r) => r.parentRelationship === 'hasLocation').length, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /^2 Geräte/);
  });
});

describe('toPlanFile', () => {
  it('carries the counts, the warnings and the base the paths are relative to', () => {
    const file = toPlanFile(run(simpleProject()), '2026-08-22T00:00:00.000Z');
    assert.equal(file.format, 'ifclite.buildingx.structure-plan');
    assert.equal(file.version, 1);
    assert.match(file.base, /openness\/structure\/partitions/);
    assert.equal(file.requests.length, 3);
    assert.equal(file.counts.Building, 1);
  });
});

describe('placing equipment on the container it actually sits in', () => {
  // `has-location` takes a oneOf discriminated by `type`, so a storey-mounted
  // device sent as a Room is a rejected request — and a model with no IfcSpace
  // at all, where every device hangs off a storey, is the common case.
  it('names a storey a Floor, not a Room', () => {
    const project = node(1, IfcTypeEnum.IfcProject, 'P', [
      node(3, IfcTypeEnum.IfcBuilding, 'Haus', [
        node(4, IfcTypeEnum.IfcBuildingStorey, '00', []),
      ]),
    ]);
    const result = buildStructureRequests({
      project,
      globalIdOf,
      equipment: [
        { expressId: 9, globalId: 'g9', name: 'M1', ifcClass: 'IfcSensor', containerId: 4 },
      ],
      settings: { ...SETTINGS, equipmentClasses: ['IfcSensor'] },
      newId: () => '00000000-0000-4000-8000-000000000000',
    });
    const placement = result.requests.find((r) => r.parentRelationship === 'hasLocation')!;
    assert.equal(bodyOf(placement).data.type, 'Floor');
    assert.equal(placement.parentKey, externalIdFor('g4'));
  });

  it('still names a room a Room', () => {
    const result = buildStructureRequests({
      project: simpleProject(),
      globalIdOf,
      equipment: [
        { expressId: 9, globalId: 'g9', name: 'M1', ifcClass: 'IfcSensor', containerId: 5 },
      ],
      settings: { ...SETTINGS, equipmentClasses: ['IfcSensor'] },
      newId: () => '00000000-0000-4000-8000-000000000000',
    });
    const placement = result.requests.find((r) => r.parentRelationship === 'hasLocation')!;
    assert.equal(bodyOf(placement).data.type, 'Room');
  });
});
