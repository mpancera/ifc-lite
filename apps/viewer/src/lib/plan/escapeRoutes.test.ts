/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeRouteLength, formatRouteLength, pointAlongRoute, arrowPositions, arrowHead,
  paperMmToMetres, escapeRouteAnnotations, describeEscapeRouteSet,
  isEscapeRouteObjectType, ESCAPE_ROUTE_OBJECTTYPES,
  ARROW_SPACING_PAPER_MM,
  escapeRouteIdsToReplace, ANNOTATION_OBJECTTYPE_INDEX,
  type EscapeRoute,
} from './escapeRoutes.js';
import {
  PLAN_ANNOTATION_OBJECTTYPES, planAnnotationIdsToReplace,
} from './planAnnotations.js';

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

/** An L: 10 m east, then 5 m south. Walked length 15, straight line ~11.18. */
const L_SHAPED: EscapeRoute = {
  id: 'r1',
  kind: 'horizontal',
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }],
};

describe('escapeRouteLength', () => {
  it('measures around the corner, not through it', () => {
    // The mistake this guards is understating every route that bends, which is
    // all of them: end-to-end distance here would be 11.18 m, not 15.
    assert.ok(near(escapeRouteLength(L_SHAPED.points), 15));
  });

  it('is zero for a path that goes nowhere', () => {
    assert.equal(escapeRouteLength([]), 0);
    assert.equal(escapeRouteLength([{ x: 3, y: 4 }]), 0);
    assert.equal(escapeRouteLength([{ x: 3, y: 4 }, { x: 3, y: 4 }]), 0);
  });
});

describe('formatRouteLength', () => {
  it('gives one decimal — the line was drawn by hand, not surveyed', () => {
    assert.equal(formatRouteLength(15), '15.0 m');
    assert.equal(formatRouteLength(24.649), '24.6 m');
  });
});

describe('paperMmToMetres', () => {
  it('scales a paper size into the model', () => {
    // 4 mm on paper at 1:100 is 0.4 m of building.
    assert.ok(near(paperMmToMetres(4, 100), 0.4));
    assert.ok(near(paperMmToMetres(4, 50), 0.2));
  });

  it('falls back to 1:100 rather than collapsing to zero', () => {
    // A zero-size arrow is an invisible one, and the plan would silently lose
    // its direction marks.
    assert.ok(near(paperMmToMetres(4, null), 0.4));
    assert.ok(near(paperMmToMetres(4, 0), 0.4));
    assert.ok(near(paperMmToMetres(4, NaN), 0.4));
  });
});

describe('pointAlongRoute', () => {
  it('walks past the corner into the second leg', () => {
    const at = pointAlongRoute(L_SHAPED.points, 12);
    assert.ok(at !== null);
    assert.ok(near(at.point.x, 10));
    assert.ok(near(at.point.y, 2));
    // Travelling south now, not east.
    assert.ok(near(at.direction.x, 0));
    assert.ok(near(at.direction.y, 1));
  });

  it('reports the exit end exactly', () => {
    const at = pointAlongRoute(L_SHAPED.points, 15);
    assert.ok(at !== null);
    assert.ok(near(at.point.x, 10));
    assert.ok(near(at.point.y, 5));
  });

  it('answers null past the end instead of extrapolating', () => {
    assert.equal(pointAlongRoute(L_SHAPED.points, 15.001), null);
  });

  it('steps over a duplicated click instead of producing a NaN direction', () => {
    const withDuplicate = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }];
    const at = pointAlongRoute(withDuplicate, 2);
    assert.ok(at !== null);
    assert.ok(Number.isFinite(at.direction.x) && Number.isFinite(at.direction.y));
    assert.ok(near(at.direction.x, 1));
  });

  it('refuses nonsense distances', () => {
    assert.equal(pointAlongRoute(L_SHAPED.points, -1), null);
    assert.equal(pointAlongRoute(L_SHAPED.points, NaN), null);
    assert.equal(pointAlongRoute([{ x: 0, y: 0 }], 0), null);
  });
});

