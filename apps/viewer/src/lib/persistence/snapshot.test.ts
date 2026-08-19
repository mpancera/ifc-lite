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
import {
  reconcileSnapshot, undisputedExpressIds, restoreCounts, hasDecisions, isMutedFor,
  withMaterialisedIn,
} from './reconcileSnapshot.js';
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

  const globalIdOf = (id: number) =>
    ({ [STOREY]: GID.storey, [ROOM]: GID.room, [OTHER_ROOM]: GID.otherRoom, [EXISTING_WALL]: GID.wall } as Record<number, string>)[id] ?? '';

  const source: SnapshotSource = {
    globalIdOf,
    storeyOf: (id) => (products.has(id) ? STOREY : undefined),
    typeNameOf: () => 'IfcSensor',
    meshOf: (id) => (products.has(id) ? fakeMesh(id) : undefined),
    containerOf: (id) => containers.get(id),
    buildReference: (anchorIds) => ({
      globalIds: [GID.storey, GID.room, GID.otherRoom, GID.wall],
      anchors: [...anchorIds].map((id) => ({
        globalId: globalIdOf(id),
        ifcType: id === ROOM ? 'IfcSpace' : 'IfcBuildingStorey',
        name: '',
        // Only rooms carry geometry in this fixture; a storey has no mesh.
        geometryHash: id === ROOM ? 'room-shape-v1' : id === EXISTING_WALL ? 'wall-shape-v1' : null,
      })),
    }),
  };

  return { view, editor, typeId, inRoom, inCorridor, source };
}

function capture() {
  const s = authorSession();
  const snapshot = captureOverlaySnapshot({
    view: s.view, source: s.source, sourceHash: 'hash-v1', modelName: 'ARC-01.ifc', now: () => 1000,
  });
  assert.ok(snapshot, 'expected a snapshot');
  return { ...s, snapshot: snapshot! };
}

