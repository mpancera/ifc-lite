/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A room created in this session has to be findable in this session.
 *
 * The regression these pin: rooms detected from traced walls, devices placed
 * into them one beat later, and every device contained in the STOREY instead
 * of the room — because the lookup read the parsed file and the rooms were in
 * the authoring overlay. Measured in a screenflow, on screen the whole time.
 *
 * Built against a really parsed model plus a really created room rather than a
 * stubbed store: the thing under test is whether the overlay reaches
 * `existingSpacesByStorey` and comes back as a usable footprint, and a stub
 * that returns footprints would assert the stub.
 */

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IfcCreator, addSpaceToStore, resolveSpatialAnchor, type SpatialAnchor } from '@ifc-lite/create';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { resolveSpaceForPlacement, spacesByStorey } from './spaceLookup';

/** A 6 x 4 m room, and two points: one inside it, one well outside. */
const ROOM_CORNERS: Array<[number, number]> = [[0, 0], [6, 0], [6, 4], [0, 4]];
const INSIDE: readonly [number, number, number] = [3, 2, 0];
const OUTSIDE: readonly [number, number, number] = [50, 50, 0];

let store: IfcDataStore;
let storeyId: number;
let anchor: SpatialAnchor;

before(async () => {
  // The same minimal project the app's "Start blank" produces: one project,
  // site, building and storey — nothing else, so a found room can only have
  // come from the overlay.
  const creator = new IfcCreator({ Name: 'Lookup fixture' });
  creator.addIfcBuildingStorey({ Name: 'Level 1', Elevation: 0 });
  const { content } = creator.toIfc();
  const bytes = new TextEncoder().encode(content);
  store = await new IfcParser().parseColumnar(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  storeyId = store.entityIndex.byType.get('IFCBUILDINGSTOREY')?.[0]
    ?? store.entityIndex.byType.get('IfcBuildingStorey')?.[0] ?? 0;
  assert.ok(storeyId > 0, 'fixture must have a storey');

  // The app's own resolver, not a hand-built anchor: the room's placement has
  // to chain to the storey's real one, or its footprint cannot be read back
  // and the test would fail for a reason that has nothing to do with overlays.
  anchor = resolveSpatialAnchor(store, storeyId);
  assert.ok(anchor.storeyPlacementId > 0, 'fixture storey must have a placement');
});

/** An overlay holding one room on the storey, created the normal way. */
function sessionWithARoom(): MutablePropertyView {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(store as never, view);
  addSpaceToStore(editor, anchor, {
    Profile: 'polygon',
    OuterCurve: ROOM_CORNERS,
    Position: [0, 0, 0],
    Height: 2.8,
    Name: 'Buero',
  });
  return view;
}

describe('spacesByStorey with an authoring session', () => {
  it('finds no rooms in the parsed file alone — the fixture has none', () => {
    assert.equal(spacesByStorey(store).get(storeyId)?.length ?? 0, 0);
  });

  it('finds the room this session created', () => {
    const found = spacesByStorey(store, sessionWithARoom(), 1).get(storeyId) ?? [];
    assert.equal(found.length, 1, 'the overlay room must reach the caller');
    assert.ok(found[0].polygon.length >= 4, 'and it must carry a usable footprint');
  });

  it('does not answer with a stale room set when the session moves on', () => {
    // The staleness that caused the defect: same store object, newer session.
    const first = spacesByStorey(store, null, 10);
    assert.equal(first.get(storeyId)?.length ?? 0, 0);
    const second = spacesByStorey(store, sessionWithARoom(), 11);
    assert.equal(second.get(storeyId)?.length ?? 0, 1);
  });
});

describe('resolveSpaceForPlacement', () => {
  it('resolves nothing without a store', () => {
    assert.equal(resolveSpaceForPlacement(null, storeyId, INSIDE), null);
    assert.equal(resolveSpaceForPlacement(undefined, storeyId, INSIDE), null);
  });

  it('puts a point inside the session room into that room', () => {
    const view = sessionWithARoom();
    const roomId = spacesByStorey(store, view, 20).get(storeyId)?.[0]?.spaceExpressId;
    assert.equal(resolveSpaceForPlacement(store, storeyId, INSIDE, view, 20), roomId);
  });

  it('leaves a point outside every room unresolved, so it falls back to the storey', () => {
    const view = sessionWithARoom();
    assert.equal(resolveSpaceForPlacement(store, storeyId, OUTSIDE, view, 21), null);
  });

  it('resolves nothing on a storey the session put no rooms on', () => {
    assert.equal(resolveSpaceForPlacement(store, storeyId + 9999, INSIDE, sessionWithARoom(), 22), null);
  });
});
