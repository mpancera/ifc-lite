/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning typed text back into an IFC property value.
 *
 * A table cell only ever hands back a string, but `IfcPropertySingleValue`
 * carries a type, and picking the wrong one is silently destructive: room
 * numbers in this project look like `06`, and eagerly reading digits as a
 * number turns that into `6` — a different room, in a file nobody re-checks.
 *
 * So the previous value decides. When a property was a number, a typed number
 * stays a number. When it was text — or absent — the text stays text unless it
 * is unambiguously numeric, which here means it survives a round trip through
 * `Number` unchanged. `06`, `1.50` and `+3` all fail that test and stay
 * strings, which is the conservative direction: a string that should have been
 * a number is visible and fixable, a number that should have been a string has
 * already lost the leading zero.
 */

import { PropertyValueType } from '@ifc-lite/data';

export type CellInput = string | number | boolean;

export interface CoercedCell {
  value: CellInput;
  valueType: PropertyValueType;
}

/** `true`/`false` exactly — not `1`, `yes`, or `TRUE`, which mean other things
 *  in other columns. */
function asBoolean(text: string): boolean | null {
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

/** A number only when the text is exactly how JavaScript would print it. */
function asExactNumber(text: string): number | null {
  if (text.trim() === '') return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return String(parsed) === text ? parsed : null;
}

/** Coerce typed text against the value it replaces. */
export function coerceCellInput(raw: string, previous: unknown): CoercedCell {
  if (typeof previous === 'boolean') {
    const parsed = asBoolean(raw);
    if (parsed !== null) return { value: parsed, valueType: PropertyValueType.Boolean };
    return { value: raw, valueType: PropertyValueType.String };
  }

  if (typeof previous === 'number') {
    // The column is numeric, so a plain `06` is meant as the number 6 here —
    // there is no leading zero to protect in a value that was never text.
    const parsed = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(parsed)) {
      return {
        value: parsed,
        valueType: Number.isInteger(parsed) ? PropertyValueType.Integer : PropertyValueType.Real,
      };
    }
    return { value: raw, valueType: PropertyValueType.String };
  }

  const bool = asBoolean(raw);
  if (bool !== null) return { value: bool, valueType: PropertyValueType.Boolean };

  const num = asExactNumber(raw);
  if (num !== null) {
    return {
      value: num,
      valueType: Number.isInteger(num) ? PropertyValueType.Integer : PropertyValueType.Real,
    };
  }

  return { value: raw, valueType: PropertyValueType.String };
}
