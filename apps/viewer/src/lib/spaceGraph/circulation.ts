/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Telling circulation space apart, and which KIND of escape route it is.
 *
 * # Why "Erschliessung" is not an answer
 * Marc, 2026-08-18: *"Erschliessung" ist ein Überbegriff, darin können
 * Begriffe wie folgt versammelt werden: Korridor, Gang, Treppe, Treppenhaus,
 * etc. und im Kontext von Brandschutz dann eher Fluchtkorridor (horizontaler
 * Fluchtweg) und Fluchttreppenhaus (vertikaler Fluchtweg).*
 *
 * So a room called "Erschliessung" states that people move through it and
 * nothing more. Treating that as a stairwell would end escape routes in
 * corridors; ignoring it would throw away the one thing the model did say. It
 * is therefore its own answer — `'unspecified'` — and something else has to
 * settle it.
 *
 * # What settles it
 * A stair. A circulation space with stair geometry standing in it is a
 * stairwell whatever it is called, and that is a fact about the building
 * rather than about somebody's naming convention — which is why it beats the
 * name. The demo model is exactly this case: its circulation rooms are called
 * "Erschliessung", and only the stairs inside them say which ones are
 * stairwells.
 *
 * # The two kinds are the two zone themes
 * `horizontal` and `vertical` are not invented here. `lib/ifcZones/themes.ts`
 * already carries `EscapeRouteHorizontal` and `EscapeRouteVertical`, and a
 * route drawn through a space classified here should land in the matching
 * zone. One vocabulary, two places that must not drift.
 */

import type { SpaceNode } from './spaceGraph.js';

/**
 * What kind of circulation a space is.
 *
 * `null` means "not circulation at all" — an office, a store room. That is
 * different from `'unspecified'`, which means "circulation, kind unknown", and
 * conflating the two is exactly the mistake this type exists to prevent.
 */
export type CirculationKind = 'horizontal' | 'vertical' | 'unspecified' | null;

/** Words that name a vertical escape route: a stair, however it is spelled. */
const VERTICAL_WORDS: readonly string[] = [
  'treppenhaus', 'fluchttreppenhaus', 'sicherheitstreppenhaus', 'treppe',
  'stairwell', 'staircase', 'stair', 'escapestair',
  'escaperoutevertical',
];

/** Words that name a horizontal escape route: a corridor. */
const HORIZONTAL_WORDS: readonly string[] = [
  'fluchtkorridor', 'korridor', 'gang', 'flur', 'vorraum',
  'corridor', 'hallway', 'passage',
  'escaperoutehorizontal',
];

/**
 * Words that say "people move through here" without saying how.
 *
 * The umbrella terms. Matched LAST, so that "Erschliessung Treppenhaus Nord"
 * is read as the stairwell it is rather than as an unspecified space.
 */
const UMBRELLA_WORDS: readonly string[] = [
  'erschliessung', 'erschließung', 'verkehrsflaeche', 'verkehrsfläche',
  'circulation',
];

/** Whether any of the words appears in the text. */
function mentions(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

/**
 * Classify a space from its name and usage alone.
 *
 * Order matters and is the whole design: the SPECIFIC terms are tested before
 * the umbrella ones, because a name may carry both and the specific one is
 * the one that says something.
 */
export function circulationFromName(space: SpaceNode): CirculationKind {
  const text = `${space.name} ${space.usage ?? ''}`.toLowerCase();

  if (mentions(text, VERTICAL_WORDS)) return 'vertical';
  if (mentions(text, HORIZONTAL_WORDS)) return 'horizontal';
  if (mentions(text, UMBRELLA_WORDS)) return 'unspecified';
  return null;
}

/**
 * Classify a space, letting stair geometry settle what the name left open.
 *
 * `containsStair` comes from the model: whether any `IfcStair` /
 * `IfcStairFlight` stands inside this room's footprint.
 *
 * # A stair RESOLVES circulation, it does not CREATE it
 * The stair only ever turns `'unspecified'` into `'vertical'`. It cannot
 * promote a room that is not circulation at all, and it cannot overrule a name
 * that already said "corridor".
 *
 * That restriction is not caution, it is a measured correction. On the museum
 * test model this rule first read stairs as stairwells wherever it found them,
 * and reported "Ausstellung Bibliothek" — a 188 m² exhibition room — plus the
 * entrance hall and the vestibule as fire escape stairwells. A stair stands in
 * the middle of an exhibition hall as readily as in a stairwell; what makes a
 * stairwell is that the room is CIRCULATION, and the model says that through
 * the name, not through the presence of treads.
 *
 * The asymmetry is deliberate: a stairwell missed shows up as "no stairwell
 * found", which somebody notices. A stairwell invented ends escape routes in
 * an exhibition hall, in a document somebody signs.
 */
export function circulationKind(
  space: SpaceNode,
  containsStair: boolean,
): CirculationKind {
  const byName = circulationFromName(space);

  if (byName === 'vertical' || byName === 'horizontal') return byName;
  if (byName === 'unspecified' && containsStair) return 'vertical';
  return byName;
}

/**
 * Whether a space is a stairwell — the natural end of an escape route.
 *
 * Deliberately NOT satisfied by `'unspecified'`. A route that ends in a
 * corridor because the corridor was called "Erschliessung" states a fire
 * safety fact that is not true, and it states it in a document somebody signs.
 */
export function isStairwellSpace(space: SpaceNode, containsStair: boolean): boolean {
  return circulationKind(space, containsStair) === 'vertical';
}

/**
 * The zone theme id a route through this space belongs to.
 *
 * `null` where the space is not circulation, or where it is circulation of an
 * unknown kind: guessing a theme would file the route under a heading the
 * author never chose.
 */
export function themeIdForCirculation(kind: CirculationKind): string | null {
  if (kind === 'vertical') return 'escape-vertical';
  if (kind === 'horizontal') return 'escape-horizontal';
  return null;
}

/** What to call the kind in the interface. */
export const CIRCULATION_LABELS: Readonly<Record<
  Exclude<CirculationKind, null>, string
>> = {
  horizontal: 'Fluchtkorridor (horizontaler Fluchtweg)',
  vertical: 'Fluchttreppenhaus (vertikaler Fluchtweg)',
  unspecified: 'Erschliessung (Art noch offen)',
};
