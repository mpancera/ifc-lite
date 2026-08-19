/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Clean Rooms, driven through the shipped panel against a real parsed store.
 *
 * The fixture store in `test/store-fixture` leaves `spatialHierarchy`
 * undefined, and this panel is nothing but a walk of that hierarchy — so a
 * stub would make every assertion here vacuously true. The model below is
 * parsed for real, which is also what makes "the room shows its new name"
 * an assertion about the overlay rather than about local component state.
 */

import '@/test/setup-dom.js';
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { render, click, cleanup } from '@/test/render.js';
import { useViewerStore, type FederatedModel } from '@/store/index.js';
import { RoomTriagePanel } from './RoomTriagePanel.js';

/** Two rooms under one storey: one finished, one missing its description. */
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
#30=IFCSPACE('0Space000000000000001',$,'0.01',$,$,$,$,'Vorhalle',.ELEMENT.,.INTERNAL.,$);
#31=IFCSPACE('0Space000000000000002',$,'0.02',$,$,$,$,$,.ELEMENT.,.INTERNAL.,$);
#40=IFCRELAGGREGATES('0Agg00000000000000001',$,$,$,#1,(#10));
#41=IFCRELAGGREGATES('0Agg00000000000000002',$,$,$,#10,(#20));
#42=IFCRELAGGREGATES('0Agg00000000000000003',$,$,$,#20,(#30,#31));
ENDSEC;
END-ISO-10303-21;
`;

let store: IfcDataStore;

/** Seed the store the way the app has it when a model is open and editable. */
function seed(role = 'editor'): void {
  const model = {
    id: 'm', name: 'm', visible: true, idOffset: 0,
    ifcDataStore: store, geometryResult: null,
  } as unknown as FederatedModel;
  useViewerStore.setState({
    models: new Map([['m', model]]),
    activeModelId: 'm',
    ifcDataStore: store,
    geometryResult: null,
    mutationViews: new Map(),
    mutationVersion: 0,
    activeDisciplineSystemId: role,
    selectedEntityId: null,
    ghostExceptEntities: null,
  });
}

/** A row, by the room number printed in it. */
function row(container: HTMLElement, number: string): HTMLElement {
  const found = [...container.querySelectorAll('button')]
    .find((element) => element.textContent?.includes(number));
  assert.ok(found, `keine Zeile für ${number}`);
  return found as HTMLElement;
}

function button(container: HTMLElement, label: string): HTMLElement {
  const found = [...container.querySelectorAll('button')]
    .find((element) => element.textContent?.trim().startsWith(label));
  assert.ok(found, `kein Knopf „${label}"`);
  return found as HTMLElement;
}

/** Type into a controlled input the way React's onChange sees it. */
function fill(container: HTMLElement, id: string, value: string): void {
  const input = container.querySelector(`#${id}`) as HTMLInputElement;
  assert.ok(input, `kein Feld #${id}`);
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input), 'value',
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

before(async () => {
  const bytes = new TextEncoder().encode(MINI_IFC);
  store = await new IfcParser().parseColumnar(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
});

beforeEach(() => { cleanup(); seed(); });
after(() => cleanup());

describe('RoomTriagePanel', () => {
  it('lists the rooms and says what is missing', () => {
    const container = render(<RoomTriagePanel onClose={() => {}} />);
    // "Nur offene" is on by default, so the finished room is out of the way
    // and the one that needs an answer is the one on screen.
    assert.ok(container.textContent?.includes('0.02'));
    assert.equal(container.textContent?.includes('Vorhalle'), false);
    assert.ok(container.textContent?.includes('1 von 2 offen'));
  });

  it('names the specific gap once the room is opened', () => {
    const container = render(<RoomTriagePanel onClose={() => {}} />);
    click(row(container, '0.02'));
    assert.ok(container.textContent?.includes('Bezeichnung fehlt'));
  });

  it('shows the room in the model when its row is opened', () => {
    const container = render(<RoomTriagePanel onClose={() => {}} />);
    click(row(container, '0.02'));
    const state = useViewerStore.getState();
    // Highlight rides the global-id channel; ghosting is what makes the room
    // findable among the walls around it.
    assert.equal(state.selectedEntityId, 31);
    assert.deepEqual([...(state.ghostExceptEntities ?? [])], [31]);
  });

  it('writes the description into the model and shows it back', () => {
    const container = render(<RoomTriagePanel onClose={() => {}} />);
    click(row(container, '0.02'));
    fill(container, 'room-name', 'Garderobe');
    click(button(container, 'Übernehmen'));

    const overlay = useViewerStore.getState().mutationViews.get('m');
    const written = overlay?.getAttributeMutationsForEntity(31)
      ?.find((attribute) => attribute.name === 'LongName')?.value;
    assert.equal(written, 'Garderobe');
    assert.ok(container.textContent?.includes('Garderobe'));
  });

  it('refuses the write in the read-only role instead of pretending', () => {
    // The role gate returns null rather than throwing, so a panel that ignored
    // it would look like it had saved (#viewer role, canAuthorOn).
    seed('viewer');
    const container = render(<RoomTriagePanel onClose={() => {}} />);
    click(row(container, '0.02'));
    fill(container, 'room-name', 'Garderobe');
    click(button(container, 'Übernehmen'));

    const overlay = useViewerStore.getState().mutationViews.get('m');
    assert.equal(overlay?.getAttributeMutationsForEntity(31)?.length ?? 0, 0);
  });

  it('discards a region that is not a room', () => {
    const container = render(<RoomTriagePanel onClose={() => {}} />);
    click(row(container, '0.02'));
    click(button(container, 'Verwerfen'));
    assert.equal(container.textContent?.includes('0.02'), false);
  });
});
