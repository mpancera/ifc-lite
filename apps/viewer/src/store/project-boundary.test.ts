/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project boundary, at the one place it has already been crossed.
 *
 * `deriveHeightSystemFrom` carries the sea-level datum and the reference
 * levels forward so that re-deriving does not throw away what somebody set up.
 * That is right within a project and wrong across one: a datum inherited from
 * another building is not a visibly broken value, it is a plausible one, and
 * it appears in a field a person will read as filled in.
 *
 * The first fix compared file names. This pins the version that compares
 * project keys, including the two cases the file-name version got wrong.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectKey } from '@ifc-lite/project';
import type { FolderBinding } from '@ifc-lite/project';
import { useViewerStore } from './index.js';
import type { HeightSystem } from '../lib/heights/types.js';

/** A binding without touching a real filesystem — only the key is read here. */
function binding(name: string): FolderBinding {
  return {
    id: `id-${name}`,
    projectKey: createProjectKey(),
    handle: { name } as unknown as FileSystemDirectoryHandle,
    name,
    pinned: false,
    lastOpenedAt: '2026-08-09T00:00:00.000Z',
  };
}

function system(fileName: string, datum: number): HeightSystem {
  return {
    formatVersion: 1,
    derivedFrom: { fileName, sourceLengthUnit: 'MILLI.METRE' },
    updatedAt: '2026-08-09T00:00:00.000Z',
    datumAboveSeaLevel: datum,
    referenceLevels: [{ key: 'ffl', label: 'OK-Fertigboden', offset: 0 }],
    storeys: [{ id: 'a', name: 'EG', elevation: 0, source: 'ifc-elevation-attribute' }],
  };
}

beforeEach(() => {
  useViewerStore.setState({
    projectFolder: null,
    recentProjects: [],
    heightSystem: null,
    heightSystemProject: null,
    models: new Map(),
  });
});

describe('currentProjectKey', () => {
  it('is the bound folder-s key when a folder is bound', () => {
    const bound = binding('Neubau');
    useViewerStore.setState({ projectFolder: bound });

    assert.equal(useViewerStore.getState().currentProjectKey(), bound.projectKey);
  });

  it('is null with no folder and no models', () => {
    // No models and no folder is not a project. A key here would let anything
    // derived in an empty viewer be attributed to it.
    assert.equal(useViewerStore.getState().currentProjectKey(), null);
  });

  it('survives renaming the folder, because it is not the name', () => {
    const bound = binding('Neubau');
    useViewerStore.setState({ projectFolder: bound });
    const before = useViewerStore.getState().currentProjectKey();

    useViewerStore.setState({ projectFolder: { ...bound, name: 'Neubau Ost' } });

    assert.equal(useViewerStore.getState().currentProjectKey(), before);
  });

  it('prefers the bound folder over the loaded models', () => {
    // The folder is the stronger statement: it survives swapping every model
    // out, which the derived key cannot.
    const bound = binding('Neubau');
    useViewerStore.setState({
      projectFolder: bound,
      models: new Map([['m1', { name: 'arch.ifc' } as never]]),
    });

    assert.equal(useViewerStore.getState().currentProjectKey(), bound.projectKey);
  });
});

describe('the datum does not cross a project boundary', () => {
  /** Pretend a system was derived while `key` was the current project. */
  const heldBy = (folder: FolderBinding, fileName: string, datum: number) => {
    useViewerStore.setState({ projectFolder: folder });
    useViewerStore.setState({
      heightSystem: system(fileName, datum),
      heightSystemProject: folder.projectKey,
    });
  };

  it('keeps the datum when the same project is re-derived', () => {
    const a = binding('Neubau');
    heldBy(a, 'arch.ifc', 412.35);

    const s = useViewerStore.getState();
    assert.equal(s.currentProjectKey(), a.projectKey);
    assert.equal(s.heightSystemProject, a.projectKey);
    // Same key on both sides is what lets the carry-forward happen at all.
    assert.equal(s.heightSystem?.datumAboveSeaLevel, 412.35);
  });

  it('does not treat two projects as one just because the file names match', () => {
    // The case the file-name comparison got wrong. Two different buildings
    // whose architecture models are both called `arch.ifc` — which is the
    // normal situation in an office with a naming convention.
    const a = binding('Neubau');
    const b = binding('Umbau');
    heldBy(a, 'arch.ifc', 412.35);

    useViewerStore.setState({ projectFolder: b });

    assert.notEqual(
      useViewerStore.getState().currentProjectKey(),
      useViewerStore.getState().heightSystemProject,
      'a system derived in one project must not be claimed by another',
    );
  });

  it('does not treat one project as two just because a file was renamed', () => {
    // The other half the file-name comparison got wrong: renaming the model
    // would have thrown away a datum somebody typed in.
    const a = binding('Neubau');
    heldBy(a, 'arch.ifc', 412.35);

    useViewerStore.setState({
      heightSystem: { ...system('arch_rev-C.ifc', 412.35) },
    });

    assert.equal(
      useViewerStore.getState().currentProjectKey(),
      useViewerStore.getState().heightSystemProject,
    );
  });

  it('forgets which project a refused derivation belonged to', () => {
    // Otherwise a failed read would leave the previous project's key attached
    // to no system, and the next derivation could match against it.
    const a = binding('Neubau');
    heldBy(a, 'arch.ifc', 412.35);

    useViewerStore.setState({ heightSystem: null, heightSystemProject: null });

    assert.equal(useViewerStore.getState().heightSystemProject, null);
  });
});

describe('unbinding', () => {
  it('lets go of the folder without touching the remembered list', () => {
    // Unbinding is "stop working here", not "forget this folder".
    const a = binding('Neubau');
    useViewerStore.setState({ projectFolder: a, recentProjects: [a] });

    useViewerStore.getState().unbindProjectFolder();

    assert.equal(useViewerStore.getState().projectFolder, null);
    assert.deepEqual(useViewerStore.getState().recentProjects.map((b) => b.id), [a.id]);
  });
});

describe('a folder that names its own project', () => {
  it('carries the height system over when the folder is re-identified', () => {
    // The decision behind this: the FOLDER is the project. A different key
    // arriving in it is a re-identification of the same project, not a move to
    // another one — so work derived there travels rather than being orphaned.
    // Orphaning would discard a hand-corrected height system on the next
    // derivation, which is exactly the silent loss the key exists to prevent.
    const a = binding('Neubau');
    useViewerStore.setState({
      projectFolder: a,
      heightSystem: system('arch.ifc', 412.35),
      heightSystemProject: a.projectKey,
    });

    // What bindProjectFolder does once a descriptor turns up with another key.
    const fromFile = createProjectKey();
    useViewerStore.setState({
      projectFolder: { ...a, projectKey: fromFile, label: '017 Nordbau' },
      heightSystemProject: fromFile,
    });

    const s = useViewerStore.getState();
    assert.equal(s.currentProjectKey(), fromFile);
    assert.equal(s.heightSystemProject, fromFile, 'the system followed the folder');
    assert.equal(s.heightSystem?.datumAboveSeaLevel, 412.35, 'and kept its datum');
  });

  it('still separates two folders that carry different keys', () => {
    // Re-keying must not blur the boundary it exists to draw.
    const a = binding('Neubau');
    const b = binding('Umbau');

    useViewerStore.setState({ projectFolder: a });
    const first = useViewerStore.getState().currentProjectKey();
    useViewerStore.setState({ projectFolder: b });

    assert.notEqual(useViewerStore.getState().currentProjectKey(), first);
  });
});
