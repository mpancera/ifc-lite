/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyHeightSystem } from './derive.js';
import { addStorey } from './edit.js';
import {
  assignableStoreys, danglingUnderlays, placeUnderlays, underlayBelongsOnSheet,
} from './underlayStack.js';
import type { HeightSystem } from './types.js';

const system = [
  { name: 'UG', elevation: -3 },
  { name: 'EG', elevation: 0 },
  { name: 'OG', elevation: 3.2 },
].reduce(addStorey, createEmptyHeightSystem(new Date('2026-08-10T00:00:00.000Z')));

const [ug, eg, og] = system.storeys;

describe('placeUnderlays', () => {
  it('lifts a plan to its storey', () => {
    const placed = placeUnderlays([{ id: 'a', storeyId: og.id }], system);

    assert.equal(placed[0].elevation, 3.2);
    assert.equal(placed[0].storeyName, 'OG');
  });

  it('stacks several plans instead of piling them at zero', () => {
    // The whole point: without this a folder of DXFs lies on top of itself.
    const placed = placeUnderlays(
      [{ id: 'a', storeyId: ug.id }, { id: 'b', storeyId: eg.id }, { id: 'c', storeyId: og.id }],
      system,
    );

    assert.deepEqual(placed.map((p) => p.elevation), [-3, 0, 3.2]);
  });

  it('leaves an unassigned plan without an elevation, not at zero', () => {
    // Zero is a level in the building. "Not placed yet" is not.
    const placed = placeUnderlays([{ id: 'a' }], system);

    assert.equal(placed[0].elevation, null);
    assert.equal(placed[0].dangling, false);
  });

  it('separates a broken assignment from an absent one', () => {
    // Only one of the two is somebody's mistake, and the panel has to be able
    // to say which.
    const placed = placeUnderlays([{ id: 'a' }, { id: 'b', storeyId: 'manual:gone' }], system);

    assert.equal(placed[0].dangling, false);
    assert.equal(placed[1].dangling, true);
  });

  it('follows the storey when its level is corrected', () => {
    // The reason the plan stores a storey ID and not a copied elevation: a
    // copy would keep last week's height and look perfectly fine.
    const raised = { ...system, storeys: system.storeys.map(
      (s) => (s.id === og.id ? { ...s, elevation: 3.5 } : s)) };

    assert.equal(placeUnderlays([{ id: 'a', storeyId: og.id }], raised)[0].elevation, 3.5);
  });

  it('reports everything as unplaced when there is no height system', () => {
    const placed = placeUnderlays([{ id: 'a', storeyId: eg.id }], null);

    assert.equal(placed[0].elevation, null);
    assert.equal(placed[0].dangling, true);
  });

  it('keeps the input order, so the panel list does not jump around', () => {
    const placed = placeUnderlays(
      [{ id: 'c', storeyId: og.id }, { id: 'a', storeyId: ug.id }], system,
    );

    assert.deepEqual(placed.map((p) => p.underlayId), ['c', 'a']);
  });
});

describe('assignableStoreys', () => {
  it('offers the storeys lowest first', () => {
    assert.deepEqual(assignableStoreys(system).map((s) => s.name), ['UG', 'EG', 'OG']);
  });

  it('offers nothing when no storeys are defined yet', () => {
    assert.deepEqual(assignableStoreys(createEmptyHeightSystem()), []);
    assert.deepEqual(assignableStoreys(null), []);
  });

  it('allows two plans on one storey', () => {
    // A floor plan and a reflected ceiling plan of the same level are two
    // drawings of one storey; refusing the second invents a rule the building
    // does not have.
    const placed = placeUnderlays(
      [{ id: 'floor', storeyId: eg.id }, { id: 'ceiling', storeyId: eg.id }], system,
    );

    assert.deepEqual(placed.map((p) => p.elevation), [0, 0]);
  });
});

describe('danglingUnderlays', () => {
  it('names the plans whose storey disappeared', () => {
    const withoutOg = { ...system, storeys: system.storeys.filter((s) => s.id !== og.id) };

    assert.deepEqual(
      danglingUnderlays([{ id: 'a', storeyId: eg.id }, { id: 'b', storeyId: og.id }], withoutOg),
      ['b'],
    );
  });

  it('is empty when every assignment still resolves', () => {
    assert.deepEqual(danglingUnderlays([{ id: 'a', storeyId: eg.id }], system), []);
  });
});

describe('underlayBelongsOnSheet', () => {
  const system: HeightSystem = {
    formatVersion: 1,
    derivedFrom: {},
    updatedAt: '2026-09-15T00:00:00Z',
    referenceLevels: [],
    storeys: [
      { id: 'm1:10', name: 'U1', elevation: -3, source: 'ifc-elevation-attribute' },
      { id: 'm1:20', name: '00', elevation: 0, source: 'ifc-elevation-attribute' },
    ],
  };

  it('keeps a basement plan off the ground-floor sheet', () => {
    // The report: a DXF filed under U1 drawn over every storey, so the sheet
    // says 00 and shows the basement's walls.
    assert.equal(underlayBelongsOnSheet({ id: 'u', storeyId: 'm1:10' }, system, 'm1:20'), false);
  });

  it('draws it on its own sheet', () => {
    assert.equal(underlayBelongsOnSheet({ id: 'u', storeyId: 'm1:10' }, system, 'm1:10'), true);
  });

  it('shows a plan that has not been filed yet', () => {
    // Hiding it would hide the drawing somebody just imported, before they can
    // reach the field that would bring it back.
    assert.equal(underlayBelongsOnSheet({ id: 'u' }, system, 'm1:20'), true);
  });

  it('shows one whose storey has been deleted', () => {
    // A broken assignment is something to repair, not a reason to make a
    // drawing vanish with no explanation.
    assert.equal(underlayBelongsOnSheet({ id: 'u', storeyId: 'm1:99' }, system, 'm1:20'), true);
  });

  it('shows everything on a sheet with no storey', () => {
    assert.equal(underlayBelongsOnSheet({ id: 'u', storeyId: 'm1:10' }, system, null), true);
  });

  it('shows everything when the sheet\'s storey is not in the system', () => {
    // A system built by hand, or derived from a different model of the same
    // building. Nothing here can say whether the two mean the same floor, so
    // nothing here hides anything.
    assert.equal(underlayBelongsOnSheet({ id: 'u', storeyId: 'm1:10' }, system, 'm2:7'), true);
  });

  it('shows everything with no system at all', () => {
    assert.equal(underlayBelongsOnSheet({ id: 'u', storeyId: 'm1:10' }, null, 'm1:20'), true);
  });
});
