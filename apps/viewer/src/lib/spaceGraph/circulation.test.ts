/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  circulationFromName, circulationKind, isStairwellSpace, themeIdForCirculation,
  CIRCULATION_LABELS,
} from './circulation.js';
import { isStairwell, type SpaceNode } from './spaceGraph.js';

function space(name: string, usage: string | null = null): SpaceNode {
  return {
    id: 1, name, usage, area: 20,
    labelPoint: { x: 0, y: 0 },
    triangles: new Float32Array(),
    storeyId: 1,
  };
}

describe('the umbrella term', () => {
  it('reads "Erschliessung" as circulation of an UNKNOWN kind', () => {
    // Marc, 2026-08-18: it is an Überbegriff gathering Korridor, Gang, Treppe,
    // Treppenhaus. On its own it says people move through — nothing more.
    assert.equal(circulationFromName(space('Erschliessung')), 'unspecified');
    assert.equal(circulationFromName(space('Erschließung')), 'unspecified');
    assert.equal(circulationFromName(space('Verkehrsfläche')), 'unspecified');
  });

  it('does NOT make an unspecified space a stairwell', () => {
    // A route ending in a corridor because it was called "Erschliessung"
    // states a fire safety fact that is not true, in a document somebody signs.
    assert.equal(isStairwellSpace(space('Erschliessung'), false), false);
  });

  it('is overruled by a specific term in the same name', () => {
    // "Erschliessung Treppenhaus Nord" is the stairwell it says it is.
    assert.equal(circulationFromName(space('Erschliessung Treppenhaus Nord')), 'vertical');
    assert.equal(circulationFromName(space('Erschliessung Korridor Ost')), 'horizontal');
  });
});

describe('the two escape-route kinds', () => {
  it('reads a stair as the VERTICAL escape route', () => {
    for (const name of [
      'Treppenhaus', 'Fluchttreppenhaus', 'Sicherheitstreppenhaus', 'Treppe',
      'Stairwell', 'Staircase',
    ]) {
      assert.equal(circulationFromName(space(name)), 'vertical', name);
    }
  });

  it('reads a corridor as the HORIZONTAL escape route', () => {
    for (const name of ['Fluchtkorridor', 'Korridor', 'Gang', 'Flur', 'Corridor']) {
      assert.equal(circulationFromName(space(name)), 'horizontal', name);
    }
  });

  it('leaves an ordinary room out of circulation entirely', () => {
    // `null` is not `'unspecified'`: one says "not circulation", the other
    // says "circulation, kind unknown".
    assert.equal(circulationFromName(space('Büro 1')), null);
    assert.equal(circulationFromName(space('Ausstellung "Salon"')), null);
    assert.equal(circulationFromName(space('Küche')), null);
  });

  it('reads the usage as well as the name', () => {
    assert.equal(circulationFromName(space('R 1.04', 'STAIR')), 'vertical');
  });
});

describe('stair geometry settles what a name leaves open', () => {
  it('turns an unspecified circulation space into a stairwell', () => {
    // The demo model's case exactly: rooms called "Erschliessung", and only
    // the stairs inside them say which are stairwells.
    assert.equal(circulationKind(space('Erschliessung'), true), 'vertical');
    assert.equal(isStairwellSpace(space('Erschliessung'), true), true);
  });

  it('does NOT turn an ordinary room with a stair into a stairwell', () => {
    // Measured on the museum test model, where this rule first reported
    // "Ausstellung Bibliothek" (188 m2), the entrance hall and the vestibule
    // as fire escape stairwells: a stair stands in the middle of an exhibition
    // hall as readily as in a stairwell. What makes a stairwell is that the
    // room is CIRCULATION, which the name says and the treads do not.
    assert.equal(circulationKind(space('Ausstellung "Bibliothek"'), true), null);
    assert.equal(circulationKind(space('Vorhalle/Vestibül'), true), null);
    assert.equal(isStairwellSpace(space('Ausstellung "Halle"'), true), false);
  });

  it('accepts missing a stairwell rather than inventing one', () => {
    // The asymmetry: a stairwell missed shows up as "no stairwell found",
    // which somebody notices. One invented ends escape routes in an exhibition
    // hall, in a document somebody signs.
    assert.equal(circulationKind(space('R 0.12'), true), null);
  });

  it('does NOT overrule a name that already said corridor', () => {
    // A single step up into a corridor is stair geometry too. Letting that
    // rename the corridor would be worse than not asking.
    assert.equal(circulationKind(space('Korridor'), true), 'horizontal');
    assert.equal(isStairwellSpace(space('Korridor'), true), false);
  });

  it('changes nothing where there is no stair', () => {
    assert.equal(circulationKind(space('Erschliessung'), false), 'unspecified');
    assert.equal(circulationKind(space('Büro'), false), null);
  });
});

describe('isStairwell on the graph node', () => {
  it('reads containsStair off the node', () => {
    const plain = space('Erschliessung');
    assert.equal(isStairwell(plain), false);
    assert.equal(isStairwell({ ...plain, containsStair: true }), true);
  });

  it('treats a missing containsStair as "no stair known"', () => {
    // Absent is not the same as false in a type sense, but must behave the
    // same: a node built before stairs were detected must not become a
    // stairwell by accident.
    assert.equal(isStairwell(space('Erschliessung')), false);
    assert.equal(isStairwell(space('Treppenhaus')), true);
  });
});

describe('themeIdForCirculation', () => {
  it('maps the two kinds onto the zone themes that already exist', async () => {
    // One vocabulary, two places that must not drift.
    const { ZONE_THEMES } = await import('@/lib/ifcZones/themes');
    const known = new Set(ZONE_THEMES.map((theme) => theme.id));

    for (const kind of ['vertical', 'horizontal'] as const) {
      const id = themeIdForCirculation(kind);
      assert.ok(id !== null);
      assert.ok(known.has(id), `${id} is not a theme in themes.ts`);
    }
  });

  it('refuses to guess a theme for an unspecified space', () => {
    // Filing the route under a heading the author never chose.
    assert.equal(themeIdForCirculation('unspecified'), null);
    assert.equal(themeIdForCirculation(null), null);
  });
});

describe('CIRCULATION_LABELS', () => {
  it('names all three kinds in the language of the drawing', () => {
    assert.match(CIRCULATION_LABELS.horizontal, /Fluchtkorridor/);
    assert.match(CIRCULATION_LABELS.vertical, /Fluchttreppenhaus/);
    assert.match(CIRCULATION_LABELS.unspecified, /Erschliessung/);
  });
});
