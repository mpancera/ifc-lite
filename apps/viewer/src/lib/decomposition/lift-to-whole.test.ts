/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { liftToWholes } from './lift-to-whole.js';

/** A curtain wall (#10) of two plates and a member, a loose wall (#40), and a
 *  stair (#50) whose flight (#51) carries a tread (#52). */
const PARENT: Record<number, number> = {
  11: 10, 12: 10, 13: 10,
  51: 50, 52: 51,
};
const parentOf = (id: number) => PARENT[id] ?? null;

describe('liftToWholes', () => {
  it('refiles the curtain wall, not the pane of glass that was clicked', () => {
    const { targets, lifted } = liftToWholes([11], parentOf);
    assert.deepEqual(targets, [10]);
    assert.deepEqual(lifted, [{ part: 11, whole: 10 }]);
  });

  it('names the whole once when several of its parts were picked', () => {
    const { targets, lifted } = liftToWholes([11, 12, 13], parentOf);
    assert.deepEqual(targets, [10], 'one curtain wall, not three moves of it');
    assert.equal(lifted.length, 3, 'and all three are reported as lifted');
  });

  it('climbs past an intermediate part to the outermost whole', () => {
    assert.deepEqual(liftToWholes([52], parentOf).targets, [50]);
  });

  it('leaves an element that is nobody\'s part exactly where it is', () => {
    const { targets, lifted } = liftToWholes([40], parentOf);
    assert.deepEqual(targets, [40]);
    assert.deepEqual(lifted, []);
  });

  it('does not list the whole twice when it was picked alongside its part', () => {
    assert.deepEqual(liftToWholes([10, 11], parentOf).targets, [10]);
  });

  it('keeps the caller\'s order, so the first pick stays first', () => {
    assert.deepEqual(liftToWholes([40, 11], parentOf).targets, [40, 10]);
  });

  it('stops rather than spinning on a file that aggregates in a circle', () => {
    const circular = (id: number) => (id === 1 ? 2 : id === 2 ? 1 : null);
    assert.deepEqual(liftToWholes([1], circular).targets.length, 1);
  });

  it('stops where the caller says the spatial tree begins', () => {
    // Site, building and storey decompose through the same relation; a caller
    // that walked into them would try to refile a storey.
    const upToSpatial = (id: number) => (id === 60 ? null : PARENT[id] ?? null);
    assert.deepEqual(liftToWholes([60], upToSpatial).targets, [60]);
  });
});
