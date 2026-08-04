/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PropertyValueType } from '@ifc-lite/data';
import { coerceCellInput } from './coerceCellInput.js';

describe('coerceCellInput · protecting text that looks numeric', () => {
  it('keeps a leading-zero room number as text', () => {
    // The failure this exists to prevent: room "06" silently becoming room 6.
    const result = coerceCellInput('06', null);
    assert.equal(result.value, '06');
    assert.equal(result.valueType, PropertyValueType.String);
  });

  it('keeps a trailing-zero decimal as text', () => {
    assert.equal(coerceCellInput('1.50', null).value, '1.50');
  });

  it('keeps a signed form JavaScript would print differently', () => {
    assert.equal(coerceCellInput('+3', null).value, '+3');
  });

  it('reads an unambiguous integer as a number', () => {
    const result = coerceCellInput('42', null);
    assert.equal(result.value, 42);
    assert.equal(result.valueType, PropertyValueType.Integer);
  });

  it('reads an unambiguous decimal as a real', () => {
    const result = coerceCellInput('1.5', '');
    assert.equal(result.value, 1.5);
    assert.equal(result.valueType, PropertyValueType.Real);
  });
});

describe('coerceCellInput · following the previous type', () => {
  it('reads a leading zero as a number when the property already was one', () => {
    // Nothing is lost: a value that was never text has no leading zero to keep.
    const result = coerceCellInput('06', 12);
    assert.equal(result.value, 6);
    assert.equal(result.valueType, PropertyValueType.Integer);
  });

  it('falls back to text when a numeric property is given words', () => {
    const result = coerceCellInput('n/a', 12);
    assert.equal(result.value, 'n/a');
    assert.equal(result.valueType, PropertyValueType.String);
  });

  it('keeps a boolean property boolean', () => {
    const result = coerceCellInput('false', true);
    assert.equal(result.value, false);
    assert.equal(result.valueType, PropertyValueType.Boolean);
  });

  it('falls back to text when a boolean property is given something else', () => {
    const result = coerceCellInput('yes', true);
    assert.equal(result.value, 'yes');
    assert.equal(result.valueType, PropertyValueType.String);
  });

  it('reads true/false into a fresh cell', () => {
    assert.equal(coerceCellInput('true', null).value, true);
    assert.equal(coerceCellInput('false', null).value, false);
  });

  it('does not treat 1 or TRUE as boolean', () => {
    // They mean other things in other columns; only the exact words commit.
    assert.equal(coerceCellInput('1', null).value, 1);
    assert.equal(coerceCellInput('TRUE', null).value, 'TRUE');
  });
});

describe('coerceCellInput · emptiness', () => {
  it('keeps an emptied cell as an empty string rather than zero', () => {
    for (const previous of [null, 'text', 12, true]) {
      const result = coerceCellInput('', previous);
      assert.equal(result.value, '', `previous ${String(previous)}`);
      assert.equal(result.valueType, PropertyValueType.String);
    }
  });

  it('keeps whitespace as written', () => {
    assert.equal(coerceCellInput('  ', null).value, '  ');
  });
});
