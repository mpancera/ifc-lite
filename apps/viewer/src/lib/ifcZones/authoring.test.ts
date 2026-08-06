/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MutablePropertyView,
  StoreEditor,
  type MutationEntityRef,
  type MutationStoreShape,
} from '@ifc-lite/mutations';
import { authoredEntities } from '../mutations/authoredEntities.js';
import { readZones, zoneOfSpace } from './membership.js';
import {
  createZone, deleteZone, nextZoneColour, paintZone, setZoneColour, setZoneDescription, setZoneName,
} from './authoring.js';

function makeEditor() {
  // A hundred dummy source entities so express ids the tests hand around
  // (rooms 21, 22, …) resolve; the builders never read their attributes.
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= 100; id++) {
    byId.set(id, { expressId: id, type: 'IFCSPACE', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  const store: MutationStoreShape = { entityIndex: { byId } };
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(store, view);
  return { editor, view, entities: () => authoredEntities(view) };
}

describe('createZone', () => {
  it('creates a zone that reads back with its colour', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A', colour: '#472A24' });

    const [zone] = readZones(entities());
    assert.equal(zone.expressId, zoneId);
    assert.equal(zone.name, 'AZ-A');
    assert.equal(zone.colour, '#472A24');
    assert.deepEqual(zone.memberIds, [], 'a new zone has no members');
  });

  it('keeps the author text and the colour apart', () => {
    const { editor, entities } = makeEditor();
    createZone(editor, 5, { name: 'AZ-A', description: 'Ostflügel', colour: '#472A24' });

    const [zone] = readZones(entities());
    assert.equal(zone.description, 'Ostflügel');
    assert.equal(zone.colour, '#472A24');
  });

  it('leaves Description empty when there is neither text nor colour', () => {
    const { editor, view } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });

    assert.equal(view.getNewEntity(zoneId)!.attributes[3], null);
  });

  it('records the refinement in ObjectType, since IfcZone has no PredefinedType', () => {
    const { editor, entities } = makeEditor();
    createZone(editor, 5, { name: 'AZ-A', objectType: 'TriggerZone' });

    assert.equal(readZones(entities())[0].objectType, 'TriggerZone');
  });
});

describe('paintZone', () => {
  it('creates the relationship on the first stroke', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });

    const result = paintZone(editor, entities(), 5, zoneId, [21, 22], 'add')!;

    assert.deepEqual(result.added, [21, 22]);
    assert.equal(result.createdRelationship, true);
    assert.deepEqual(readZones(entities())[0].memberIds, [21, 22]);
  });

  it('rewrites the same relationship on the second stroke', () => {
    // The point of the one-relationship-per-zone rule: no second relationship.
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });
    const first = paintZone(editor, entities(), 5, zoneId, [21], 'add')!;

    const second = paintZone(editor, entities(), 5, zoneId, [22], 'add')!;

    assert.equal(second.createdRelationship, false);
    assert.equal(second.relExpressId, first.relExpressId);
    assert.deepEqual(readZones(entities())[0].memberIds, [21, 22]);
    const rels = entities().filter((e) => e.type === 'IfcRelAssignsToGroup');
    assert.equal(rels.length, 1);
  });

  it('unpaints a room', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });
    paintZone(editor, entities(), 5, zoneId, [21, 22, 23], 'add');

    const result = paintZone(editor, entities(), 5, zoneId, [22], 'remove')!;

    assert.deepEqual(result.removed, [22]);
    assert.deepEqual(readZones(entities())[0].memberIds, [21, 23]);
  });

  it('toggles, so the same brush paints and unpaints', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });
    paintZone(editor, entities(), 5, zoneId, [21], 'add');

    paintZone(editor, entities(), 5, zoneId, [21], 'toggle');

    assert.deepEqual(readZones(entities())[0].memberIds, []);
  });

  it('reports no change when the room is already in', () => {
    // A brush dragged across a room it already covers must not push an undo
    // step or dirty the model.
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });
    paintZone(editor, entities(), 5, zoneId, [21], 'add');

    assert.equal(paintZone(editor, entities(), 5, zoneId, [21], 'add'), null);
  });

  it('refuses a zone that is not ours', () => {
    const { editor, entities } = makeEditor();

    assert.equal(paintZone(editor, entities(), 5, 42, [21], 'add'), null);
  });

  it('moves a room from one zone to another', () => {
    // Two zones, one room: the room leaves A when it joins B, because the
    // panel unpaints first. Verifies the two relationships stay independent.
    const { editor, entities } = makeEditor();
    const a = createZone(editor, 5, { name: 'A' });
    const b = createZone(editor, 5, { name: 'B' });
    paintZone(editor, entities(), 5, a, [21, 22], 'add');
    paintZone(editor, entities(), 5, b, [23], 'add');

    paintZone(editor, entities(), 5, a, [22], 'remove');
    paintZone(editor, entities(), 5, b, [22], 'add');

    const zones = readZones(entities());
    assert.deepEqual(zones.find((z) => z.name === 'A')!.memberIds, [21]);
    assert.deepEqual(zones.find((z) => z.name === 'B')!.memberIds, [23, 22]);
    assert.equal(zoneOfSpace(zones, 22)!.name, 'B');
  });
});

