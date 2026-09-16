/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading a room's fire-safety role out of what it is called.
 *
 * A model that carries a usage classification (SIA d0165, ICC) should be asked
 * that instead; this is for the ordinary case where the only thing the file
 * says about a room is its name, and a person would nonetheless know at a
 * glance that "Treppenhaus" is a stair and "Korridor Keller" is a corridor.
 *
 * ## Why a name is enough here, and where it stops
 *
 * The two roles this has to find are the two that get their own compartment by
 * rule rather than by judgement: the escape stair and the escape corridors.
 * Both are named with a small, stable vocabulary in German-language models —
 * they are circulation, and circulation is named after what it does. Every
 * other room is "ordinary", which is not a claim about it, only a statement
 * that the name did not identify it as circulation.
 *
 * What this is NOT is a usage classification. It will not tell a Lager from an
 * Ausstellung, and it must not be extended until it tries to: the moment a
 * name is read as a fire load, a room called "Archiv" silently becomes a
 * requirement nobody chose.
 *
 * ## Matched on the whole word
 *
 * Substring matching on a room vocabulary is a trap: "Vorratsraum" contains
 * "Vorrat", "Flurgarderobe" contains "Flur", and a "Treppenhausvorplatz"
 * matches both. Names are split into words and matched whole, longest role
 * first, so a compound is decided by which word it actually carries.
 */

/** What a room does, for the purpose of laying out compartments. */
export type RoomUse =
  /** A stair serving as an escape route. Its own compartment, always. */
  | 'escape-stair'
  /** Corridors, lobbies, circulation. One compartment per storey. */
  | 'escape-corridor'
  /** Everything else. Grouped by where it is, not by what it is. */
  | 'ordinary';

/**
 * Words that name a stair.
 *
 * `Aufzug` is deliberately absent: a lift shaft is its own fire-safety problem
 * with its own rules, and folding it into the escape stair would put a shaft
 * and a stair under one set of requirements because both go up.
 */
const STAIR_WORDS = [
  'treppenhaus', 'treppe', 'treppen', 'fluchttreppe', 'fluchttreppenhaus',
  'stiegenhaus', 'stiege',
];

/**
 * Words that name circulation.
 *
 * `Vorraum` is in, `Vorzimmer` is not: a Vorraum in this vocabulary is the
 * space you pass through to reach somewhere, while a Vorzimmer is a room
 * somebody sits in. The line is genuinely thin, and a wrong call here shows up
 * as a room in the corridor compartment — visible, and one click to move.
 */
const CORRIDOR_WORDS = [
  'korridor', 'gang', 'flur', 'vorplatz', 'erschliessung', 'erschließung',
  'vorraum', 'vestibül', 'vestibul', 'foyer', 'diele', 'schleuse', 'passage',
  'durchgang',
];

/** Split a name into lowercase words, so a compound is judged by its parts. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length > 0);
}

/**
 * The role of a room called this.
 *
 * Both the number and the readable name are read, because offices fill one and
 * leave the other empty in either combination — `Name` holds "U.14" in one
 * model and "Treppenhaus" in the next.
 *
 * A stair beats a corridor when a name carries both ("Treppenhaus Vorplatz"):
 * the stair is the stricter compartment, and the cost of the two possible
 * mistakes is not symmetric.
 */
export function roomUseFromName(name: string | undefined, longName?: string): RoomUse {
  const tokens = new Set([...words(name ?? ''), ...words(longName ?? '')]);
  if (STAIR_WORDS.some((w) => tokens.has(w))) return 'escape-stair';
  if (CORRIDOR_WORDS.some((w) => tokens.has(w))) return 'escape-corridor';
  return 'ordinary';
}

/** Whether a room of this use is part of an escape route (`FireExit = TRUE`). */
export function isEscapeRoute(use: RoomUse): boolean {
  return use === 'escape-stair' || use === 'escape-corridor';
}