/** A file where every original entity is still present, and unchanged. */
const unchangedFile = {
  expressIdOfGlobalId: (gid: string) =>
    ({ [GID.storey]: STOREY, [GID.room]: ROOM, [GID.otherRoom]: OTHER_ROOM, [GID.wall]: EXISTING_WALL } as Record<string, number>)[gid] ?? -1,
  geometryHashOfGlobalId: (gid: string) =>
    gid === GID.room ? 'room-shape-v1' : gid === GID.wall ? 'wall-shape-v1' : null,
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

test('reconcile: a room that kept its id but was reshaped is flagged', () => {
  // The whole point of holding the reference model. Without its fingerprint
  // this reads as "room still there → ok" and quietly restores a detector that
  // may now sit inside a new wall.
  const { snapshot, inRoom } = capture();
  const roomReshaped = {
    ...unchangedFile,
    geometryHashOfGlobalId: (gid: string) =>
      gid === GID.room ? 'room-shape-v2' : unchangedFile.geometryHashOfGlobalId(gid),
  };

  const report = reconcileSnapshot(snapshot, 'hash-v2', roomReshaped);
  const suspect = report.items.find((i) => i.verdict === 'suspect')!;

  assert.ok(suspect, 'a reshaped room must not pass as unchanged');
  assert.deepEqual(suspect.expressIds, [inRoom]);
  assert.ok(suspect.label.includes('umgebauten Raum'));
});

test('reconcile: without a reference index the check degrades to existence only', () => {
  // Snapshots written before the reference index existed must still load.
  const { snapshot, inRoom } = capture();
  const legacy = { ...snapshot, reference: undefined };

  const report = reconcileSnapshot(legacy, 'hash-v2', unchangedFile);
  const ok = report.items.filter((i) => i.verdict === 'ok').flatMap((i) => i.expressIds);
  assert.ok(ok.includes(inRoom));
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

test('restore: the room an element was placed in survives the round-trip', () => {
  // Restoring the storey alone silently drops the room: the IFC containment
  // still names it while every lookup answers with the storey, so a rule
  // reading the room produces a value that looks right and is not.
  const { snapshot, inRoom, inCorridor } = capture();
  const fresh = new MutablePropertyView(null, 'm1');
  const registered: Array<{ expressId: number; containerExpressId?: number }> = [];

  restoreOverlaySnapshot(snapshot, fresh, {
    registerElement: ({ expressId, containerExpressId }) => registered.push({ expressId, containerExpressId }),
    expressIdOfGlobalId: unchangedFile.expressIdOfGlobalId,
    appendMeshes: () => {},
  });

  assert.equal(registered.find((r) => r.expressId === inRoom)?.containerExpressId, ROOM);
  // The corridor element was contained in the storey, which is not a room.
  assert.equal(registered.find((r) => r.expressId === inCorridor)?.containerExpressId, STOREY);
});

test('restore: a room missing from this file falls back to the storey', () => {
  const { snapshot, inRoom } = capture();
  const roomGone = {
    ...unchangedFile,
    expressIdOfGlobalId: (gid: string) => (gid === GID.room ? -1 : unchangedFile.expressIdOfGlobalId(gid)),
  };
  const fresh = new MutablePropertyView(null, 'm1');
  const registered: Array<{ expressId: number; containerExpressId?: number }> = [];

  restoreOverlaySnapshot(snapshot, fresh, {
    registerElement: ({ expressId, containerExpressId }) => registered.push({ expressId, containerExpressId }),
    expressIdOfGlobalId: roomGone.expressIdOfGlobalId,
    appendMeshes: () => {},
  });

  // Claiming a room that is no longer there would be worse than the storey.
  assert.equal(registered.find((r) => r.expressId === inRoom)?.containerExpressId, undefined);
});

// ── What the report SAYS ──────────────────────────────────────────────────
// A verdict icon says that a decision exists; only the sentence says which way
// to decide. These pin the three claims that were previously made up.

/** The same snapshot with one placement's identifiers taken away. */
function withPlacement(patch: { storeyGlobalId?: string | null; containerGlobalId?: string | null }) {
  const { snapshot, inRoom } = capture();
  return {
    inRoom,
    snapshot: {
      ...snapshot,
      placements: snapshot.placements.map((p) => (p.expressId === inRoom ? { ...p, ...patch } : p)),
    },
  };
}

test('reconcile: a placement saved without a storey is not reported as a deleted storey', () => {
  // Two different findings that used to collapse into one message: nothing was
  // written down, versus what was written down is gone. Reporting the second
  // when the first is true accuses the architect of deleting a storey.
  const { snapshot, inRoom } = withPlacement({ storeyGlobalId: null });
  const report = reconcileSnapshot(snapshot, 'hash-v2', unchangedFile, { currentModelName: 'V2.ifc' });

  const item = report.items.find((i) => i.expressIds.includes(inRoom))!;
  assert.equal(item.verdict, 'orphaned');
  assert.ok(item.label.includes('ohne festgehaltenes Geschoss'), item.label);
  assert.ok(!item.detail.includes('nicht mehr'), 'must not claim the storey disappeared');
  assert.ok(item.detail.includes('kein Geschoss mitgeschrieben'), item.detail);
});

test('reconcile: a deleted storey still says so, in as many words', () => {
  const { snapshot } = capture();
  const storeyRemoved = {
    expressIdOfGlobalId: (gid: string) => (gid === GID.storey ? -1 : unchangedFile.expressIdOfGlobalId(gid)),
  };
  const report = reconcileSnapshot(snapshot, 'hash-v2', storeyRemoved, { currentModelName: 'V2.ifc' });
  const item = report.items.find((i) => i.verdict === 'orphaned')!;
  assert.ok(item.detail.includes('nicht mehr'), item.detail);
});

test('reconcile: an element that never sat in a room is not called "room unchanged"', () => {
  // Claiming a room comparison that never ran is the mirror image of the
  // storey bug: a null container used to pass silently as "unverändert".
  const { snapshot, inRoom } = withPlacement({ containerGlobalId: null });
  const report = reconcileSnapshot(snapshot, 'hash-v2', unchangedFile);

  const item = report.items.find((i) => i.expressIds.includes(inRoom))!;
  assert.equal(item.verdict, 'ok');
  assert.ok(item.label.includes('direkt im Geschoss'), item.label);
  // It may mention a room to explain that there was none; what it must not do
  // is call one unchanged, which is a comparison that never happened.
  assert.ok(item.detail.includes('keinen Raum'), item.detail);
  assert.ok(!item.detail.includes('unverändert'), item.detail);
});

test('reconcile: without a saved fingerprint the room comparison is declared missing', () => {
  const { snapshot, inRoom } = capture();
  const legacy = { ...snapshot, reference: undefined };
  const report = reconcileSnapshot(legacy, 'hash-v2', unchangedFile);

  const item = report.items.find((i) => i.expressIds.includes(inRoom))!;
  assert.equal(item.verdict, 'ok');
  assert.ok(item.label.includes('ohne Raumvergleich'), item.label);
});

test('reconcile: every row says how much it covers', () => {
  // The self-contained row was the one without a number, so its size was the
  // one thing a reader could not judge.
  const { snapshot } = capture();
  const report = reconcileSnapshot(snapshot, 'hash-v2', unchangedFile);
  for (const item of report.items) {
    assert.ok(/\d/.test(item.label), `row without a count: ${item.label}`);
  }
});

test('reconcile: the messages name the file that is open', () => {
  const { snapshot } = capture();
  const named = reconcileSnapshot(snapshot, 'hash-v2', unchangedFile, { currentModelName: 'Langmatt_ARC_demo.ifc' });
  assert.ok(named.items.every((i) => i.detail.includes('Langmatt_ARC_demo.ifc')));

  // Without a name the wording stays true rather than showing empty quotes.
  const anonymous = reconcileSnapshot(snapshot, 'hash-v2', unchangedFile);
  assert.ok(anonymous.items.every((i) => i.detail.includes('dieser Fassung')));
});

test('restoreCounts: says what would be applied and what stays behind', () => {
  const { snapshot, inRoom } = capture();
  const roomRemoved = {
    expressIdOfGlobalId: (gid: string) => (gid === GID.room ? -1 : unchangedFile.expressIdOfGlobalId(gid)),
  };
  const report = reconcileSnapshot(snapshot, 'hash-v2', roomRemoved);
  const counts = restoreCounts(report);

  assert.equal(counts.held, 1, 'the detector in the removed room is held back');
  // One more than the restorable ids, on purpose: the renamed wall is an edit,
  // which replays as a mutation and brings no authored object with it.
  assert.equal(counts.undisputed, undisputedExpressIds(report).size + 1);
  assert.ok(!undisputedExpressIds(report).has(inRoom));
});

test('reconcile: a saved state with nothing re-identifiable raises no question', () => {
  // Found live: an edit had landed on an entity with no GlobalId (an IfcSIUnit),
  // so capture could not record a base reference for it. The report came back
  // empty and the dialog still opened — asking about an empty list and offering
  // "übernehmen (0)", which is an interruption rather than a decision.
  const { snapshot } = capture();
  const nothingIdentifiable = {
    ...snapshot,
    newEntities: [],
    placements: [],
    editedBaseEntities: [],
    deleted: [],
  };

  const report = reconcileSnapshot(nothingIdentifiable, 'hash-v2', unchangedFile);
  assert.equal(report.items.length, 0);
  assert.equal(hasDecisions(report), false);

  // The normal case still asks.
  assert.equal(hasDecisions(reconcileSnapshot(snapshot, 'hash-v2', unchangedFile)), true);
});

test('restoreCounts: an edit counts even though it restores no object', () => {
  // Live find: the button read "Übernehmen (0)" while it was about to replay
  // a saved attribute correction. Edits carry no authored entity, so counting
  // express ids alone made the primary action understate itself to zero.
  const { snapshot } = capture();
  const editOnly = { ...snapshot, newEntities: [], placements: [], deleted: [] };

  const report = reconcileSnapshot(editOnly, 'hash-v2', unchangedFile);
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].count, 1);
  assert.deepEqual(restoreCounts(report), { undisputed: 1, held: 0 });
});

test("reconcile: a row's count matches the number in its own label", () => {
  const { snapshot } = capture();
  const report = reconcileSnapshot(snapshot, 'hash-v2', unchangedFile);
  for (const item of report.items) {
    assert.ok(item.label.includes(String(item.count)), `${item.label} vs count ${item.count}`);
  }
});

// ── Exportieren und wieder öffnen ─────────────────────────────────────────
// The loop a user walks into by doing the obvious thing: restore, export the
// result, open the export. The file then already holds every authored object,
// under the same GlobalIds — and the app used to offer the same saved state
// again, which would have inserted all of it a second time.

/**
 * GlobalIds of the authored objects the file can actually be asked about.
 *
 * Relationships are left out deliberately: they carry a GlobalId but the
 * parser's index holds products, so a lookup answers -1 even when the file
 * plainly contains them. Found live against a real export — 7 authored spaces
 * resolved, their 7 `IfcRelAggregates` and 34 `IfcRelSpaceBoundary` did not.
 */
function authoredGuids(
  snapshot: { newEntities: ReadonlyArray<{ type: string; attributes: readonly unknown[] }> },
): string[] {
  return snapshot.newEntities
    .filter((e) => !e.type.toLowerCase().startsWith('ifcrel'))
    .map((e) => e.attributes[0])
    .filter((g): g is string => typeof g === 'string' && g.length === 22);
}

/** A file that contains the reference model AND everything that was authored. */
function fileWithAuthoredWork(guids: readonly string[]) {
  const set = new Set(guids);
  return {
    expressIdOfGlobalId: (gid: string) =>
      (set.has(gid) ? 900000 : unchangedFile.expressIdOfGlobalId(gid)),
    geometryHashOfGlobalId: unchangedFile.geometryHashOfGlobalId,
  };
}

test('reconcile: the file a saved state was exported to is not offered back', () => {
  const { snapshot } = capture();
  const exported = fileWithAuthoredWork(authoredGuids(snapshot));

  const report = reconcileSnapshot(snapshot, 'hash-exported', exported);

  assert.equal(report.materialised, true);
  assert.equal(report.items.length, 0, 'nothing to decide about work that is already there');
  assert.equal(hasDecisions(report), false);
});

test('reconcile: objects already in the file are shown, not offered for insertion', () => {
  // Half-way case: exported once, then authored more. The exported half must
  // be visible (so the count adds up) but must not be restorable again.
  const { snapshot } = capture();
  const [firstGuid] = authoredGuids(snapshot);
  const partly = fileWithAuthoredWork([firstGuid]);

  const report = reconcileSnapshot(snapshot, 'hash-v2', partly, { currentModelName: 'V2.ifc' });

  assert.equal(report.materialised, false);
  const row = report.items.find((i) => i.label.includes('bereits in der Datei'))!;
  assert.ok(row, 'expected a row for what the file already holds');
  assert.equal(row.count, 1);
  assert.deepEqual(row.expressIds, [], 'nothing to restore from that row');

  const present = snapshot.newEntities.find((e) => e.attributes[0] === firstGuid)!;
  assert.ok(!undisputedExpressIds(report).has(present.expressId), 'must not be re-inserted');
});

test('restore: an object the file already holds is not inserted twice', () => {
  // The same guard on the writing side, because `acceptAll` bypasses the
  // report entirely.
  const { snapshot } = capture();
  const guids = new Set(authoredGuids(snapshot));
  const fresh = new MutablePropertyView(null, 'm1');

  const result = restoreOverlaySnapshot(snapshot, fresh, {
    registerElement: () => {},
    expressIdOfGlobalId: (gid: string) => (guids.has(gid) ? 900000 : unchangedFile.expressIdOfGlobalId(gid)),
    appendMeshes: () => {},
  });

  assert.equal(result.skippedAsPresent, guids.size);
  assert.equal(result.entitiesRestored, snapshot.newEntities.length - guids.size);
  for (const entity of fresh.getNewEntities()) {
    const guid = entity.attributes[0];
    assert.ok(typeof guid !== 'string' || !guids.has(guid), 'restored a duplicate');
  }
});

test('reconcile: a relationship that cannot be looked up does not block the verdict', () => {
  // The live failure this pins: every authored space was in the exported file
  // and the state still came back as "half restored", because its
  // IfcRelAggregates answered -1 from an index that only holds products.
  const { snapshot } = capture();
  const productGuids = new Set(authoredGuids(snapshot));
  const relationshipsUnknown = {
    expressIdOfGlobalId: (gid: string) =>
      (productGuids.has(gid) ? 900000 : unchangedFile.expressIdOfGlobalId(gid)),
    geometryHashOfGlobalId: unchangedFile.geometryHashOfGlobalId,
  };
  assert.ok(
    snapshot.newEntities.some((e) => e.type.toLowerCase().startsWith('ifcrel')),
    'fixture should contain at least one authored relationship',
  );

  const report = reconcileSnapshot(snapshot, 'hash-exported', relationshipsUnknown);
  assert.equal(report.materialised, true);
});

test('mute: a state records the file it was found in instead of being dropped', () => {
  // Deleting would end the loop too, but it would also throw away the recovery
  // copy for the file the work was authored against. Recording the export is
  // the smaller statement: "this one already has it", not "this never existed".
  const { snapshot } = capture();
  assert.equal(isMutedFor(snapshot, 'hash-exported'), false);

  const muted = withMaterialisedIn(snapshot, 'hash-exported');
  assert.equal(isMutedFor(muted, 'hash-exported'), true);
  assert.equal(isMutedFor(muted, 'hash-somewhere-else'), false, 'only that one file');
  // Still the same saved work — nothing was removed to achieve the mute.
  assert.equal(muted.newEntities.length, snapshot.newEntities.length);
  assert.equal(muted.sourceHash, snapshot.sourceHash);
});

test('mute: recording the same file twice does not grow the history', () => {
  const { snapshot } = capture();
  const once = withMaterialisedIn(snapshot, 'hash-exported');
  const twice = withMaterialisedIn(once, 'hash-exported');
  assert.equal(twice.materialisedIn?.length, 1);
  assert.equal(twice, once, 'no pointless rewrite to storage');
});

test('mute: several exports of one state are all remembered', () => {
  const { snapshot } = capture();
  const history = withMaterialisedIn(withMaterialisedIn(snapshot, 'export-a'), 'export-b');
  assert.deepEqual(history.materialisedIn, ['export-a', 'export-b']);
  assert.ok(isMutedFor(history, 'export-a') && isMutedFor(history, 'export-b'));
});

test('mute: the original file still restores its own work', () => {
  // The point of muting rather than deleting: the state was saved as a
  // recovery copy for the file it was authored against, and it stays one.
  const { snapshot } = capture();
  const muted = withMaterialisedIn(snapshot, 'hash-exported');
  assert.equal(isMutedFor(muted, muted.sourceHash), false);
});