describe('setZoneColour', () => {
  it('recolours without losing the author text', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A', description: 'Ostflügel', colour: '#111111' });

    setZoneColour(editor, entities(), zoneId, '#472A24');

    const [zone] = readZones(entities());
    assert.equal(zone.colour, '#472A24');
    assert.equal(zone.description, 'Ostflügel');
  });

  it('removes the colour and keeps the text', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A', description: 'Ostflügel', colour: '#111111' });

    setZoneColour(editor, entities(), zoneId, null);

    const [zone] = readZones(entities());
    assert.equal(zone.colour, null);
    assert.equal(zone.description, 'Ostflügel');
  });

  it('leaves no second token behind after repeated recolouring', () => {
    const { editor, entities, view } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A', colour: '#111111' });

    setZoneColour(editor, entities(), zoneId, '#222222');
    setZoneColour(editor, entities(), zoneId, '#472A24');

    const written = view.getPositionalMutationsForEntity(zoneId)!.get(3);
    assert.equal(written, 'ZoneDisplay=#472A24');
  });

  it('refuses a zone that came in with the file', () => {
    const { editor, entities } = makeEditor();

    assert.equal(setZoneColour(editor, entities(), 42, '#472A24'), false);
  });
});

describe('setZoneName / setZoneDescription', () => {
  it('renames', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });

    setZoneName(editor, entities(), zoneId, 'AZ-B');

    assert.equal(readZones(entities())[0].name, 'AZ-B');
  });

  it('rewrites the text and keeps the colour attached', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A', description: 'alt', colour: '#472A24' });

    setZoneDescription(editor, entities(), zoneId, 'neu');

    const [zone] = readZones(entities());
    assert.equal(zone.description, 'neu');
    assert.equal(zone.colour, '#472A24');
  });
});

describe('deleteZone', () => {
  it('removes the zone and its relationship', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });
    const { relExpressId } = paintZone(editor, entities(), 5, zoneId, [21], 'add')!;

    const removed = deleteZone(editor, entities(), zoneId);

    assert.deepEqual(removed.sort(), [zoneId, relExpressId].sort());
    assert.deepEqual(readZones(entities()), []);
  });

  it('removes a zone that never got members', () => {
    const { editor, entities } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });

    assert.deepEqual(deleteZone(editor, entities(), zoneId), [zoneId]);
  });

  it('leaves the member rooms alone', () => {
    // A zone groups rooms; it does not contain them. Deleting the grouping
    // must not take the rooms with it.
    const { editor, entities, view } = makeEditor();
    const zoneId = createZone(editor, 5, { name: 'AZ-A' });
    paintZone(editor, entities(), 5, zoneId, [21], 'add');

    deleteZone(editor, entities(), zoneId);

    assert.equal(view.isDeleted(21), false);
  });

  it('refuses a zone that is not ours', () => {
    const { editor, entities } = makeEditor();

    assert.deepEqual(deleteZone(editor, entities(), 42), []);
  });
});

describe('nextZoneColour', () => {
  const palette = ['#111111', '#222222', '#333333'];

  it('suggests the first free palette entry', () => {
    const zones = [{ colour: '#111111' }, { colour: '#333333' }] as never;

    assert.equal(nextZoneColour(zones, palette), '#222222');
  });

  it('ignores zones with no colour', () => {
    assert.equal(nextZoneColour([{ colour: null }] as never, palette), '#111111');
  });

  it('cycles once the palette is used up, rather than giving nothing', () => {
    const zones = [{ colour: '#111111' }, { colour: '#222222' }, { colour: '#333333' }] as never;

    assert.equal(nextZoneColour(zones, palette), '#111111');
  });

  it('has nothing to suggest without a palette', () => {
    assert.equal(nextZoneColour([], []), null);
  });
});
