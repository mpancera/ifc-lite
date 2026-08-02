/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MeshData } from '@ifc-lite/geometry';
import {
  MutablePropertyView,
  StoreEditor,
  type MutationEntityRef,
  type MutationStoreShape,
} from '@ifc-lite/mutations';
import { addLibraryElementToStore, addLibraryTypeToStore, emitRelDefinesByType } from '@ifc-lite/create';
import { captureOverlaySnapshot, type SnapshotSource } from './captureSnapshot.js';
import { reconcileSnapshot, undisputedExpressIds } from './reconcileSnapshot.js';
import { restoreOverlaySnapshot } from './restoreSnapshot.js';

const STOREY = 43;
const ROOM = 60;
const OTHER_ROOM = 61;
const EXISTING_WALL = 100;

const GID = {
  storey: 'gid-storey-E00',
  room: 'gid-room-0-14',
  otherRoom: 'gid-room-0-15',
  wall: 'gid-wall-A',
};

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const anchor = { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 0, storeyId: STOREY, storeyPlacementId: 54 };

function fakeMesh(expressId: number): MeshData {
  return {
    expressId,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    color: [1, 0, 0, 1],
  } as MeshData;
}

/**
 * Two detectors placed on one storey: one inside a room, one outside any room.
 * Both share a type; one existing wall was renamed.
 */
function authorSession() {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(makeStore(200), view);

  const { typeId } = addLibraryTypeToStore(editor, anchor, {
    IfcEntity: 'IfcSensorType', Name: 'Rauchmelder', Tag: 'fire.smoke-detector',
  });
  const inRoom = addLibraryElementToStore(editor, anchor, {
    IfcEntity: 'IfcSensor', Position: [1, 1, 2.5], Name: 'Melder Raum', ContainerId: ROOM,
  }).elementId;
  const inCorridor = addLibraryElementToStore(editor, anchor, {
    IfcEntity: 'IfcSensor', Position: [9, 9, 2.5], Name: 'Melder Korridor',
  }).elementId;
  emitRelDefinesByType(editor, anchor.ownerHistoryId, [inRoom, inCorridor], typeId);
  view.setAttribute(EXISTING_WALL, 'Name', 'Wand umbenannt');

  const containers = new Map<number, number>([[inRoom, ROOM], [inCorridor, STOREY]]);
  const products = new Set([inRoom, inCorridor]);

  const source: SnapshotSource = {
    globalIdOf: (id) => ({ [STOREY]: GID.storey, [ROOM]: GID.room, [OTHER_ROOM]: GID.otherRoom, [EXISTING_WALL]: GID.wall } as Record<number, string>)[id] ?? '',
    storeyOf: (id) => (products.has(id) ? STOREY : undefined),
    typeNameOf: () => 'IfcSensor',
    meshOf: (id) => (products.has(id) ? fakeMesh(id) : undefined),
    containerOf: (id) => containers.get(id),
  };

  return { view, editor, typeId, inRoom, inCorridor, source };
}

function capture() {
  const s = authorSession();
  const snapshot = captureOverlaySnapshot({
    view: s.view, source: s.source, sourceHash: 'hash-v1', modelName: '004_MOD_ARC.ifc', now: () => 1000,
  });
  assert.ok(snapshot, 'expected a snapshot');
  return { ...s, snapshot: snapshot! };
}

/** A file where every original entity is still present. */
const unchangedFile = {
  expressIdOfGlobalId: (gid: string) =>
    ({ [GID.storey]: STOREY, [GID.room]: ROOM, [GID.otherRoom]: OTHER_ROOM, [GID.wall]: EXISTING_WALL } as Record<string, number>)[gid] ?? -1,
};

test('capture: an untouched overlay produces no snapshot', () => {
  const view = new MutablePropertyView(null, 'm1');
  const result = captureOverlaySnapshot({
    view,
    source: { globalIdOf: () => '', storeyOf: () => undefined, typeNameOf: () => '', meshOf: () => undefined, containerOf: () => undefined },
    sourceHash: 'h', modelName: 'm',
  });
  assert.equal(result, null);
});

