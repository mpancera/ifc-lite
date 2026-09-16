/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { parseStepRecord, splitStepArguments, stepArgumentValue } from './step-arguments.js';

describe('the distinction this module exists for', () => {
  it('tells a reference from a number that looks identical after extraction', () => {
    // `extractEntity` reads both of these as the number 3. That is what makes
    // a renumbering copy impossible on its output, and why this reads the text.
    const solid = parseStepRecord('#11=IFCEXTRUDEDAREASOLID(#10,#2,$,3.);')!;
    expect(solid.attributes).toEqual(['#10', '#2', null, { real: 3 }]);

    const sphere = parseStepRecord('#12=IFCSPHERE(#2,3.);')!;
    expect(sphere.attributes).toEqual(['#2', { real: 3 }]);
  });

  it('keeps a REAL a REAL, even when it is whole', () => {
    // `3.` written back as `3` is a STEP INTEGER — a type violation in every
    // length slot, and the reason the `{ real }` marker exists.
    expect(stepArgumentValue('3.')).toEqual({ real: 3 });
    expect(stepArgumentValue('0.')).toEqual({ real: 0 });
    expect(stepArgumentValue('1.E-05')).toEqual({ real: 1e-5 });
    expect(stepArgumentValue('-2.5')).toEqual({ real: -2.5 });
    // A genuine integer stays one: dimension counts, ordinals.
    expect(stepArgumentValue('3')).toBe(3);
    expect(stepArgumentValue('-7')).toBe(-7);
  });
});

describe('stepArgumentValue', () => {
  it('reads the simple tokens', () => {
    expect(stepArgumentValue('$')).toBeNull();
    expect(stepArgumentValue('  ')).toBeNull();
    expect(stepArgumentValue('*')).toBe('*');
    expect(stepArgumentValue('#42')).toBe('#42');
    expect(stepArgumentValue('.AREA.')).toBe('.AREA.');
    expect(stepArgumentValue('.t.')).toBe('.T.');
  });

  it('decodes a string, because the exporter re-encodes it', () => {
    // Handing the raw escaped text on would have `escapeStepString` double the
    // backslashes into `\\X2\\00F6\\X0\\`.
    expect(stepArgumentValue("'Handfeuerl\\X2\\00F6\\X0\\scher'")).toBe('Handfeuerlöscher');
    expect(stepArgumentValue("'plain'")).toBe('plain');
  });

  it('resolves STEP’s doubled-quote escape', () => {
    expect(stepArgumentValue("'Marc''s Wand'")).toBe("Marc's Wand");
  });

  it('reads a nested list', () => {
    expect(stepArgumentValue('(#1,#2,#3)')).toEqual(['#1', '#2', '#3']);
    expect(stepArgumentValue('((0.,0.,0.))')).toEqual([[{ real: 0 }, { real: 0 }, { real: 0 }]]);
    expect(stepArgumentValue('()')).toEqual([]);
  });

  it('reads a type-qualified value', () => {
    expect(stepArgumentValue('IFCBOOLEAN(.T.)')).toEqual({
      typed: { type: 'IFCBOOLEAN', value: true },
    });
    expect(stepArgumentValue('IFCLENGTHMEASURE(3.)')).toEqual({
      typed: { type: 'IFCLENGTHMEASURE', value: 3 },
    });
    expect(stepArgumentValue("IFCLABEL('x')")).toEqual({
      typed: { type: 'IFCLABEL', value: 'x' },
    });
  });
});

describe('splitStepArguments', () => {
  it('does not split inside a nested list', () => {
    expect(splitStepArguments('#1,(#2,#3),#4')).toEqual(['#1', '(#2,#3)', '#4']);
  });

  it('does not split inside a string', () => {
    expect(splitStepArguments("#1,'a,b',#2")).toEqual(['#1', "'a,b'", '#2']);
  });

  it('does not end a string at a doubled quote', () => {
    // Get this wrong and every record with an apostrophe in a name splits in
    // the middle of the name.
    expect(splitStepArguments("'Marc''s, Wand',#2")).toEqual(["'Marc''s, Wand'", '#2']);
  });

  it('skips a block comment', () => {
    expect(splitStepArguments('#1,/* Kommentar, mit Komma */#2')).toEqual([
      '#1',
      '/* Kommentar, mit Komma */#2',
    ]);
  });
});

describe('parseStepRecord', () => {
  it('reads a whole record, tolerating the trivia a writer leaves', () => {
    const record = parseStepRecord(
      "#15 = IFCWALL('0wall',#5,'Wand A',$,$,#14,#13,'W1',.STANDARD.);",
    )!;
    expect(record.type).toBe('IFCWALL');
    expect(record.attributes).toEqual([
      '0wall', '#5', 'Wand A', null, null, '#14', '#13', 'W1', '.STANDARD.',
    ]);
  });

  it('reads a record whose arguments span several lines', () => {
    // A writer's line wrap lands anywhere. `.` alone would stop at the first
    // newline, which is the bug the parser's own regex comment records.
    const record = parseStepRecord('#7=IFCPOLYLINE(\n  (#1,\n   #2)\n);')!;
    expect(record.attributes).toEqual([['#1', '#2']]);
  });

  it('returns null for text that is not an entity declaration', () => {
    expect(parseStepRecord('ENDSEC;')).toBeNull();
    expect(parseStepRecord('')).toBeNull();
    expect(parseStepRecord('#15=IFCWALL')).toBeNull();
  });
});
