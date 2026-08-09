/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Storeys entered by hand, before any model exists.
 *
 * The ordinary way a project starts: 2D drawings and a set of levels somebody
 * knows. Everything downstream hangs off these numbers — where a plan is
 * stacked, how tall a room is extruded — so they have to come first rather
 * than be derived last.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyHeightSystem, withStoreyHeights } from './derive.js';
import { addStorey, removeStorey, setElevation } from './edit.js';
import { heightSystemPayload } from './serialize.js';

const NOW = new Date('2026-08-10T09:00:00.000Z');

describe('createEmptyHeightSystem', () => {
  it('starts with no storeys and no source file', () => {
    const system = createEmptyHeightSystem(NOW);

    assert.deepEqual(system.storeys, []);
    assert.equal(system.derivedFrom.fileName, undefined);
  });

  it('still carries the default reference levels', () => {
    // They are a project convention, not something read out of a model, so
    // they apply whether or not a file was ever involved.
    assert.ok(createEmptyHeightSystem(NOW).referenceLevels.length > 0);
  });

  it('does not share its levels with the next system', () => {
    const a = createEmptyHeightSystem(NOW);
    const b = createEmptyHeightSystem(NOW);
    a.referenceLevels[0].offset = 99;

    assert.notEqual(b.referenceLevels[0].offset, 99);
  });
});

describe('addStorey', () => {
  const base = createEmptyHeightSystem(NOW);

  it('keeps the list sorted by elevation, whatever order they are typed in', () => {
    const system = [
      { name: 'OG', elevation: 3 },
      { name: 'UG', elevation: -3 },
      { name: 'EG', elevation: 0 },
    ].reduce(addStorey, base);

    assert.deepEqual(system.storeys.map((s) => s.name), ['UG', 'EG', 'OG']);
  });

  it('marks a hand-entered level as manual', () => {
    // Not decoration: when a model arrives, the comparison has to say which
    // levels a person decided and which a file claimed.
    assert.equal(addStorey(base, { name: 'EG', elevation: 0 }).storeys[0].source, 'manual');
  });

  it('gives an id that cannot be mistaken for a model entity', () => {
    // A `<model>:<expressId>` shape would send a reader looking for an entity
    // that does not exist.
    const id = addStorey(base, { name: 'EG', elevation: 0 }).storeys[0].id;

    assert.match(id, /^manual:/);
  });

  it('does not hand a deleted storey-s id to the next one', () => {
    // A counting scheme hands `manual:1` straight back, so anything still
    // holding it — an in-flight edit, a selection — lands on a different
    // storey than the one it meant.
    const one = addStorey(base, { name: 'EG', elevation: 0 });
    const removedId = one.storeys[0].id;
    const readded = addStorey(removeStorey(one, removedId), { name: 'UG', elevation: -3 });

    assert.notEqual(readded.storeys[0].id, removedId);
  });

  it('gives every storey its own id', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `S${i}`, elevation: i }))
      .reduce(addStorey, base);

    assert.equal(new Set(many.storeys.map((s) => s.id)).size, 50);
  });

  it('names an unnamed storey rather than leaving it blank', () => {
    assert.ok(addStorey(base, { name: '   ', elevation: 0 }).storeys[0].name.length > 0);
  });

  it('accepts a negative level', () => {
    // Basements are not an edge case.
    assert.equal(addStorey(base, { name: 'UG', elevation: -3.2 }).storeys[0].elevation, -3.2);
  });

  it('does not mutate the system it was given', () => {
    addStorey(base, { name: 'EG', elevation: 0 });

    assert.deepEqual(base.storeys, []);
  });
});

describe('removeStorey', () => {
  const two = [
    { name: 'EG', elevation: 0 },
    { name: 'OG', elevation: 3 },
  ].reduce(addStorey, createEmptyHeightSystem(NOW));

  it('removes just that one', () => {
    const left = removeStorey(two, two.storeys[0].id);

    assert.deepEqual(left.storeys.map((s) => s.name), ['OG']);
  });

  it('returns the same object when nothing matched', () => {
    // So a stale id from the UI cannot trigger a pointless re-render.
    assert.equal(removeStorey(two, 'manual:999'), two);
  });
});

describe('a hand-built system behaves like a derived one', () => {
  const system = [
    { name: 'UG', elevation: -3 },
    { name: 'EG', elevation: 0 },
    { name: 'OG', elevation: 3.2 },
  ].reduce(addStorey, createEmptyHeightSystem(NOW));

  it('computes storey heights from the neighbours', () => {
    const rows = withStoreyHeights(system.storeys);

    assert.deepEqual(rows.map((r) => r.height), [3, 3.2, null]);
  });

  it('re-sorts when a level is edited past its neighbour', () => {
    const moved = setElevation(system, system.storeys[0].id, 10);

    assert.equal(moved.storeys.at(-1)!.name, 'UG');
  });

  it('exports without claiming a file it never read', () => {
    // The receiving side reports an absent name as unknown, which is true. A
    // plausible file name would be a claim that a file was consulted.
    const payload = heightSystemPayload(system, NOW);

    assert.equal('fileName' in payload.derivedFrom, false);
    assert.deepEqual(payload.storeys.map((s) => s.elevation), [-3, 0, 3.2]);
  });
});
