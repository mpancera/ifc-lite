/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { createProjectKey, isValidProjectKey, projectKeyFromModels } from './key.js';
import { parseProjectDescriptor, projectDisplayName } from './descriptor.js';

const KEY = 'proj_0123456789abcdef0123456789abcdef';

describe('isValidProjectKey', () => {
  it('accepts a key this application would have made', () => {
    expect(isValidProjectKey(createProjectKey())).toBe(true);
    expect(isValidProjectKey(KEY)).toBe(true);
  });

  it('rejects a DERIVED key', () => {
    // The derived prefix is how the viewer tells somebody its boundary is the
    // weaker, model-derived kind. A stored key wearing it would explain a
    // guarantee it does not have.
    expect(isValidProjectKey(projectKeyFromModels(['a.ifc']))).toBe(false);
  });

  it('rejects what is not a string', () => {
    for (const bad of [null, undefined, 42, {}, ['a'], true]) {
      expect(isValidProjectKey(bad)).toBe(false);
    }
  });

  it('rejects the too short and the far too long', () => {
    // Short collides by accident; long is a payload, not an identifier.
    expect(isValidProjectKey('proj_1')).toBe(false);
    expect(isValidProjectKey(`proj_${'a'.repeat(200)}`)).toBe(false);
  });

  it('rejects whitespace and control characters', () => {
    // This value ends up in a comparison, a dialog and a file check, and none
    // of those want a newline in the middle.
    expect(isValidProjectKey('proj_abc def')).toBe(false);
    expect(isValidProjectKey('proj_abc\ndef')).toBe(false);
    expect(isValidProjectKey('  proj_abcdefgh  ')).toBe(false);
  });
});

describe('parseProjectDescriptor', () => {
  it('reads a descriptor the document layer would write', () => {
    expect(parseProjectDescriptor({
      formatVersion: 1, key: KEY, name: 'Nordbau', number: '017',
      createdAt: '2026-08-10T14:07:09.412Z',
    })).toEqual({ key: KEY, name: 'Nordbau', number: '017' });
  });

  it('ignores fields it does not know', () => {
    // The file belongs to the other application; growing a field there must
    // not break reading it here.
    expect(parseProjectDescriptor({ key: KEY, somethingNew: { a: 1 } })).toEqual({ key: KEY });
  });

  it('refuses a descriptor whose key cannot be trusted', () => {
    // Taking the name while rejecting the identity would label a project after
    // a file it then refused to believe.
    for (const bad of [{}, { key: '' }, { key: 42 }, { name: 'Nordbau' },
      { key: projectKeyFromModels(['a.ifc']) }]) {
      expect(parseProjectDescriptor(bad)).toBeNull();
    }
  });

  it('drops a blank name rather than keeping an empty one', () => {
    const d = parseProjectDescriptor({ key: KEY, name: '   ', number: '' });

    expect('name' in d!).toBe(false);
    expect('number' in d!).toBe(false);
  });

  it('trims what it keeps', () => {
    expect(parseProjectDescriptor({ key: KEY, name: ' Nordbau ' })?.name).toBe('Nordbau');
  });

  it('refuses anything that is not an object', () => {
    for (const bad of [null, 'proj_x', 42, [KEY]]) {
      expect(parseProjectDescriptor(bad)).toBeNull();
    }
  });
});

describe('projectDisplayName', () => {
  it('shows number and name together', () => {
    // A folder with five projects is a list: the number sorts, the name is
    // recognised. Dropping either makes one of those harder.
    expect(projectDisplayName({ key: KEY as never, name: 'Nordbau', number: '017' }))
      .toBe('017 Nordbau');
  });

  it('copes with only one of the two', () => {
    expect(projectDisplayName({ key: KEY as never, name: 'Nordbau' })).toBe('Nordbau');
    expect(projectDisplayName({ key: KEY as never, number: '017' })).toBe('017');
  });

  it('is null when the descriptor says nothing displayable', () => {
    // So the caller keeps the folder name rather than showing a blank label.
    expect(projectDisplayName({ key: KEY as never })).toBeNull();
  });
});
