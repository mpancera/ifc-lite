/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chainSegments, planAnnotations, textHeightMetres, describeAnnotationSet,
  isPlanAnnotationObjectType, planAnnotationIdsToReplace,
  PLAN_ANNOTATION_OBJECTTYPES, PLAN_TEXT_PAPER_MM,
} from './planAnnotations.js';
import type { PlanLabel } from './roomLabels.js';
import type { SymbolLine } from './openingSymbols.js';

const p = (x: number, y: number) => ({ x, y });
const seg = (x1: number, y1: number, x2: number, y2: number): SymbolLine => (
  { start: p(x1, y1), end: p(x2, y2) }
);

function label(over: Partial<PlanLabel> = {}): PlanLabel {
  return {
    key: 'k', expressId: 42, kind: 'room',
    anchor: p(3, 4),
    lines: ['1.04', 'Sitzungszimmer', '18.5 m²'],
    width: 4, height: 3, fit: 'inside',
    ...over,
  };
}

describe('textHeightMetres', () => {
  it('turns paper millimetres into model metres at the plan scale', () => {
    // 2.5 mm on paper at 1:100 is 0.25 m in the model.
    assert.equal(textHeightMetres(100), PLAN_TEXT_PAPER_MM / 1000 * 100);
    assert.equal(textHeightMetres(50), 0.125);
  });

  it('falls back to 1:100 rather than emitting invisible text', () => {
    assert.equal(textHeightMetres(0), 0.25);
    assert.equal(textHeightMetres(Number.NaN), 0.25);
    assert.equal(textHeightMetres(-50), 0.25);
  });
});

describe('chainSegments', () => {
  it('joins an arc\'s chords into one run', () => {
    // The swing arc arrives as consecutive chords. Committing them one by one
    // would put a dozen annotations in the model for one door.
    const arc = [seg(0, 0, 1, 1), seg(1, 1, 2, 1), seg(2, 1, 3, 0)];
    const chains = chainSegments(arc);
    assert.equal(chains.length, 1);
    assert.deepEqual(chains[0], [p(0, 0), p(1, 1), p(2, 1), p(3, 0)]);
  });

  it('keeps separate runs separate', () => {
    const chains = chainSegments([seg(0, 0, 1, 0), seg(5, 5, 6, 5)]);
    assert.equal(chains.length, 2);
  });

  it('joins a segment that arrives reversed', () => {
    // Nothing obliges a symbol builder to emit consistent direction.
    const chains = chainSegments([seg(0, 0, 1, 0), seg(2, 0, 1, 0)]);
    assert.equal(chains.length, 1);
    assert.equal(chains[0].length, 3);
  });

  it('extends backwards from the first segment it picked up', () => {
    const chains = chainSegments([seg(1, 0, 2, 0), seg(0, 0, 1, 0)]);
    assert.equal(chains.length, 1);
    assert.deepEqual(chains[0], [p(0, 0), p(1, 0), p(2, 0)]);
  });

  it('drops a segment of zero length', () => {
    assert.deepEqual(chainSegments([seg(1, 1, 1, 1)]), []);
  });

  it('has nothing to chain from nothing', () => {
    assert.deepEqual(chainSegments([]), []);
  });
});

