/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The failure that matters here is an element filed under two storeys at once,
 * which reads as a successful move from either end and answers "which floor?"
 * differently depending on which relationship the reader walked first. Most of
 * these tests are about that, and about the schema's two "at least one" rules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planStoreyMove, type ContainmentRel } from './plan-storey-move.js';

const U1 = 38, EG = 46, OG = 50;

const rels = (): ContainmentRel[] => [
  { expressId: 100, structureId: U1, elementIds: [1, 2, 3] },
  { expressId: 200, structureId: EG, elementIds: [4, 5] },
];

describe('planStoreyMove', () => {
  it('takes an element out of its old storey as it puts it in the new one', () => {
    const plan = planStoreyMove(rels(), [2], EG);
    assert.ok(plan);
    assert.deepEqual(plan.moved, [2]);
    assert.deepEqual(plan.rewrites, [{ relExpressId: 100, elementIds: [1, 3] }],
      'the old relationship must lose it');
    assert.deepEqual(plan.target, { relExpressId: 200, elementIds: [4, 5, 2] });
    assert.deepEqual(plan.drops, []);
  });

  it('drops a relationship its last element leaves, rather than writing it empty', () => {
    // RelatedElements is a set of at least one. An empty relationship is
    // schema-invalid and some readers refuse the whole file over it.
    const plan = planStoreyMove(rels(), [4, 5], U1);
    assert.ok(plan);
    assert.deepEqual(plan.drops, [200]);
    assert.deepEqual(plan.rewrites, [], 'nothing to rewrite — it is gone');
    assert.deepEqual(plan.target, { relExpressId: 100, elementIds: [1, 2, 3, 4, 5] });
  });

  it('creates the relationship when the target storey has none', () => {
    const plan = planStoreyMove(rels(), [1, 4], OG);
    assert.ok(plan);
    assert.deepEqual(plan.target, { create: true, elementIds: [1, 4] });
    assert.deepEqual(plan.rewrites.sort((a, b) => a.relExpressId - b.relExpressId), [
      { relExpressId: 100, elementIds: [2, 3] },
      { relExpressId: 200, elementIds: [5] },
    ]);
  });

  it('reports nothing to do rather than an edit that writes nothing', () => {
    assert.equal(planStoreyMove(rels(), [4, 5], EG), null, 'both already there');
    assert.equal(planStoreyMove(rels(), [], OG), null);
  });

  it('separates the ones already there from the ones it moves', () => {
    const plan = planStoreyMove(rels(), [1, 4], EG);
    assert.ok(plan);
    assert.deepEqual(plan.moved, [1]);
    assert.deepEqual(plan.alreadyThere, [4]);
    assert.deepEqual(plan.target, { relExpressId: 200, elementIds: [4, 5, 1] },
      'and must not list the one already there twice');
  });

  it('files an element no relationship held', () => {
    const plan = planStoreyMove(rels(), [99], EG);
    assert.ok(plan);
    assert.deepEqual(plan.moved, [99]);
    assert.deepEqual(plan.wereUnfiled, [99], 'worth saying: this one had no storey at all');
    assert.deepEqual(plan.rewrites, []);
  });

  it('cleans up an element two relationships both claimed', () => {
    // A malformed file can contain the same element twice. Filtering EVERY
    // relationship, not just the one found first, leaves it in exactly one.
    const doubled: ContainmentRel[] = [
      { expressId: 100, structureId: U1, elementIds: [7] },
      { expressId: 200, structureId: EG, elementIds: [8] },
      { expressId: 300, structureId: OG, elementIds: [7, 9] },
    ];
    const plan = planStoreyMove(doubled, [7], EG);
    assert.ok(plan);
    assert.deepEqual(plan.drops, [100]);
    assert.deepEqual(plan.rewrites, [{ relExpressId: 300, elementIds: [9] }]);
    assert.deepEqual(plan.target, { relExpressId: 200, elementIds: [8, 7] });
  });

  it('ignores a repeated request instead of filing the element twice', () => {
    const plan = planStoreyMove(rels(), [2, 2, 2], EG);
    assert.ok(plan);
    assert.deepEqual(plan.moved, [2]);
    assert.deepEqual(plan.target, { relExpressId: 200, elementIds: [4, 5, 2] });
  });
});
