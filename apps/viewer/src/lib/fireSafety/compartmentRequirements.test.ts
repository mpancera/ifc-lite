/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The value lists are an INTERFACE, and this is where they are held to it.
 *
 * The Swiss fire-safety exchange requirement compares these strings. A value
 * spelled our way passes every other test in this repo and fails the only
 * check that matters, and it fails in somebody else's tool, weeks later, on a
 * file that has already been sent. So the expected lists below are transcribed
 * from the specification rather than derived from the module under test — a
 * test that reads its expectation from the code proves only that the code is
 * self-consistent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPARTMENT_PSET, COMPARTMENT_REQUIREMENTS, isPermitted, requirementByName,
  summariseRequirements,
} from './compartmentRequirements.js';

/** Transcribed from the exchange requirement's own check, 3.2.1. */
const SPECIFIED: Record<string, string[]> = {
  EscapeRouteType: ['Horizontal', 'Vertical', 'NONE'],
  FireRatingSlabs: [
    'E30', 'E30-Glas', 'E60', 'EI30', 'EI30-Glas', 'EI30-RF1', 'EI60', 'EI60-Glas',
    'EI60-RF1', 'EI90', 'EI90-Glas', 'EI90-RF1', 'REI120', 'REI180', 'REI60', 'REI90',
    'RF1', 'RF1-Glas', 'E90', 'NONE',
  ],
  FireRatingConstruction: ['R120', 'R180', 'R30', 'R60', 'R90', 'NONE', 'R0'],
  FireRatingOpenings: [
    'E30', 'E30-Glas', 'E60', 'EI30', 'EI30-Glas', 'EI30-RF1', 'EI60', 'EI60-Glas',
    'EI60-RF1', 'EI90', 'EI90-Glas', 'EI90-RF1', 'RF1', 'RF1-Glas', 'NONE',
  ],
  FireRatingWalls: [
    'E30', 'E30-Glas', 'E60', 'EI30', 'EI30-Glas', 'EI30-RF1', 'EI60', 'EI60-Glas',
    'EI60-RF1', 'EI90', 'EI90-Glas', 'EI90-RF1', 'REI120', 'REI180', 'REI60', 'REI90',
    'RF1', 'RF1-Glas', 'E90', 'NONE',
  ],
};

describe('the compartment requirements', () => {
  it('writes into the property set the check reads', () => {
    assert.equal(COMPARTMENT_PSET, 'CHIBB_FireCompartmentRequirements');
  });

  it('carries exactly the five properties, under their own names', () => {
    assert.deepEqual(
      new Set(COMPARTMENT_REQUIREMENTS.map((r) => r.name)),
      new Set(Object.keys(SPECIFIED)),
    );
  });

  it('offers exactly the specified values, spelling included', () => {
    // As a SET: the order on screen is a reading decision and ours to make,
    // the values are not. A missing one cannot be chosen; an extra one can be
    // chosen and then rejected by somebody else's validator.
    for (const requirement of COMPARTMENT_REQUIREMENTS) {
      assert.deepEqual(
        new Set(requirement.values),
        new Set(SPECIFIED[requirement.name]),
        requirement.name,
      );
      assert.equal(
        requirement.values.length, SPECIFIED[requirement.name].length,
        `${requirement.name} lists a value twice`,
      );
    }
  });

  it('keeps openings free of REI, and the structure free of everything but R', () => {
    // Not decoration: a door separates but does not bear, and a column bears
    // but does not separate. The difference between the three lists IS the
    // rule, which is why they are three lists and not one filtered.
    const openings = requirementByName('FireRatingOpenings')!;
    assert.ok(!openings.values.some((v) => v.startsWith('REI')));

    const structure = requirementByName('FireRatingConstruction')!;
    assert.ok(structure.values.every((v) => v === 'NONE' || /^R\d+$/.test(v)));
  });

  it('lets every requirement be answered with "nothing required"', () => {
    for (const requirement of COMPARTMENT_REQUIREMENTS) {
      assert.ok(requirement.values.includes('NONE'), requirement.name);
    }
  });
});

describe('isPermitted', () => {
  it('accepts a specified value', () => {
    assert.equal(isPermitted(requirementByName('FireRatingWalls')!, 'EI30-RF1'), true);
  });

  it('rejects the same value spelled differently', () => {
    // Exactly the failure this module exists to prevent: it would look right
    // in a panel and fail in the receiving tool.
    const walls = requirementByName('FireRatingWalls')!;
    assert.equal(isPermitted(walls, 'ei30-rf1'), false);
    assert.equal(isPermitted(walls, 'EI30 RF1'), false);
    assert.equal(isPermitted(walls, 'EI 30'), false);
  });
});

describe('summariseRequirements', () => {
  it('names only what has been decided', () => {
    const line = summariseRequirements(new Map([['FireRatingWalls', 'EI60']]));

    assert.equal(line, 'Feuerwiderstand Wände: EI60');
  });

  it('says nothing at all when nothing has been decided', () => {
    // A row of five dashes reads as "answered with nothing", which is the one
    // thing it must not be confused with.
    assert.equal(summariseRequirements(new Map()), '');
  });

  it('keeps NONE, because it is an answer', () => {
    const line = summariseRequirements(new Map([['EscapeRouteType', 'NONE']]));

    assert.match(line, /NONE/);
  });
});