describe('arrowPositions', () => {
  it('always marks the exit end, however the spacing works out', () => {
    // The arrow that says which way out is the one that must never be dropped.
    const positions = arrowPositions(L_SHAPED.points, 100);
    assert.ok(positions.length >= 1);
    assert.ok(near(positions[0].point.x, 10));
    assert.ok(near(positions[0].point.y, 5));
  });

  it('spaces arrows on PAPER, so the rhythm survives a scale change', () => {
    // 40 mm of paper is 4 m at 1:100 but 20 m at 1:500 — a 15 m route gets
    // several arrows at the first scale and only the exit one at the second.
    const dense = arrowPositions(L_SHAPED.points, 100);
    const sparse = arrowPositions(L_SHAPED.points, 500);
    assert.ok(dense.length > sparse.length, `${dense.length} vs ${sparse.length}`);
    assert.equal(sparse.length, 1);
  });

  it('anchors the spacing to the exit, not to the far end', () => {
    // So that extending the far end of a route does not shuffle every arrow.
    const spacing = paperMmToMetres(ARROW_SPACING_PAPER_MM, 100);
    const positions = arrowPositions(L_SHAPED.points, 100);
    const total = escapeRouteLength(L_SHAPED.points);

    // Second arrow sits exactly one spacing back from the end.
    const expected = pointAlongRoute(L_SHAPED.points, total - spacing);
    assert.ok(expected !== null);
    assert.ok(near(positions[1].point.x, expected.point.x, 1e-6));
    assert.ok(near(positions[1].point.y, expected.point.y, 1e-6));
  });

  it('has nothing to mark on a route of no length', () => {
    assert.deepEqual(arrowPositions([{ x: 1, y: 1 }, { x: 1, y: 1 }], 100), []);
  });
});

describe('arrowHead', () => {
  it('points along the direction of travel', () => {
    // Travelling east: the tip is ahead and both barbs trail behind it.
    const head = arrowHead({ point: { x: 10, y: 0 }, direction: { x: 1, y: 0 } }, 1);
    assert.equal(head.length, 3);
    // The middle point is the tip.
    assert.ok(near(head[1].x, 10) && near(head[1].y, 0));
    // Both barbs sit BACK from the tip, i.e. at smaller x.
    assert.ok(head[0].x < 10, `${head[0].x}`);
    assert.ok(head[2].x < 10, `${head[2].x}`);
  });

  it('puts its barbs symmetrically about the line of travel', () => {
    const head = arrowHead({ point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } }, 1);
    assert.ok(near(head[0].y, -head[2].y, 1e-9));
  });
});

describe('escapeRouteAnnotations', () => {
  const input = { routes: [L_SHAPED], scaleDenominator: 100, textHeightMetres: 0.25 };

  it('writes the line, its arrows and its length', () => {
    const set = escapeRouteAnnotations(input);
    assert.equal(set.route.length, 1);
    assert.ok(set.arrow.length >= 1);
    assert.equal(set.label.length, 1);
  });

  it('states the walked length, not the straight-line distance', () => {
    // The number the drawing exists to settle.
    const set = escapeRouteAnnotations(input);
    const text = set.label[0].geometry;
    assert.equal(text.kind, 'text');
    assert.equal(text.kind === 'text' ? text.text : '', '15.0 m');
  });

  it('carries the length on the line itself, for readers that draw no text', () => {
    const set = escapeRouteAnnotations(input);
    assert.match(String(set.route[0].Description), /15\.0 m/);
    assert.match(String(set.route[0].Description), /horizontal/);
  });

  it('flips Y into storey-local coordinates like every other annotation', () => {
    const set = escapeRouteAnnotations({
      ...input,
      routes: [{ id: 'r', kind: 'horizontal', points: [{ x: 0, y: 0 }, { x: 0, y: 4 }] }],
    });
    const geometry = set.route[0].geometry;
    assert.equal(geometry.kind, 'polyline');
    // Drawing y=4 becomes local y=-4.
    assert.deepEqual(geometry.kind === 'polyline' ? geometry.points[1] : null, [0, -4]);
  });

  it('places the length at the middle of the WALKED path', () => {
    // On an L the straight midpoint can land outside the building. Halfway
    // along 15 m is 7.5 m into the first 10 m leg, so x = 7.5.
    const set = escapeRouteAnnotations(input);
    const text = set.label[0].geometry;
    assert.equal(text.kind, 'text');
    if (text.kind === 'text') assert.ok(near(text.position[0], 7.5, 1e-6));
  });

  it('drops an unfinished click instead of committing a zero-length route', () => {
    const set = escapeRouteAnnotations({
      ...input,
      routes: [{ id: 'r', kind: 'horizontal', points: [{ x: 1, y: 1 }] }],
    });
    assert.deepEqual(set.route, []);
    assert.deepEqual(set.arrow, []);
    assert.deepEqual(set.label, []);
  });

  it('names a vertical route as one, so the plan says which it is', () => {
    const set = escapeRouteAnnotations({
      ...input,
      routes: [{ ...L_SHAPED, kind: 'vertical' }],
    });
    assert.match(String(set.route[0].Name), /vertikal/);
  });

  it('keeps the author’s own name when there is one', () => {
    const set = escapeRouteAnnotations({
      ...input,
      routes: [{ ...L_SHAPED, name: 'Fluchtweg 1' }],
    });
    assert.equal(set.route[0].Name, 'Fluchtweg 1');
  });
});

