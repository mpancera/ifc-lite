/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The merge of parse and authoring overlay, asserted through a real drawing.
 *
 * These run `buildRelationGraph` rather than poking the adapter's methods:
 * the defect being fixed was not "a method returned the wrong list", it was
 * "the drawing was empty while the model was not", and only the graph can
 * show that. The parsed half is a hand-written store of four entities — small
 * enough to read, real enough that the chain has somewhere to walk.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RelationshipType } from '@ifc-lite/data';
import { buildRelationGraph, elementInSpaceInStorey } from '@ifc-lite/graph';
import { MutablePropertyView, StoreEditor, type MutationEntityRef, type MutationStoreShape } from '@ifc-lite/mutations';
import { addSensorToStore } from '@ifc-lite/create';
import { graphSourceFor, expressTypeCounts, type GraphStore } from './storeSource';

const STOREY = 43;
const ROOM = 60;
const PARSED_SENSOR = 70;

/** Storey 43 aggregates room 60; room 60 contains the parsed sensor 70. */
function parsedStore(): GraphStore {
  const names: Record<number, string> = { [STOREY]: '00', [ROOM]: '0.19', [PARSED_SENSOR]: 'RM alt' };
  const types: Record<number, string> = {
    [STOREY]: 'IfcBuildingStorey', [ROOM]: 'IfcSpace', [PARSED_SENSOR]: 'IfcSensor',
  };
  return {
    entities: {
      getName: (id) => names[id] ?? '',
      getTypeName: (id) => types[id] ?? 'Unknown',
    },
    entityIndex: {
      byType: [
        ['IFCBUILDINGSTOREY', [STOREY]],
        ['IFCSPACE', [ROOM]],
        ['IFCSENSOR', [PARSED_SENSOR]],
      ] as Array<[string, number[]]>,
    },
    relationships: {
      getRelated: (entityId, relType, direction) => {
        if (relType === RelationshipType.ContainsElements) {
          if (direction === 'inverse' && entityId === PARSED_SENSOR) return [ROOM];
          if (direction === 'forward' && entityId === ROOM) return [PARSED_SENSOR];
        }
        if (relType === RelationshipType.Aggregates) {
          if (direction === 'inverse' && entityId === ROOM) return [STOREY];
          if (direction === 'forward' && entityId === STOREY) return [ROOM];
        }
        return [];
      },
    },
  };
}

function mutationStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

/** Places a sensor into ROOM through the real builder, as the app does. */
function sessionWithSensorInRoom(): { view: MutablePropertyView; sensorId: number } {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(mutationStore(200), view);
  const { sensorId } = addSensorToStore(
    editor,
    { ownerHistoryId: null, bodyContextId: 14, axisContextId: 15, storeyId: STOREY, storeyPlacementId: 54 },
    { Position: [1, 1, 0], Name: 'RM neu', ContainerId: ROOM },
  );
  return { view, sensorId };
}

const kinds = (graph: { nodes: readonly { kind: string }[] }) => {
  const out: Record<string, number> = {};
  for (const node of graph.nodes) out[node.kind] = (out[node.kind] ?? 0) + 1;
  return out;
};

describe('graphSourceFor with an authoring session', () => {
  it('leaves the parsed drawing exactly as it was when no overlay is given', () => {
    const graph = buildRelationGraph(graphSourceFor(parsedStore()), elementInSpaceInStorey(['IfcSensor']));
    assert.deepEqual(kinds(graph), { element: 1, space: 1, storey: 1 });
    assert.equal(graph.edges.length, 2);
  });

  it('draws a sensor placed this session, with its room and storey', () => {
    // The defect: this produced a drawing with the parsed sensor only, while
    // the user was looking at two detectors in the model.
    const { view } = sessionWithSensorInRoom();
    const graph = buildRelationGraph(graphSourceFor(parsedStore(), view), elementInSpaceInStorey(['IfcSensor']));
    assert.deepEqual(kinds(graph), { element: 2, space: 1, storey: 1 });
    assert.equal(graph.edges.length, 3, 'both sensors reach the room, and the room reaches the storey');
  });

  it('names the authored element from the overlay, not as an unknown box', () => {
    const { view, sensorId } = sessionWithSensorInRoom();
    assert.equal(graphSourceFor(parsedStore(), view).nameOf(sensorId), 'RM neu');
    assert.equal(graphSourceFor(parsedStore(), view).typeOf(sensorId), 'IfcSensor');
  });

  it('offers the authored type in the picker counts', () => {
    // Without this the panel cannot even be asked for the drawing: a model
    // whose only detectors are from this session lists no IfcSensor to start
    // from.
    const { view } = sessionWithSensorInRoom();
    assert.equal(expressTypeCounts(parsedStore()).get('IfcSensor'), 1);
    assert.equal(expressTypeCounts(parsedStore(), view).get('IfcSensor'), 2);
  });

  it('drops an element the session deleted, parsed or authored', () => {
    // The mirror image of the same defect: a box for something that is gone.
    const { view } = sessionWithSensorInRoom();
    view.deleteEntity(PARSED_SENSOR);
    const graph = buildRelationGraph(graphSourceFor(parsedStore(), view), elementInSpaceInStorey(['IfcSensor']));
    assert.deepEqual(kinds(graph), { element: 1, space: 1, storey: 1 });
    assert.equal(expressTypeCounts(parsedStore(), view).get('IfcSensor'), 1);
  });

  it('does not double an edge the session re-stated', () => {
    const view = new MutablePropertyView(null, 'm1');
    const editor = new StoreEditor(mutationStore(200), view);
    // Re-assert what the parse already says: sensor 70 sits in room 60.
    editor.addEntity('IfcRelContainedInSpatialStructure', [null, null, null, null, [`#${PARSED_SENSOR}`], `#${ROOM}`]);
    const graph = buildRelationGraph(graphSourceFor(parsedStore(), view), elementInSpaceInStorey(['IfcSensor']));
    assert.deepEqual(kinds(graph), { element: 1, space: 1, storey: 1 });
    assert.equal(graph.edges.length, 2);
  });
});
