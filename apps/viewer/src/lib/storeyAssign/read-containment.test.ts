/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asRef, readContainmentRels, RELATED_ELEMENTS } from './read-containment.js';

const parsedRel = (id: number, structure: number, elements: number[]) =>
  ({ expressId: id, attributes: ['guid', 18, null, null, elements, structure] });

const authoredRel = (id: number, structure: number, elements: number[]) =>
  ({ expressId: id, type: 'IfcRelContainedInSpatialStructure',
     attributes: ['guid', '#18', null, null, elements.map((e) => `#${e}`), `#${structure}`] });

describe('asRef', () => {
  it('reads both notations the store uses', () => {
    assert.equal(asRef(42), 42, 'parsed: a bare express id');
    assert.equal(asRef('#42'), 42, 'authored: the form addEntity takes');
    assert.equal(asRef(' #42 '), 42);
  });

  it('is not fooled by things that are not references', () => {
    for (const v of [null, undefined, '', '#', 'x42', '#4.2', 0, -1, 1.5, {}, []]) {
      assert.equal(asRef(v), null, `${JSON.stringify(v)} should not read as a reference`);
    }
  });
});

describe('readContainmentRels', () => {
  it('reads the parsed file and this session’s own entities alike', () => {
    const rels = readContainmentRels({
      parsed: [parsedRel(100, 38, [1, 2])],
      authored: [authoredRel(300, 50, [7])],
    });
    assert.deepEqual(rels, [
      { expressId: 100, structureId: 38, elementIds: [1, 2] },
      { expressId: 300, structureId: 50, elementIds: [7] },
    ]);
  });

  it('sees what an earlier move already wrote', () => {
    // Without the override this plans against the file as it was LOADED, so a
    // second move in the same session silently undoes the first.
    const rels = readContainmentRels({
      parsed: [parsedRel(100, 38, [1, 2, 3])],
      authored: [],
      positionalOf: (id) => (id === 100 ? new Map([[RELATED_ELEMENTS, ['#1', '#3']]]) : null),
    });
    assert.deepEqual(rels, [{ expressId: 100, structureId: 38, elementIds: [1, 3] }]);
  });

  it('reads a relationship that exists in both halves only once', () => {
    const rels = readContainmentRels({
      parsed: [parsedRel(100, 38, [1])],
      authored: [authoredRel(100, 38, [1])],
    });
    assert.equal(rels.length, 1);
  });

  it('ignores overlay entities that are not containment', () => {
    const zone = { expressId: 400, type: 'IfcRelAssignsToGroup',
                   attributes: ['guid', '#18', null, null, ['#9'], null, '#77'] };
    assert.deepEqual(readContainmentRels({ parsed: [], authored: [zone] }), []);
  });

  it('skips a relationship that contains nothing identifiable', () => {
    // A relationship with no RelatingStructure cannot be reasoned about, and
    // treating its missing structure as "0" would invent a storey.
    const broken = { expressId: 500, attributes: ['guid', 18, null, null, [1], null] };
    assert.deepEqual(readContainmentRels({ parsed: [broken], authored: [] }), []);
  });

  it('keeps a relationship whose element list is empty or absent', () => {
    // It still names a storey, and the plan may want to fill it rather than
    // create a second relationship beside it.
    const rels = readContainmentRels({
      parsed: [{ expressId: 600, attributes: ['guid', 18, null, null, null, 46] }],
      authored: [],
    });
    assert.deepEqual(rels, [{ expressId: 600, structureId: 46, elementIds: [] }]);
  });
});
