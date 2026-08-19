/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A room renamed in this session is renamed on the plan too.
 *
 * Reported from real use: renaming rooms in Clean Rooms left the 2D plan
 * printing the old names, which reads as "the plan needs a refresh button".
 * It did not need one — the label was reading `spatialHierarchy`, which no
 * attribute mutation writes back into, so the two surfaces disagreed about the
 * same room while both were on screen.
 *
 * Driven through the hook against a real parsed store and a real overlay, so it
 * fails if either the overlay read or the recomputation on `mutationVersion`
 * goes away.
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
import { usePlanRoomLabels } from './usePlanRoomLabels.js';

const STOREY = 20;
const SPACE = 30;

/** One storey with one room, named the way a generator leaves it. */
const MINI_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('mini.ifc','',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0Project0000000000000a',$,'P',$,$,$,$,$,$);
#10=IFCBUILDING('0Building000000000000a',$,'B',$,$,$,$,$,.ELEMENT.,$,$,$);
#20=IFCBUILDINGSTOREY('0Storey00000000000000',$,'EG',$,$,$,$,$,.ELEMENT.,0.);
#30=IFCSPACE('0Space000000000000001',$,'0.99',$,$,$,$,'unbenannt',.ELEMENT.,.INTERNAL.,$);
#40=IFCRELAGGREGATES('0Agg00000000000000001',$,$,$,#1,(#10));
#41=IFCRELAGGREGATES('0Agg00000000000000002',$,$,$,#10,(#20));
#42=IFCRELAGGREGATES('0Agg00000000000000003',$,$,$,#20,(#30));
ENDSEC;
END-ISO-10303-21;
`;

/** The room as the renderer hands it over: a closed 4 x 5 m box. */
function roomMesh(): MeshData {
  const positions = new Float32Array([
    0, 0, 0, 4, 0, 0, 4, 0, 5, 0, 0, 5,
    0, 3, 0, 4, 3, 0, 4, 3, 5, 0, 3, 5,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
  ]);
  return { expressId: SPACE, positions, indices } as unknown as MeshData;
}

let store: IfcDataStore;
let view: MutablePropertyView;

/** Renders the label lines the plan would draw for the storey. */
function Probe() {
  const labels = usePlanRoomLabels({
    enabled: true,
    geometryResult: { meshes: [roomMesh()] } as unknown as GeometryResult,
    dataStore: store,
    modelId: 'm',
    storeyId: STOREY,
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

describe('plan room labels', () => {
  it('prints what the file states while nothing has been authored', () => {
    const container = render(<Probe />);
    assert.ok(container.textContent?.includes('0.99'), container.textContent ?? '');
    assert.ok(container.textContent?.includes('unbenannt'), container.textContent ?? '');
  });

  it('prints the new number and name as soon as the room is renamed', () => {
    const container = render(<Probe />);
    act(() => {
      view.setAttribute(SPACE, 'Name', '0.14');
      view.setAttribute(SPACE, 'LongName', 'Durchgang Küche');
      // What the store's own `setAttribute` does after writing — the signal
      // every reader of the overlay recomputes on.
      useViewerStore.setState({ mutationVersion: useViewerStore.getState().mutationVersion + 1 });
    });

    assert.ok(container.textContent?.includes('0.14'), container.textContent ?? '');
    assert.ok(container.textContent?.includes('Durchgang Küche'), container.textContent ?? '');
    assert.equal(container.textContent?.includes('0.99'), false, 'the old number is gone');
    assert.equal(container.textContent?.includes('unbenannt'), false, 'the old name is gone');
  });

  it('does not print one word twice when number and name were typed alike', () => {
    const container = render(<Probe />);
    act(() => {
      view.setAttribute(SPACE, 'Name', 'Technik');
      view.setAttribute(SPACE, 'LongName', 'Technik');
      useViewerStore.setState({ mutationVersion: useViewerStore.getState().mutationVersion + 1 });
    });
    const printed = container.textContent ?? '';
    assert.equal(printed.split('Technik').length - 1, 1, printed);
  });
});
