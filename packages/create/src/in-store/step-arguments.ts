/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Read a STEP record's arguments from its RAW TEXT, in the spelling the
 * overlay writes back.
 *
 * # Why this exists at all
 * `EntityExtractor.extractEntity` loses the one distinction a copy depends on:
 *
 *     IFCEXTRUDEDAREASOLID(#10,#2,$,3.)  ->  [10, 2, null, 3]
 *     IFCSPHERE(#2,3.)                   ->  [2, 3]
 *
 * A reference and a plain number come back as the same JavaScript number. Any
 * code that renumbers references therefore cannot use that output: it would
 * copy an extrusion DEPTH of 3 as a reference to entity #3, silently, into a
 * file that then looks plausible. (The same loss produced the `Representation`
 * defect fixed in `duplicate.ts`.)
 *
 * In the record's own text `#10` and `3.` are still different things, so that
 * is where this reads.
 *
 * # It writes the OVERLAY's spelling, not the parser's
 * The two differ, and the difference is the whole point of this module:
 *
 *   | in the file   | here                        | exported as    |
 *   |---------------|-----------------------------|----------------|
 *   | `#10`         | `'#10'` (string)            | `#10`          |
 *   | `3.`          | `{ real: 3 }`               | `3.`           |
 *   | `3`           | `3`                         | `3`            |
 *   | `'Wand A'`    | `'Wand A'` (decoded text)   | `'Wand A'`     |
 *   | `.AREA.`      | `'.AREA.'`                  | `.AREA.`       |
 *   | `$`           | `null`                      | `$`            |
 *   | `(#1,#2)`     | `['#1','#2']`               | `(#1,#2)`      |
 *   | `IFCBOOLEAN(.T.)` | `{typed:{type,value}}`  | `IFCBOOLEAN(.T.)` |
 *
 * Strings are DECODED (`\X2\00F6\X0\` -> `ö`) because the exporter's
 * `escapeStepString` re-encodes and doubles backslashes — handing it the raw
 * escaped text would corrupt it into `\\X2\\00F6\\X0\\`.
 *
 * # The one thing it cannot round-trip, stated rather than faked
 * A string whose TEXT is `#12` or `.FOO.` — a Name that happens to look like a
 * token. The overlay's own convention has no way to express it:
 * `serializeStepValue` matches those shapes before it reaches the quoting
 * branch, so such a value is written back as a reference or an enum. That is a
 * limitation of the authored-value contract, not of this reader, and it is
 * left visible instead of papered over with quotes that would only produce
 * `'''#12'''`.
 */

import { decodeIfcString } from '@ifc-lite/encoding';
import type { IfcAttributeValue } from '@ifc-lite/mutations';

/** A record read out of the source file. */
export interface StepRecord {
  /** Entity type as the file spells it, e.g. `IFCEXTRUDEDAREASOLID`. */
  type: string;
  attributes: IfcAttributeValue[];
}

/** `#15=IFCWALL(...)` — the id, the type, and where the arguments start. */
const RECORD_HEAD = /^\s*#(\d+)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

/** `TYPE(` at the head of a token: a type-qualified value. */
const TYPED_HEAD = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

const REFERENCE = /^#\d+$/;
const ENUMERATION = /^\.[A-Za-z0-9_]+\.$/;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?$/;

/**
 * Split an argument list at its TOP level.
 *
 * Commas inside a nested list or inside a string are not separators, which is
 * the entire difficulty. STEP escapes a quote by doubling it (`''`), so a
 * closing quote is only closing when the next character is not another quote —
 * get that wrong and every record with an apostrophe in a name splits in the
 * middle of the name.
 *
 * Block comments are skipped: the format allows one between any two tokens,
 * and the parser's own regexes tolerate them for the same reason.
 */
export function splitStepArguments(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (inString) {
      if (ch !== "'") continue;
      if (list[i + 1] === "'") { i++; continue; }
      inString = false;
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === '/' && list[i + 1] === '*') {
      const end = list.indexOf('*/', i + 2);
      i = end === -1 ? list.length : end + 1;
      continue;
    }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (ch === ',' && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  // A genuinely empty list (`()`) is one empty token, not one null argument.
  if (out.length === 1 && out[0].trim() === '') return [];
  return out;
}

/** The inner scalar of a type-qualified value, e.g. `.T.` in `IFCBOOLEAN(.T.)`. */
function typedInner(raw: string): string | number | boolean {
  const token = raw.trim();
  if (token === '.T.') return true;
  if (token === '.F.') return false;
  if (NUMBER.test(token)) return Number(token);
  if (token.startsWith("'") && token.endsWith("'")) return decodeStepString(token);
  return token;
}

/** `'Wand A'` → `Wand A`, with STEP's own escapes resolved. */
function decodeStepString(token: string): string {
  const inner = token.slice(1, -1).replace(/''/g, "'");
  return decodeIfcString(inner);
}

/** One argument token, in the overlay's spelling. */
export function stepArgumentValue(raw: string): IfcAttributeValue {
  const token = raw.trim();
  if (token === '' || token === '$') return null;
  // `*` means "derived in a subtype" and is passed through as its own token;
  // the serializer recognises it.
  if (token === '*') return '*';

  if (token.startsWith('(') && token.endsWith(')')) {
    return splitStepArguments(token.slice(1, -1)).map(stepArgumentValue);
  }
  if (token.startsWith("'") && token.endsWith("'")) return decodeStepString(token);
  if (REFERENCE.test(token)) return token;
  if (ENUMERATION.test(token)) return token.toUpperCase();

  // NUMBER is tested before the typed head so `3.` never looks like a type
  // name, and after the enum test so `.T.` stays an enum rather than becoming
  // the number in `.5`.
  if (NUMBER.test(token)) {
    // A decimal point or an exponent means the file said REAL, and it must
    // stay one: `3.` written back as `3` is an INTEGER, which is a type
    // violation in every length slot.
    return /[.Ee]/.test(token) ? { real: Number(token) } : Number(token);
  }

  const typed = TYPED_HEAD.exec(token);
  if (typed && token.endsWith(')')) {
    return { typed: { type: typed[1], value: typedInner(token.slice(typed[0].length, -1)) } };
  }

  // Something this reader does not know. Kept as its own text rather than
  // dropped — a caller can see what the file contained.
  return token;
}

/**
 * Read one record.
 *
 * Returns `null` for text that is not an entity declaration at all, which a
 * caller should treat as "the source does not have this" rather than as an
 * empty entity.
 */
export function parseStepRecord(text: string): StepRecord | null {
  const head = RECORD_HEAD.exec(text);
  if (!head) return null;
  const open = head[0].length - 1;
  const close = text.lastIndexOf(')');
  if (close <= open) return null;
  return {
    type: head[2].toUpperCase(),
    attributes: splitStepArguments(text.slice(open + 1, close)).map(stepArgumentValue),
  };
}
