/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The colour of an `IfcZone`, carried in its `Description`.
 *
 * A trigger zone's colour is not decoration — it is the colour that zone has in
 * the fire concept, so it has to survive an export and come back on reload.
 * IFC gives a group no colour attribute and no standard pset, so it goes in the
 * one free-text field the zone already has, as a token with an explicit key:
 *
 *     Auslösezone Ostflügel ZoneDisplay=#472A24
 *
 * The token always sits at the END, after whatever the author wrote. That order
 * is the point: a human reading `Description` in any other IFC tool sees their
 * own sentence first and a labelled key-value after it, rather than opening
 * with machine noise. Reading is lenient — the token is found wherever it sits,
 * in any case, with or without spaces around the `=` — and writing is
 * canonical, which quietly tidies a hand-edited description on the next change.
 *
 * Pure: no store, no IFC. `Description` goes in, `Description` comes out.
 */

/** The key that marks the token. Deliberately verbose — it appears in files
 *  other tools open, and `Colour=` alone would read like the author's own note. */
export const ZONE_DISPLAY_KEY = 'ZoneDisplay';

/**
 * Matches the token anywhere in the text.
 *
 * Three or six hex digits are accepted on the way in because a hand-typed
 * `#f00` is a reasonable thing to write; both normalise to six on the way out.
 */
const TOKEN = new RegExp(`\\s*\\b${ZONE_DISPLAY_KEY}\\s*=\\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b`, 'i');

export interface ZoneDescription {
  /** What the author wrote, with the token removed. */
  text: string;
  /** `#RRGGBB` uppercase, or `null` when the zone carries no colour. */
  colour: string | null;
}

/** Expand `#abc` to `#AABBCC`; pass six digits through, uppercased. */
function normaliseHex(digits: string): string {
  const hex = digits.length === 3
    ? digits.split('').map((d) => d + d).join('')
    : digits;
  return `#${hex.toUpperCase()}`;
}

/** Split a zone's `Description` into the author's text and the colour. */
export function parseZoneDescription(description: string | null | undefined): ZoneDescription {
  const raw = description ?? '';
  const match = TOKEN.exec(raw);
  if (!match) return { text: raw.trim(), colour: null };
  return {
    text: (raw.slice(0, match.index) + raw.slice(match.index + match[0].length)).trim(),
    colour: normaliseHex(match[1]),
  };
}

/**
 * Compose a `Description` from the author's text and a colour.
 *
 * Passing `null` for the colour removes the token and leaves the text alone,
 * so "no colour" is expressible rather than only ever addable.
 */
export function formatZoneDescription(
  text: string | null | undefined,
  colour: string | null,
): string {
  // Anything already in the text is stripped first, so calling this twice
  // cannot leave two tokens behind — the case a naive append would create
  // every time somebody recolours a zone.
  const body = parseZoneDescription(text).text;
  if (!colour) return body;

  const digits = colour.replace('#', '');
  const token = `${ZONE_DISPLAY_KEY}=${normaliseHex(digits)}`;
  return body ? `${body} ${token}` : token;
}

/** Convenience: just the colour, or `null`. */
export function zoneColourOf(description: string | null | undefined): string | null {
  return parseZoneDescription(description).colour;
}
