/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The containment contract is the point of these tests.
 *
 * Measured at a real fire-detection model: every detector was contained in
 * its storey, so the element-room-storey chain the block schema is derived
 * from produced 54 nodes and zero edges. The room was only ever a text
 * property. A detector states its room or the drawing cannot be built, which
 * is why the container is asserted here rather than left to the caller.
 */

import { describe, expect, it } from 'vitest';
import {
  MutablePropertyView,
  StoreEditor,
  type MutationEntityRef,
  type MutationStoreShape,
} from '@ifc-lite/mutations';
import { addSensorToStore } from './sensor.js';
import type { SpatialAnchor } from './anchor.js';

const STOREY = 43;
const ROOM = 61;

function makeStore(maxId: number): MutationStoreShape {
  const byId = new Map<number, MutationEntityRef>();
  for (let id = 1; id <= maxId; id++) {
    byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
  }
  return { entityIndex: { byId } };
}

const anchor: SpatialAnchor = {
  ownerHistoryId: 5,
  bodyContextId: 14,
  axisContextId: 15,
  storeyId: STOREY,
  storeyPlacementId: 54,
};

function session() {
  const view = new MutablePropertyView(null, 'm1');
  return { view, editor: new StoreEditor(makeStore(60), view) };
}

/** `IfcRelContainedInSpatialStructure.RelatingStructure` is attribute 5. */
function containerOf(view: MutablePropertyView, relId: number): unknown {
  return view.getNewEntities().find((e) => e.expressId === relId)?.attributes[5];
}

describe('addSensorToStore containment', () => {
  it('contains the sensor in the room when the caller resolved one', () => {
    const { view, editor } = session();
    const result = addSensorToStore(editor, anchor, { Position: [1, 2, 0], ContainerId: ROOM });
    expect(containerOf(view, result.relContainedId)).toBe(`#${ROOM}`);
  });

  it('falls back to the storey when no room contains the point', () => {
    // A corridor, an unmodelled area, or a storey with no spaces at all: the
    // device still has to land somewhere in the spatial structure.
    const { view, editor } = session();
    const result = addSensorToStore(editor, anchor, { Position: [1, 2, 0] });
    expect(containerOf(view, result.relContainedId)).toBe(`#${STOREY}`);
  });

  it('emits exactly one containment relationship', () => {
    // IFC allows an element in exactly ONE spatial element. Emitting both the
    // room and the storey would be invalid, and it is the tempting fix for
    // "the storey disappeared from the tree".
    const { view, editor } = session();
    addSensorToStore(editor, anchor, { Position: [0, 0, 0], ContainerId: ROOM });
    const rels = view.getNewEntities().filter((e) => e.type === 'IfcRelContainedInSpatialStructure');
    expect(rels).toHaveLength(1);
  });

  it('keeps the placement chained to the storey, so the room does not move the device', () => {
    // Containment is spatial decomposition; IfcLocalPlacement is a coordinate
    // system. Re-parenting the placement onto the space would shift every
    // device by the space's own placement.
    const { view, editor } = session();
    const roomed = addSensorToStore(editor, anchor, { Position: [3, 4, 0], ContainerId: ROOM });
    const placement = view.getNewEntities().find((e) => e.expressId === roomed.placementId);
    expect(placement?.attributes[0]).toBe(`#${anchor.storeyPlacementId}`);
  });

  it('places two sensors in different rooms independently', () => {
    const { view, editor } = session();
    const a = addSensorToStore(editor, anchor, { Position: [0, 0, 0], ContainerId: ROOM });
    const b = addSensorToStore(editor, anchor, { Position: [9, 9, 0], ContainerId: ROOM + 1 });
    expect(containerOf(view, a.relContainedId)).toBe(`#${ROOM}`);
    expect(containerOf(view, b.relContainedId)).toBe(`#${ROOM + 1}`);
  });
});