describe('planAnnotations', () => {
  const set = planAnnotations({
    roomLabels: [label()],
    doorLabels: [label({ expressId: 7, kind: 'door', lines: ['T04', '90/210'] })],
    symbols: [{ expressId: 7, lines: [seg(0, 0, 1, 0), seg(1, 0, 1, 1)] }],
    scaleDenominator: 100,
  });

  it('writes one annotation per line of text', () => {
    // IfcAnnotation carries a single text item and IfcTextLiteralWithExtent a
    // single string — there is no multi-line layout to hand a reader.
    assert.equal(set.roomLabel.length, 3);
    assert.equal(set.doorLabel.length, 2);
  });

  it('flips the drawing\'s y into storey-local IFC', () => {
    // The one sign in the whole path that is easy to get wrong and produces
    // output that looks plausible and is mirrored.
    const first = set.roomLabel[0].geometry;
    assert.equal(first.kind, 'text');
    if (first.kind !== 'text') return;
    assert.equal(first.position[0], 3);
    // Anchor y is 4, the block starts one line above centre at 4 - 0.25.
    assert.equal(first.position[1], -(4 - 0.25));
  });

  it('stacks the lines the way the overlay does', () => {
    const ys = set.roomLabel.map((a) => (a.geometry.kind === 'text' ? a.geometry.position[1] : 0));
    // Storey-local y is negated, so a line lower on the plan is more negative.
    assert.deepEqual(ys, [-3.75, -4, -4.25]);
  });

  it('sizes the text for the scale it was committed at', () => {
    const at50 = planAnnotations({
      roomLabels: [label()], doorLabels: [], symbols: [], scaleDenominator: 50,
    });
    const h = (s: typeof set) => (s.roomLabel[0].geometry.kind === 'text'
      ? s.roomLabel[0].geometry.height : 0);
    assert.equal(h(set), 0.25);
    assert.equal(h(at50), 0.125);
  });

  it('marks every annotation so a second run can find it', () => {
    assert.ok(set.roomLabel.every((a) => a.ObjectType === PLAN_ANNOTATION_OBJECTTYPES.roomLabel));
    assert.ok(set.doorLabel.every((a) => a.ObjectType === PLAN_ANNOTATION_OBJECTTYPES.doorLabel));
    assert.ok(set.openingSymbol.every(
      (a) => a.ObjectType === PLAN_ANNOTATION_OBJECTTYPES.openingSymbol,
    ));
  });

  it('records which element each annotation describes', () => {
    assert.equal(set.roomLabel[0].Description, '#42');
    assert.equal(set.doorLabel[0].Description, '#7');
    assert.equal(set.openingSymbol[0].Description, '#7');
  });

  it('names every line of a label after the label\'s heading', () => {
    // So the three lines of one room read as one stamp in an entity list.
    assert.deepEqual(set.roomLabel.map((a) => a.Name), ['1.04', '1.04', '1.04']);
  });

  it('chains a symbol into runs rather than per segment', () => {
    assert.equal(set.openingSymbol.length, 1);
    const geometry = set.openingSymbol[0].geometry;
    assert.equal(geometry.kind, 'polyline');
    if (geometry.kind !== 'polyline') return;
    assert.deepEqual(geometry.points, [[0, -0], [1, -0], [1, -1]]);
  });

  it('skips a label with nothing written on it', () => {
    const empty = planAnnotations({
      roomLabels: [label({ lines: ['', '   '] })],
      doorLabels: [], symbols: [], scaleDenominator: 100,
    });
    assert.equal(empty.roomLabel.length, 0);
  });
});

describe('isPlanAnnotationObjectType', () => {
  it('recognises what this module writes', () => {
    assert.ok(isPlanAnnotationObjectType('IfcLite:PlanRoomLabel'));
    assert.ok(isPlanAnnotationObjectType(' IfcLite:PlanOpeningSymbol '));
  });

  it('leaves somebody else\'s annotation alone', () => {
    // A user's own note must survive a re-commit.
    assert.ok(!isPlanAnnotationObjectType('Revision'));
    assert.ok(!isPlanAnnotationObjectType(''));
    assert.ok(!isPlanAnnotationObjectType(null));
    assert.ok(!isPlanAnnotationObjectType('IfcLite:GeneratedSpace'));
  });
});

describe('planAnnotationIdsToReplace', () => {
  const at = (objectType: unknown) => ['guid', '#7', 'Name', null, objectType];
  const candidates = [
    { expressId: 1, attributes: at('IfcLite:PlanRoomLabel') },
    { expressId: 2, attributes: at('IfcLite:PlanDoorLabel') },
    { expressId: 3, attributes: at('IfcLite:PlanOpeningSymbol') },
    { expressId: 4, attributes: at('Revision') },
    { expressId: 5, attributes: at(null) },
    { expressId: 6 },
  ];

  it('takes back only the kinds being re-committed', () => {
    assert.deepEqual(planAnnotationIdsToReplace(candidates, ['roomLabel']), [1]);
    assert.deepEqual(planAnnotationIdsToReplace(candidates, ['roomLabel', 'doorLabel']), [1, 2]);
  });

  it('never touches an annotation somebody else made', () => {
    // A hand-drawn note or a committed measurement is not ours to delete.
    const all = planAnnotationIdsToReplace(
      candidates, ['roomLabel', 'doorLabel', 'openingSymbol'],
    );
    assert.deepEqual(all, [1, 2, 3]);
  });

  it('removes nothing when nothing is being committed', () => {
    assert.deepEqual(planAnnotationIdsToReplace(candidates, []), []);
  });

  it('shrugs at an entity with no attributes to read', () => {
    assert.deepEqual(planAnnotationIdsToReplace([{ expressId: 9 }], ['roomLabel']), []);
  });
});

describe('describeAnnotationSet', () => {
  it('counts what would be written', () => {
    const set = planAnnotations({
      roomLabels: [label()], doorLabels: [], symbols: [], scaleDenominator: 100,
    });
    assert.equal(describeAnnotationSet(set), '3 Raumbeschriftungen');
  });

  it('says so when there is nothing', () => {
    const empty = planAnnotations({
      roomLabels: [], doorLabels: [], symbols: [], scaleDenominator: 100,
    });
    assert.equal(describeAnnotationSet(empty), 'nichts zu übernehmen');
  });
});
