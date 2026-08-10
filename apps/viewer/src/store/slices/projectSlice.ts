/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which project the viewer is working in.
 *
 * The viewer used to have no answer to that question, and everything derived —
 * the height system, zones, lists — belonged to "the current session". A model
 * switch crossed a project boundary in silence, so state derived in one
 * project could be inherited by the next. That is how the height datum of one
 * building ended up available to another: not a visibly broken value, a
 * plausible one.
 *
 * Binding a folder is the strong form: the key is stored with the folder, so
 * reopening it tomorrow gives back the same project. Without a binding the key
 * is derived from the loaded models — weaker, but a boundary all the same, and
 * the viewer has to keep working for somebody who just drops a file in and
 * never hears the word project.
 *
 * The rules live in `@ifc-lite/project` (pure, and shared with anything else
 * that needs them). This slice is the part that needs the store.
 */

import { type StateCreator } from 'zustand';
import {
  canBindFolder, createProjectKey, findBindingForHandle, forgetBinding,
  loadBindings, pickFolder, projectKeyFromModels, rememberBinding, restoreFolderAccess,
  projectDisplayName, readProjectDescriptorResult, saveBindings, updateBinding,
  type FolderBinding, type FolderPermission, type ProjectKey,
} from '@ifc-lite/project';
import type { ViewerState } from '../index.js';

export interface ProjectSlice {
  /**
   * The bound folder, or `null` when none is bound.
   *
   * Holding the live handle: it cannot be reconstructed from anything
   * serialisable, because there is no path to reconstruct it from.
   */
  projectFolder: FolderBinding | null;
  /** Remembered folders, newest first. Loaded once on demand. */
  recentProjects: FolderBinding[];
  /** Whether the browser can bind a folder at all. */
  canBindProjectFolder: boolean;
  /** Set when a folder was remembered but access has to be asked for again. */
  projectFolderPermission: FolderPermission | null;
  projectError: string | null;

  /**
   * The project the viewer is in, or `null` when nothing is loaded.
   *
   * Read through `currentProjectKey()` rather than stored twice: a bound
   * folder wins, otherwise the loaded models decide. Deriving it keeps the two
   * from disagreeing.
   */
  currentProjectKey: () => ProjectKey | null;

  loadRecentProjects: () => Promise<void>;
  /** Choose a folder. Must be called from a user gesture. */
  bindProjectFolder: () => Promise<boolean>;
  /** Reopen a remembered folder. Must be called from a user gesture, because
   *  the permission may have to be requested again. */
  openRecentProject: (id: string) => Promise<boolean>;
  unbindProjectFolder: () => void;
  forgetRecentProject: (id: string) => Promise<void>;
  /** The stand-in for the folder path that no browser exposes. */
  labelProject: (id: string, label: string) => Promise<void>;
  pinProject: (id: string, pinned: boolean) => Promise<void>;
}