test('capture: records products with their storey and container as GlobalIds', () => {
  const { snapshot, inRoom, inCorridor } = capture();

  assert.equal(snapshot.placements.length, 2);
  const room = snapshot.placements.find((p) => p.expressId === inRoom)!;
  assert.equal(room.storeyGlobalId, GID.storey);
  assert.equal(room.containerGlobalId, GID.room);
  assert.equal(room.name, 'Melder Raum');

  const corridor = snapshot.placements.find((p) => p.expressId === inCorridor)!;
  assert.equal(corridor.containerGlobalId, GID.storey);
});

test('capture: geometry plumbing is not recorded as a placement', () => {
  const { snapshot } = capture();
  // Placements/profiles/solids far outnumber the two products.
  assert.ok(snapshot.newEntities.length > snapshot.placements.length);
  assert.equal(snapshot.meshes.length, 2);
});

test('capture: an edit on a base entity carries that entity\'s GlobalId', () => {
  const { snapshot } = capture();
  assert.deepEqual(snapshot.editedBaseEntities, [{ expressId: EXISTING_WALL, globalId: GID.wall }]);
});

test('capture: authored entities are not listed as base references', () => {
  const { snapshot, inRoom } = capture();
  // They are restored with the snapshot, so they need no stable identifier.
  assert.ok(!snapshot.editedBaseEntities.some((r) => r.expressId === inRoom));
});

test('reconcile: an identical file needs no decisions', () => {
  const { snapshot } = capture();
  const report = reconcileSnapshot(snapshot, 'hash-v1', unchangedFile);

  assert.equal(report.identical, true);
  assert.equal(report.counts.suspect, 0);
  assert.equal(report.counts.orphaned, 0);
});

test('reconcile: a different file with everything still present is all ok', () => {
  const { snapshot } = capture();
  const report = reconcileSnapshot(snapshot, 'hash-v2', unchangedFile);

  assert.equal(report.identical, false);
  assert.equal(report.counts.suspect, 0);
  assert.equal(report.counts.orphaned, 0);
});

test('reconcile: an element whose room is gone is suspect, not discarded', () => {
  const { snapshot, inRoom, inCorridor } = capture();
  const roomRemoved = {
    expressIdOfGlobalId: (gid: string) => (gid === GID.room ? -1 : unchangedFile.expressIdOfGlobalId(gid)),
  };

  const report = reconcileSnapshot(snapshot, 'hash-v2', roomRemoved);
  const suspect = report.items.find((i) => i.verdict === 'suspect')!;

  assert.ok(suspect, 'expected a suspect item');
  assert.deepEqual(suspect.expressIds, [inRoom]);
  // The detector in the corridor is unaffected by a room being re-planned.
  const ok = report.items.filter((i) => i.verdict === 'ok').flatMap((i) => i.expressIds);
  assert.ok(ok.includes(inCorridor));
});

test('reconcile: an element whose storey is gone is orphaned', () => {
  const { snapshot } = capture();
  const storeyRemoved = {
    expressIdOfGlobalId: (gid: string) => (gid === GID.storey ? -1 : unchangedFile.expressIdOfGlobalId(gid)),
  };

  const report = reconcileSnapshot(snapshot, 'hash-v2', storeyRemoved);
  assert.ok(report.counts.orphaned > 0);
});

test('reconcile: an edit whose entity is gone is reported orphaned', () => {
  const { snapshot } = capture();
  const wallRemoved = {
    expressIdOfGlobalId: (gid: string) => (gid === GID.wall ? -1 : unchangedFile.expressIdOfGlobalId(gid)),
  };

  const report = reconcileSnapshot(snapshot, 'hash-v2', wallRemoved);
  assert.ok(report.items.some((i) => i.verdict === 'orphaned' && i.label.includes('Attributkorrektur')));
});

test('reconcile: types and systems stay ok regardless of the architecture model', () => {
  const { snapshot } = capture();
  const nothingFound = { expressIdOfGlobalId: () => -1 };

  const report = reconcileSnapshot(snapshot, 'hash-v2', nothingFound);
  const selfContained = report.items.find((i) => i.label.includes('Produkttypen'))!;
  assert.equal(selfContained.verdict, 'ok');
});

