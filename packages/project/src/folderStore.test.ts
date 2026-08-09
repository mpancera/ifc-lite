/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import {
  evictUnpinned, findBindingForHandle, forgetBinding, rememberBinding, updateBinding,
  MAX_UNPINNED,
} from './folderStore.js';
import { createProjectKey } from './key.js';
import type { FolderBinding } from './folder.js';

/** A handle stands in for a folder; `isSameEntry` is the only real comparison. */
function handle(folder: string): FileSystemDirectoryHandle {
  return {
    name: folder,
    isSameEntry: async (other: FileSystemHandle) => other.name === folder,
  } as unknown as FileSystemDirectoryHandle;
}

function binding(id: string, over: Partial<FolderBinding> = {}): FolderBinding {
  return {
    id,
    projectKey: createProjectKey(),
    handle: handle(id),
    name: id,
    pinned: false,
    lastOpenedAt: '2026-08-09T00:00:00.000Z',
    ...over,
  };
}

describe('rememberBinding', () => {
  it('puts the folder at the front', () => {
    const list = rememberBinding([binding('a'), binding('b')], binding('c'));

    expect(list.map((b) => b.id)).toEqual(['c', 'a', 'b']);
  });

  it('moves an existing folder to the front instead of duplicating it', () => {
    const list = rememberBinding([binding('a'), binding('b')], binding('b'));

    expect(list.map((b) => b.id)).toEqual(['b', 'a']);
  });

  it('keeps the project key of the entry being remembered', () => {
    // Reopening a folder must hand back ITS project, not the one that
    // happened to be open a moment ago.
    const reopened = binding('b');
    const list = rememberBinding([binding('b')], reopened);

    expect(list[0].projectKey).toBe(reopened.projectKey);
  });
});

describe('evictUnpinned', () => {
  it(`keeps ${MAX_UNPINNED} unpinned entries`, () => {
    const many = Array.from({ length: MAX_UNPINNED + 5 }, (_, i) => binding(`f${i}`));

    expect(evictUnpinned(many)).toHaveLength(MAX_UNPINNED);
  });

  it('keeps every pinned entry however old', () => {
    // That is what pinning means; evicting one would make the control a lie.
    const pinned = Array.from({ length: 20 }, (_, i) => binding(`p${i}`, { pinned: true }));

    expect(evictUnpinned(pinned)).toHaveLength(20);
  });

  it('drops the oldest unpinned first', () => {
    const list = [
      ...Array.from({ length: MAX_UNPINNED }, (_, i) => binding(`new${i}`)),
      binding('oldest'),
    ];

    expect(evictUnpinned(list).some((b) => b.id === 'oldest')).toBe(false);
  });
});

describe('updateBinding', () => {
  it('applies a label without reordering the list', () => {
    // The label is the substitute for the path that does not exist; renaming
    // one must not shuffle what the person is looking at.
    const list = updateBinding([binding('a'), binding('b')], 'b', { label: 'Neubau Ost' });

    expect(list.map((b) => b.id)).toEqual(['a', 'b']);
    expect(list[1].label).toBe('Neubau Ost');
  });

  it('leaves other entries alone', () => {
    const list = updateBinding([binding('a'), binding('b')], 'b', { pinned: true });

    expect(list[0].pinned).toBe(false);
  });
});

describe('forgetBinding', () => {
  it('removes just that one', () => {
    expect(forgetBinding([binding('a'), binding('b')], 'a').map((b) => b.id)).toEqual(['b']);
  });
});

describe('findBindingForHandle', () => {
  it('matches through isSameEntry, not by name', async () => {
    // Two handles to one folder are different objects, so identity fails;
    // and two different folders can share a name, so the name fails.
    const list = [binding('planung'), binding('modelle')];

    expect((await findBindingForHandle(list, handle('modelle')))?.id).toBe('modelle');
  });

  it('reports nothing for a folder that was never bound', async () => {
    expect(await findBindingForHandle([binding('a')], handle('other'))).toBeUndefined();
  });
});
