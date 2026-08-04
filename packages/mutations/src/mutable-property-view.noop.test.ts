/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A write that changes nothing must not become history.
 *
 * Without this, any caller re-asserting a derived value on a timer grows the
 * mutation log without bound. That is not hypothetical: a rule keeping an
 * identifier current wrote the same "1" half a million times, and the autosave
 * snapshot carrying that journal eventually broke IndexedDB outright.
 */

import { describe, it, expect } from 'vitest';
import { PropertyValueType } from '@ifc-lite/data';
import { MutablePropertyView } from './mutable-property-view.js';

function view(): MutablePropertyView {
  return new MutablePropertyView(null, 'm1');
}

describe('MutablePropertyView.setProperty — no-op writes', () => {
  it('records the first write', () => {
    const v = view();
    v.setProperty(1, 'Pset_X', 'Tag', '1');

    expect(v.getMutations()).toHaveLength(1);
  });

  it('does not record re-writing the identical value', () => {
    const v = view();
    v.setProperty(1, 'Pset_X', 'Tag', '1');
    v.setProperty(1, 'Pset_X', 'Tag', '1');
    v.setProperty(1, 'Pset_X', 'Tag', '1');

    expect(v.getMutations()).toHaveLength(1);
  });

  it('still returns a mutation, so callers reading it as success keep working', () => {
    const v = view();
    v.setProperty(1, 'Pset_X', 'Tag', '1');
    const again = v.setProperty(1, 'Pset_X', 'Tag', '1');

    expect(again).toBeTruthy();
    expect(again.newValue).toBe('1');
  });

  it('records a genuine change', () => {
    const v = view();
    v.setProperty(1, 'Pset_X', 'Tag', '1');
    v.setProperty(1, 'Pset_X', 'Tag', '2');

    expect(v.getMutations()).toHaveLength(2);
    expect(v.getPropertyValue(1, 'Pset_X', 'Tag')).toBe('2');
  });

  it('records a change back to a previous value', () => {
    // Undo-by-retyping is a real edit; only "same as it is right now" is a
    // no-op.
    const v = view();
    v.setProperty(1, 'Pset_X', 'Tag', '1');
    v.setProperty(1, 'Pset_X', 'Tag', '2');
    v.setProperty(1, 'Pset_X', 'Tag', '1');

    expect(v.getMutations()).toHaveLength(3);
  });

  it('records a re-type of the same value', () => {
    // "1" as a string and 1 as an integer are different states in the export.
    const v = view();
    v.setProperty(1, 'Pset_X', 'N', 1, PropertyValueType.Integer);
    v.setProperty(1, 'Pset_X', 'N', 1, PropertyValueType.Real);

    expect(v.getMutations()).toHaveLength(2);
  });

  it('records a unit change on the same value', () => {
    const v = view();
    v.setProperty(1, 'Pset_X', 'L', 5, PropertyValueType.Real, 'mm');
    v.setProperty(1, 'Pset_X', 'L', 5, PropertyValueType.Real, 'm');

    expect(v.getMutations()).toHaveLength(2);
  });

  it('keeps the value readable after a skipped no-op', () => {
    // The stores are updated either way — only the journal entry is skipped.
    const v = view();
    v.setProperty(1, 'Pset_X', 'Tag', 'A');
    v.setProperty(1, 'Pset_X', 'Tag', 'A');

    expect(v.getPropertyValue(1, 'Pset_X', 'Tag')).toBe('A');
    const sets = v.getForEntity(1);
    expect(sets.find((s) => s.name === 'Pset_X')?.properties[0].value).toBe('A');
  });

  it('treats setting the same value on different entities as separate writes', () => {
    const v = view();
    v.setProperty(1, 'Pset_X', 'Tag', '1');
    v.setProperty(2, 'Pset_X', 'Tag', '1');

    expect(v.getMutations()).toHaveLength(2);
  });
});