test('restore: brings back entities, registrations and meshes', () => {
  const { snapshot, inRoom, inCorridor } = capture();
  const fresh = new MutablePropertyView(null, 'm1');
  const registered: number[] = [];
  let appended = 0;

  const result = restoreOverlaySnapshot(snapshot, fresh, {
    registerElement: ({ expressId }) => registered.push(expressId),
    expressIdOfGlobalId: unchangedFile.expressIdOfGlobalId,
    appendMeshes: (m) => { appended += m.length; },
  });

  assert.equal(result.entitiesRestored, snapshot.newEntities.length);
  assert.deepEqual(registered.sort((a, b) => a - b), [inRoom, inCorridor].sort((a, b) => a - b));
  assert.equal(appended, 2);
  assert.equal(result.meshesRestored, 2);
  assert.equal(fresh.getNewEntities().length, snapshot.newEntities.length);
});

test('restore: an edit on a base entity is replayed', () => {
  const { snapshot } = capture();
  const fresh = new MutablePropertyView(null, 'm1');

  restoreOverlaySnapshot(snapshot, fresh, {
    registerElement: () => {},
    expressIdOfGlobalId: unchangedFile.expressIdOfGlobalId,
    appendMeshes: () => {},
  });

  const attrs = fresh.getAttributeMutationsForEntity(EXISTING_WALL);
  assert.deepEqual(attrs, [{ name: 'Name', value: 'Wand umbenannt' }]);
});

test('restore: an edit is dropped when its entity moved to a different express id', () => {
  // The wall still exists but is #7 now — replaying by express id would write
  // the rename onto whatever entity #100 happens to be in this file.
  const { snapshot } = capture();
  const fresh = new MutablePropertyView(null, 'm1');

  restoreOverlaySnapshot(snapshot, fresh, {
    registerElement: () => {},
    expressIdOfGlobalId: (gid) => (gid === GID.wall ? 7 : unchangedFile.expressIdOfGlobalId(gid)),
    appendMeshes: () => {},
  });

  assert.deepEqual(fresh.getAttributeMutationsForEntity(EXISTING_WALL), []);
});

test('restore: keeping only the undisputed leaves the rest out', () => {
  const { snapshot, inRoom, inCorridor } = capture();
  const roomRemoved = {
    expressIdOfGlobalId: (gid: string) => (gid === GID.room ? -1 : unchangedFile.expressIdOfGlobalId(gid)),
  };
  const report = reconcileSnapshot(snapshot, 'hash-v2', roomRemoved);

  const fresh = new MutablePropertyView(null, 'm1');
  const registered: number[] = [];
  restoreOverlaySnapshot(snapshot, fresh, {
    registerElement: ({ expressId }) => registered.push(expressId),
    expressIdOfGlobalId: roomRemoved.expressIdOfGlobalId,
    appendMeshes: () => {},
  }, undisputedExpressIds(report));

  assert.ok(registered.includes(inCorridor));
  assert.ok(!registered.includes(inRoom), 'the suspect element must not come back silently');
  // Declining it does not remove it from the snapshot.
  assert.ok(snapshot.newEntities.some((e) => e.expressId === inRoom));
});

test('restore: a storey missing from this file skips its elements', () => {
  const { snapshot } = capture();
  const fresh = new MutablePropertyView(null, 'm1');
  const registered: number[] = [];

  const result = restoreOverlaySnapshot(snapshot, fresh, {
    registerElement: ({ expressId }) => registered.push(expressId),
    expressIdOfGlobalId: (gid) => (gid === GID.storey ? -1 : unchangedFile.expressIdOfGlobalId(gid)),
    appendMeshes: () => {},
  });

  assert.deepEqual(registered, []);
  assert.equal(result.elementsRegistered, 0);
  assert.equal(result.meshesRestored, 0);
});

test('restore: a restored id cannot be handed out again by the allocator', () => {
  const { snapshot } = capture();
  const fresh = new MutablePropertyView(null, 'm1');
  restoreOverlaySnapshot(snapshot, fresh, {
    registerElement: () => {},
    expressIdOfGlobalId: unchangedFile.expressIdOfGlobalId,
    appendMeshes: () => {},
  });

  const highest = Math.max(...snapshot.newEntities.map((e) => e.expressId));
  assert.ok(fresh.peekNextExpressId() > highest);
});
