/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import {
  createProjectKey, isDerivedKey, projectKeyFromModels, sameProject,
} from './key.js';

describe('createProjectKey', () => {
  it('does not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, createProjectKey));

    expect(keys.size).toBe(200);
  });

  it('is not a derived key', () => {
    expect(isDerivedKey(createProjectKey())).toBe(false);
  });
});

describe('projectKeyFromModels', () => {
  it('gives the same key for the same models in a different order', () => {
    // Federating A then B is the same project as B then A. If it were not,
    // every reordering would read as a project change and discard the work.
    expect(projectKeyFromModels(['arc.ifc', 'mep.ifc']))
      .toBe(projectKeyFromModels(['mep.ifc', 'arc.ifc']));
  });

  it('gives a different key for a different set', () => {
    expect(projectKeyFromModels(['arc.ifc'])).not.toBe(projectKeyFromModels(['museum.ifc']));
  });

  it('ignores duplicates and blank entries', () => {
    expect(projectKeyFromModels(['arc.ifc', 'arc.ifc', '  ', '']))
      .toBe(projectKeyFromModels(['arc.ifc']));
  });

  it('returns null for no models', () => {
    // No models is not a project. A key here would let everything derived in
    // an empty viewer be attributed to it.
    expect(projectKeyFromModels([])).toBeNull();
    expect(projectKeyFromModels(['', '   '])).toBeNull();
  });

  it('marks itself as derived, so the weaker guarantee can be explained', () => {
    expect(isDerivedKey(projectKeyFromModels(['arc.ifc'])!)).toBe(true);
  });
});

describe('sameProject', () => {
  it('matches a key with itself', () => {
    const key = createProjectKey();

    expect(sameProject(key, key)).toBe(true);
  });

  it('separates two keys', () => {
    expect(sameProject(createProjectKey(), createProjectKey())).toBe(false);
  });

  it('does not treat two unknown projects as the same one', () => {
    // The whole point. If null matched null, a viewer that has not been told
    // which project it is in would inherit everything from the last one —
    // which is the bug this module exists to prevent.
    expect(sameProject(null, null)).toBe(false);
    expect(sameProject(createProjectKey(), null)).toBe(false);
  });
});
