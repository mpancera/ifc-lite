/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a piece of text on a plan is. A room carries up to three labels: a
 * number ("1.02", "EG.12", "R 204"), a name ("Büro", "Corridor") and an area
 * ("12.5 m²"). Telling them apart is what lets a number go to `Name` and a
 * name to `LongName` instead of both landing in one field.
 */

export type LabelKind = 'number' | 'name' | 'area' | 'other';

export interface ParsedLabel {
  kind: LabelKind;
  /** The cleaned text; for an area the number in m². */
  value: string;
  areaM2?: number;
}

/** "1.02", "EG.12", "R 204", "A-101", "2.12.T2" — a storey or wing prefix, then numbers. */
const NUMBER = /^[A-Z]{0,3}[.\-\s]?\d{1,3}([.\-/][A-Z]?\d{1,3}){0,2}[a-z]?$/i;
const AREA = /^(\d{1,5}(?:[.,]\d{1,2})?)\s*m\s*(?:²|2|\^2)$/i;
const NAME = /^[\p{L}][\p{L}\p{N} .,'’&()/-]{1,60}$/u;

export function parseLabel(raw: string): ParsedLabel {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return { kind: 'other', value: '' };
  const area = AREA.exec(text);
  if (area) {
    return { kind: 'area', value: text, areaM2: Number(area[1].replace(',', '.')) };
  }
  if (NUMBER.test(text)) return { kind: 'number', value: text };
  if (NAME.test(text) && /\p{L}{2,}/u.test(text)) return { kind: 'name', value: text };
  return { kind: 'other', value: text };
}
