/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The dialog is where a reconciliation verdict turns into a decision, so these
 * assert what a reader can actually see and do: which objects a row names, how
 * much the primary button will apply, where the rest goes, and that the one
 * irreversible action asks first.
 *
 * The report comes from the real `reconcileSnapshot` rather than a literal —
 * a hand-written report would let the wording drift away from the logic that
 * produces it, which is exactly the failure this whole change was about.
 */

import '@/test/setup-dom.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { render, click, cleanup } from '@/test/render.js';
import { reconcileSnapshot } from '@/lib/persistence/reconcileSnapshot.js';
import { SNAPSHOT_VERSION, type OverlaySnapshot } from '@/lib/persistence/types.js';
import { RestoreSessionDialog } from './RestoreSessionDialog.js';

const GID = { storey: 'gid-storey', room: 'gid-room' };

/** One detector in a room, one type beside it, and a storey that is now gone. */
function snapshot(): OverlaySnapshot {
  return {
    version: SNAPSHOT_VERSION,
    sourceHash: 'hash-v1',
    modelName: 'Langmatt.ifc',
    savedAt: 1000,
    newEntities: [
      { expressId: 10, type: 'IfcSensorType', attributes: ['guid', null, 'Rauchmelder'] },
      { expressId: 20, type: 'IfcSensor', attributes: ['guid', null, 'Melder Raum'] },
    ] as unknown as OverlaySnapshot['newEntities'],
    mutations: [],
    deleted: [],
    editedBaseEntities: [],
    placements: [
      { expressId: 20, ifcType: 'IfcSensor', name: 'Melder Raum', storeyGlobalId: GID.storey, containerGlobalId: GID.room },
    ],
    meshes: [],
  };
}

/** A file in which the storey the detector stood on no longer exists. */
const storeyGone = { expressIdOfGlobalId: () => -1 };
/** A file in which everything the snapshot refers to is still there. */
const allPresent = {
  expressIdOfGlobalId: (gid: string) => (gid === GID.storey ? 43 : gid === GID.room ? 60 : -1),
  geometryHashOfGlobalId: () => null,
};

function pendingFor(target: Parameters<typeof reconcileSnapshot>[2]) {
  const snap = snapshot();
  return {
    snapshot: snap,
    report: reconcileSnapshot(snap, 'hash-v2', target, { currentModelName: 'Langmatt_ARC_demo.ifc' }),
    modelId: 'm',
  };
}

function mount(pending: ReturnType<typeof pendingFor>, handlers: Partial<{
  onAcceptUndisputed: () => void; onAcceptAll: () => void; onDiscard: () => void; onDismiss: () => void;
}> = {}) {
  return render(
    <RestoreSessionDialog
      pending={pending}
      currentModelName="Langmatt_ARC_demo.ifc"
      onAcceptUndisputed={handlers.onAcceptUndisputed ?? (() => {})}
      onAcceptAll={handlers.onAcceptAll ?? (() => {})}
      onDiscard={handlers.onDiscard ?? (() => {})}
      onDismiss={handlers.onDismiss ?? (() => {})}
    />,
  );
}

/** Dialog content is portalled onto the body, not into the container. */
function text(): string {
  return document.body.textContent ?? '';
}

function button(label: string): HTMLElement {
  const found = [...document.body.querySelectorAll('button')]
    .find((el) => el.textContent?.trim().startsWith(label));
  assert.ok(found, `kein Knopf „${label}"`);
  return found as HTMLElement;
}

beforeEach(() => cleanup());
after(() => cleanup());

describe('RestoreSessionDialog', () => {
  it('gives a reason for the green row instead of stating an absence', () => {
    mount(pendingFor(allPresent));
    // The sentence that used to read "Hängen an keinem Bauteil des
    // Architekturmodells" next to a tick, and made a reader wonder whether
    // something was about to be lost.
    assert.ok(text().includes('nichts, was sie ungültig machen könnte'), text());
    assert.ok(text().includes('Langmatt_ARC_demo.ifc'), 'the open file is named');
  });

  it('names the objects behind a row when it is opened', () => {
    const container = mount(pendingFor(storeyGone));
    assert.equal(text().includes('Melder Raum'), false, 'closed rows stay quiet');

    const row = [...document.body.querySelectorAll('[role="button"]')]
      .find((el) => el.textContent?.includes('ohne Geschoss'));
    assert.ok(row, 'expected a row for the orphaned placement');
    click(row!);

    // "1 Bauteil ohne Geschoss" — which one? This is the answer.
    assert.ok(text().includes('IfcSensor'), text());
    assert.ok(text().includes('Melder Raum'), text());
    assert.ok(container);
  });

  it('says how many objects the primary button applies', () => {
    mount(pendingFor(allPresent));
    // Two authored entities, both undisputed: the type and the detector.
    assert.ok(button('Übernehmen (2)'), 'the count belongs on the button');
  });

  it('promises that what is held back is not thrown away', () => {
    mount(pendingFor(storeyGone));
    assert.ok(button('1 Unstrittige übernehmen'));
    assert.ok(text().includes('bleiben gespeichert und gehen nicht verloren'), text());
    // And says where to look at what it did bring in.
    assert.ok(text().includes('Änderungsliste'), text());
  });

  it('asks before it deletes, and only then deletes', () => {
    let discarded = 0;
    mount(pendingFor(allPresent), { onDiscard: () => { discarded += 1; } });

    click(button('Verwerfen'));
    assert.equal(discarded, 0, 'the first click must not delete anything');
    assert.ok(text().includes('endgültig'), 'the confirmation says what it does');
    assert.ok(text().includes('Langmatt.ifc'), 'and which saved state it deletes');

    click(button('Endgültig löschen'));
    assert.equal(discarded, 1);
  });

  it('lets the confirmation be called off', () => {
    let discarded = 0;
    mount(pendingFor(allPresent), { onDiscard: () => { discarded += 1; } });
    click(button('Verwerfen'));
    click(button('Abbrechen'));
    assert.equal(discarded, 0);
    assert.ok(button('Später entscheiden'), 'back to the normal choices');
  });
});