export const createProjectSlice: StateCreator<ViewerState, [], [], ProjectSlice> = (set, get) => {
  /** Persist the list and keep the bound folder in step with it. */
  const persist = async (bindings: FolderBinding[]) => {
    set({ recentProjects: bindings });
    const bound = get().projectFolder;
    if (bound) {
      const updated = bindings.find((b) => b.id === bound.id);
      set({ projectFolder: updated ?? null });
    }
    await saveBindings(bindings);
  };

  /** Adopt a folder as the current project. */
  const adopt = async (binding: FolderBinding) => {
    const list = rememberBinding(get().recentProjects, {
      ...binding, lastOpenedAt: new Date().toISOString(),
    });
    set({ projectFolder: list.find((b) => b.id === binding.id) ?? binding, projectError: null });
    await persist(list);
  };

  return {
    projectFolder: null,
    recentProjects: [],
    canBindProjectFolder: canBindFolder(),
    projectFolderPermission: null,
    projectError: null,

    currentProjectKey: () => {
      const bound = get().projectFolder;
      if (bound) return bound.projectKey;
      // No binding: fall back to the loaded set. `model.name` is the file name.
      return projectKeyFromModels([...get().models.values()].map((m) => m.name));
    },

    loadRecentProjects: async () => {
      try {
        set({ recentProjects: await loadBindings() });
      } catch (err) {
        set({ projectError: `Gemerkte Ordner nicht lesbar: ${(err as Error).message}` });
      }
    },

    bindProjectFolder: async () => {
      try {
        const handle = await pickFolder({ mode: 'readwrite', id: 'ifc-lite-project' });
        if (!handle) return false; // cancelled — an answer, not a failure

        // Re-picking a folder already known must not create a second project
        // for it. Handles to one folder are different objects, so identity
        // fails and the name is not unique; isSameEntry is the only test.
        const known = await findBindingForHandle(get().recentProjects, handle);

        // The folder is the one thing both applications hold, so it is where
        // they agree on what the project IS — no messages, no service, and it
        // still works when only one of them is running.
        const { descriptor, malformed } = await readProjectDescriptorResult(handle);
        if (malformed) {
          set({
            projectError: 'Die Projektdatei in diesem Ordner ist unlesbar — der Ordner '
              + 'bekommt einen eigenen Schlüssel.',
          });
        }

        const label = descriptor ? projectDisplayName(descriptor) : null;

        if (known) {
          // The descriptor wins over the stored key — but the binding is
          // REKEYED rather than replaced, so everything derived in this folder
          // travels with it. A changed key in the folder is a re-identification
          // of the same project, not a move to a different one, and orphaning
          // a height system somebody corrected by hand would be exactly the
          // silent loss this whole concept exists to prevent.
          if (descriptor && descriptor.key !== known.projectKey) {
            rekeyProjectState(get, set, known.projectKey, descriptor.key);
          }
          await adopt({
            ...known,
            ...(descriptor ? { projectKey: descriptor.key } : {}),
            ...(label ? { label } : {}),
          });
        } else {
          await adopt({
            id: crypto.randomUUID(),
            projectKey: descriptor?.key ?? createProjectKey(),
            handle,
            name: handle.name,
            ...(label ? { label } : {}),
            pinned: false,
            lastOpenedAt: new Date().toISOString(),
          });
        }
        set({ projectFolderPermission: 'granted' });
        return true;
      } catch (err) {
        set({ projectError: `Ordner konnte nicht geöffnet werden: ${(err as Error).message}` });
        return false;
      }
    },

    openRecentProject: async (id) => {
      const binding = get().recentProjects.find((b) => b.id === id);
      if (!binding) return false;

      try {
        // From a gesture, so this may prompt. A remembered handle does not
        // carry a standing right to read.
        const permission = await restoreFolderAccess(binding.handle);
        set({ projectFolderPermission: permission });
        if (permission !== 'granted') {
          set({ projectError: 'Der Zugriff auf diesen Ordner wurde nicht erteilt.' });
          return false;
        }
        // Re-read on every open, not only when the folder is first picked:
        // reopening a remembered folder is the everyday path, and the folder
        // may have become a managed project since it was last used here.
        const { descriptor } = await readProjectDescriptorResult(binding.handle);
        if (descriptor && descriptor.key !== binding.projectKey) {
          rekeyProjectState(get, set, binding.projectKey, descriptor.key);
        }
        const label = descriptor ? projectDisplayName(descriptor) : null;

        await adopt({
          ...binding,
          ...(descriptor ? { projectKey: descriptor.key } : {}),
          ...(label ? { label } : {}),
        });
        return true;
      } catch (err) {
        set({ projectError: `Ordner nicht erreichbar: ${(err as Error).message}` });
        return false;
      }
    },

    // Only lets go of the binding. The folder and its files stay untouched,
    // and the entry stays in the remembered list.
    unbindProjectFolder: () => set({ projectFolder: null, projectFolderPermission: null }),

    forgetRecentProject: async (id) => {
      const list = forgetBinding(get().recentProjects, id);
      if (get().projectFolder?.id === id) set({ projectFolder: null });
      await persist(list);
    },

    labelProject: async (id, label) => {
      await persist(updateBinding(get().recentProjects, id, { label: label.trim() || undefined }));
    },

    pinProject: async (id, pinned) => {
      await persist(updateBinding(get().recentProjects, id, { pinned }));
    },
  };
};

/**
 * Move everything hanging off one project key onto another.
 *
 * Called when a bound folder turns out to carry a different key than the one
 * this viewer issued it — the folder is the project, so a changed key there is
 * a re-identification, not a different building.
 *
 * **Every project-scoped slice must be listed here.** One that is not simply
 * stops matching after a rekey and gets discarded on the next derivation,
 * which looks exactly like the silent loss the project key exists to prevent.
 * Today that is the height system; zones, compartments, lenses, saved lists
 * and the autosave still have to join (#46).
 */
function rekeyProjectState(
  get: () => ViewerState,
  set: (partial: Partial<ViewerState>) => void,
  from: ProjectKey,
  to: ProjectKey,
): void {
  if (get().heightSystemProject === from) set({ heightSystemProject: to });
}