describe('the marker', () => {
  it('is not shared with the plan labels', () => {
    // Committing room labels must never sweep away somebody's drawn routes.
    // A shared marker would do exactly that on the next re-commit.
    const planMarkers = new Set<string>(Object.values(PLAN_ANNOTATION_OBJECTTYPES));
    for (const marker of Object.values(ESCAPE_ROUTE_OBJECTTYPES)) {
      assert.ok(!planMarkers.has(marker), `${marker} collides with a plan label marker`);
    }
  });

  it('recognises its own output and nothing else', () => {
    assert.ok(isEscapeRouteObjectType(ESCAPE_ROUTE_OBJECTTYPES.route));
    assert.ok(isEscapeRouteObjectType(`  ${ESCAPE_ROUTE_OBJECTTYPES.arrow}  `));
    assert.ok(!isEscapeRouteObjectType(PLAN_ANNOTATION_OBJECTTYPES.roomLabel));
    assert.ok(!isEscapeRouteObjectType(null));
    assert.ok(!isEscapeRouteObjectType(''));
  });
});

describe('describeEscapeRouteSet', () => {
  it('counts what would be committed', () => {
    const set = escapeRouteAnnotations({
      routes: [L_SHAPED], scaleDenominator: 100, textHeightMetres: 0.25,
    });
    assert.match(describeEscapeRouteSet(set), /1 Fluchtweg/);
    assert.match(describeEscapeRouteSet(set), /Richtungspfeil/);
  });

  it('says so when there is nothing', () => {
    assert.equal(
      describeEscapeRouteSet({ route: [], arrow: [], label: [] }),
      'nichts zu übernehmen',
    );
  });
});

describe('escapeRouteIdsToReplace', () => {
  /** An annotation with `ObjectType` at the index IFC puts it. */
  const annotation = (expressId: number, objectType: string) => {
    const attributes: unknown[] = [];
    attributes[ANNOTATION_OBJECTTYPE_INDEX] = objectType;
    return { expressId, attributes };
  };

  it('picks out only the kinds being re-committed', () => {
    const candidates = [
      annotation(1, ESCAPE_ROUTE_OBJECTTYPES.route),
      annotation(2, ESCAPE_ROUTE_OBJECTTYPES.arrow),
      annotation(3, ESCAPE_ROUTE_OBJECTTYPES.label),
    ];
    assert.deepEqual(escapeRouteIdsToReplace(candidates, ['route']), [1]);
    assert.deepEqual(escapeRouteIdsToReplace(candidates, ['arrow', 'label']), [2, 3]);
  });

  it('leaves a note somebody drew by hand alone', () => {
    // Not ours to delete.
    const candidates = [
      annotation(1, ESCAPE_ROUTE_OBJECTTYPES.route),
      annotation(2, 'Notiz'),
      annotation(3, ''),
      { expressId: 4, attributes: [] },
    ];
    assert.deepEqual(escapeRouteIdsToReplace(candidates, ['route', 'arrow', 'label']), [1]);
  });

  it('never touches the plan labels, and they never touch routes', () => {
    // The two commit actions must not sweep away each other's work: a label
    // can be regenerated from the model, a drawn route cannot.
    const mixed = [
      annotation(1, ESCAPE_ROUTE_OBJECTTYPES.route),
      annotation(2, PLAN_ANNOTATION_OBJECTTYPES.roomLabel),
    ];
    assert.deepEqual(
      escapeRouteIdsToReplace(mixed, ['route', 'arrow', 'label']),
      [1],
    );
    assert.deepEqual(
      planAnnotationIdsToReplace(mixed, ['roomLabel', 'doorLabel', 'openingSymbol']),
      [2],
    );
  });

  it('answers empty for no kinds rather than removing everything', () => {
    const candidates = [annotation(1, ESCAPE_ROUTE_OBJECTTYPES.route)];
    assert.deepEqual(escapeRouteIdsToReplace(candidates, []), []);
  });

  it('tolerates padding around the marker', () => {
    const candidates = [annotation(1, `  ${ESCAPE_ROUTE_OBJECTTYPES.route}  `)];
    assert.deepEqual(escapeRouteIdsToReplace(candidates, ['route']), [1]);
  });
});
