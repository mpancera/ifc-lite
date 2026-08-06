/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The lens adapter's zone surface: `getEntityGroups` and `getValueColor`.
 *
 * Narrow on purpose. The store shape the adapter reads is large, so this
 * fixture builds only what these two accessors touch — a parsed group graph and
 * a mutation overlay — and asserts the two rules that are easy to break by
 * accident: overlay zones must be visible at all, and they must come FIRST.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { createLensDataProvider } from './adapter.js';
import { createZone, paintZone } from '../ifcZones/authoring.js';
import { authoredEntities } from '../mutations/authoredEntities.js';
import type { FederatedModel } from '@/store/types';

/** The parsed side: a group graph plus enough entity metadata to name it. */
function parsedStore(options: {
  /** local expressId → the parsed group ids it belongs to */
  groupsOf: Map<number, number[]>;
  /** group expressId → [type, name] */
  groups: Map<number, [string, string]>;
}) {
  return {
    entities: {
      count: 0,
      expressId: [] as number[],
      getName: (id: number) => options.groups.get(id)?.[1] ?? '',
      getTypeName: (id: number) => options.groups.get(id)?.[0] ?? 'Unknown',
      getObjectType: () => '',
    },
    entityIndex: { byId: new Map() },
    relationships: {
      getRelated: (id: number) => options.groupsOf.get(id) ?? [],
    },
  };
}

/**
 * A provider over one model, with a real overlay so the zone builders can
 * write into it exactly as they do in the app.
 */
function harness(store: unknown) {
  const view = new MutablePropertyView(null, 'm1');
  const model = {
    id: 'm1', name: 'M', ifcDataStore: store, idOffset: 0, maxExpressId: 10_000,
  } as unknown as FederatedModel;

  // The editor the zone builders need. `addEntity` is the only method they
  // call that has to allocate, and the view already does that.
  const editor = {
    addEntity: (type: string, attributes: unknown[]) => view.createEntity(type, attributes as never),
    setPositionalAttribute: (id: number, index: number, value: unknown) =>
      view.setPositionalAttribute(id, index, value as never),
    removeEntity: (id: number) => view.deleteEntity(id),
  } as never;

  return {
    view,
    editor,
    entities: () => authoredEntities(view),
    provider: () => createLensDataProvider(
      new Map([['m1', model]]), null, new Map([['m1', view]]),
    ),
  };
}

describe('lens adapter · zones', () => {
  it('reports a zone painted this session', () => {
    // The overlay-blindness case: the parsed graph knows nothing about it.
    const h = harness(parsedStore({ groupsOf: new Map(), groups: new Map() }));
    const zoneId = createZone(h.editor, null, { name: 'AZ-A', colour: '#472A24' });
    paintZone(h.editor, h.entities(), null, zoneId, [21], 'add');

    const groups = h.provider().getEntityGroups!(21);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, 'AZ-A');
    assert.equal(groups[0].type, 'IfcZone');
  });

  it('puts the painted zone before the one the file shipped with', () => {
    // Auto-colour takes the FIRST IfcZone. A room is usually already in some
    // zone from the file, so the parsed one in front would make painting look
    // like it did nothing.
    const h = harness(parsedStore({
      groupsOf: new Map([[21, [500]]]),
      groups: new Map([[500, ['IfcZone', 'Wohnen']]]),
    }));
    const zoneId = createZone(h.editor, null, { name: 'AZ-A' });
    paintZone(h.editor, h.entities(), null, zoneId, [21], 'add');

    const groups = h.provider().getEntityGroups!(21);

    assert.deepEqual(groups.map((g) => g.name), ['AZ-A', 'Wohnen']);
  });

  it('still reports the file zones for a room nobody painted', () => {
    const h = harness(parsedStore({
      groupsOf: new Map([[21, [500]]]),
      groups: new Map([[500, ['IfcZone', 'Wohnen']]]),
    }));

    assert.deepEqual(h.provider().getEntityGroups!(21).map((g) => g.name), ['Wohnen']);
  });

  it('reports nothing for a room in no zone at all', () => {
    const h = harness(parsedStore({ groupsOf: new Map(), groups: new Map() }));

    assert.deepEqual(h.provider().getEntityGroups!(21), []);
  });

  it('hands the zone colour to auto-colour, keyed by the bucket value', () => {
    const h = harness(parsedStore({ groupsOf: new Map(), groups: new Map() }));
    const zoneId = createZone(h.editor, null, { name: 'AZ-A', colour: '#472A24' });
    paintZone(h.editor, h.entities(), null, zoneId, [21], 'add');

    assert.equal(h.provider().getValueColor!('AZ-A', 'group'), '#472A24');
  });

  it('leaves a zone with no colour to the palette', () => {
    const h = harness(parsedStore({ groupsOf: new Map(), groups: new Map() }));
    createZone(h.editor, null, { name: 'AZ-A' });

    assert.equal(h.provider().getValueColor!('AZ-A', 'group'), null);
  });

  it('has no opinion about sources other than group', () => {
    const h = harness(parsedStore({ groupsOf: new Map(), groups: new Map() }));
    createZone(h.editor, null, { name: 'AZ-A', colour: '#472A24' });

    assert.equal(h.provider().getValueColor!('AZ-A', 'material'), null);
  });

  it('follows a recolour', () => {
    // `getNewEntities` alone would still report the colour the zone was
    // created with — the reason the adapter merges positional edits.
    const h = harness(parsedStore({ groupsOf: new Map(), groups: new Map() }));
    const zoneId = createZone(h.editor, null, { name: 'AZ-A', colour: '#111111' });
    h.view.setPositionalAttribute(zoneId, 3, 'ZoneDisplay=#472A24');

    assert.equal(h.provider().getValueColor!('AZ-A', 'group'), '#472A24');
  });
});
