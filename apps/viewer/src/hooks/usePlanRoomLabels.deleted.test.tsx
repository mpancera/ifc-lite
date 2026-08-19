/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A room deleted in this session loses its stamp on the plan.
 *
 * Reported from real use on the first floor of the demo model: the auto
 * detection had found rooms that were not rooms, all of them were deleted at
 * once, and every stamp stayed on the drawing. The rooms were gone from the
 * model and from the 3D view; the words kept naming floor that no longer had a
 * room on it.
 *
 * The deletion is driven through the real overlay rather than a stub, because
 * the thing under test is precisely whether the label pipeline asks the
 * overlay at all — `MutablePropertyView.deleteEntity` tombstones the entity
 * and leaves its meshes in the geometry buffer, which is why the label
 * survived.
 */

import '@/test/setup-dom.js';
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { MutablePropertyView } from '@ifc-lite/mutations';
import type { GeometryResult, MeshData } from '@ifc-lite/geometry';
import { render, cleanup } from '@/test/render.js';
import { useViewerStore } from '@/store/index.js';
import { roomLabelLines } from '@/lib/plan/roomLabels.js';
import { planDrawsElement } from '@/lib/plan/planVisibility.js';
import { usePlanRoomLabels } from './usePlanRoomLabels.js';

const STOREY = 20;
const KEPT = 30;
const WRONG = 31;

/** One storey, two rooms: one worth keeping and one the detection got wrong. */
const MINI_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('mini.ifc','',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0Project0000000000000a',$,'P',$,$,$,$,$,$);
#10=IFCBUILDING('0Building000000000000a',$,'B',$,$,$,$,$,.ELEMENT.,$,$,$);
#20=IFCBUILDINGSTOREY('0Storey00000000000000',$,'1.OG',$,$,$,$,$,.ELEMENT.,0.);
#30=IFCSPACE('0Space000000000000001',$,'1.01',$,$,$,$,'Korridor',.ELEMENT.,.INTERNAL.,$);
#31=IFCSPACE('0Space000000000000002',$,'1.99',$,$,$,$,'unbenannt',.ELEMENT.,.INTERNAL.,$);
#40=IFCRELAGGREGATES('0Agg00000000000000001',$,$,$,#1,(#10));
#41=IFCRELAGGREGATES('0Agg00000000000000002',$,$,$,#10,(#20));
#42=IFCRELAGGREGATES('0Agg00000000000000003',$,$,$,#20,(#30,#31));
ENDSEC;
END-ISO-10303-21;
`;

/** A room as the renderer hands it over: a closed box, offset per room. */
function roomMesh(expressId: number, offsetX: number): MeshData {
  const x0 = offsetX;
  const x1 = offsetX + 4;
  const positions = new Float32Array([
    x0, 0, 0, x1, 0, 0, x1, 0, 5, x0, 0, 5,
    x0, 3, 0, x1, 3, 0, x1, 3, 5, x0, 3, 5,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
  ]);
  return { expressId, positions, indices } as unknown as MeshData;
}

let store: IfcDataStore;
let view: MutablePropertyView;

/** Renders the label lines the plan would draw for the storey. */
function Probe() {
  const drawsElement = planDrawsElement({
    isDeleted: (expressId) => view.isDeleted(expressId),
  });
  const labels = usePlanRoomLabels({
    enabled: true,
    geometryResult: {
      meshes: [roomMesh(KEPT, 0), roomMesh(WRONG, 10)],
    } as unknown as GeometryResult,
    dataStore: store,
    modelId: 'm',
    storeyId: STOREY,
    drawsElement,
  });
  return <div>{labels.map((l) => roomLabelLines(l).join(' | ')).join(' /// ')}</div>;
}

before(async () => {
  const bytes = new TextEncoder().encode(MINI_IFC);
  store = await new IfcParser().parseColumnar(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
});

beforeEach(() => {
  cleanup();
  view = new MutablePropertyView(null, 'm');
  useViewerStore.setState({ mutationViews: new Map([['m', view]]), mutationVersion: 0 });
});
after(() => cleanup());

describe('plan room labels after a deletion', () => {
  it('stamps both rooms while both exist', () => {
    const container = render(<Probe />);
    assert.ok(container.textContent?.includes('1.01'), container.textContent ?? '');
    assert.ok(container.textContent?.includes('1.99'), container.textContent ?? '');
  });

  it('drops the stamp of the room that was deleted, and only that one', () => {
    const container = render(<Probe />);
    act(() => {
      view.deleteEntity(WRONG);
      // What the store does after a deletion — the signal every overlay reader
      // recomputes on, since the overlay is mutated in place.
      useViewerStore.setState({ mutationVersion: useViewerStore.getState().mutationVersion + 1 });
    });

    const printed = container.textContent ?? '';
    assert.equal(printed.includes('1.99'), false, 'the deleted room still has a stamp');
    assert.equal(printed.includes('unbenannt'), false, 'its name is still on the drawing');
    assert.ok(printed.includes('1.01'), 'the room that was kept lost its stamp too');
    assert.ok(printed.includes('Korridor'), printed);
  });

  it('leaves the drawing empty once every room of the floor is deleted', () => {
    // The reported case: all of them at once.
    const container = render(<Probe />);
    act(() => {
      view.deleteEntity(KEPT);
      view.deleteEntity(WRONG);
      useViewerStore.setState({ mutationVersion: useViewerStore.getState().mutationVersion + 1 });
    });
    assert.equal((container.textContent ?? '').trim(), '');
  });
});
