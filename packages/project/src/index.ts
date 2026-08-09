/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Project identity and folder binding.
 *
 * Three things an application needs before it can honestly say which project
 * it is working in:
 *
 * - an opaque {@link ProjectKey}, so a project change is DETECTABLE;
 * - a {@link FolderBinding}, so the folder can be reopened tomorrow;
 * - {@link sidecarFileName}, so what gets written into that folder is findable
 *   by somebody who did not write it.
 *
 * The rule the key exists to enforce: **on switching projects, project-scoped
 * state travels with it or is discarded — never silently inherited.**
 * Inheriting is what produces plausible wrong numbers.
 */

export {
  createProjectKey, isDerivedKey, projectKeyFromModels, sameProject, type ProjectKey,
} from './key.js';

export {
  canBindFolder, folderDisplayName, folderHasFile, folderPermission, pickFolder,
  restoreFolderAccess, writeFileToFolder,
  type FolderBinding, type FolderPermission,
} from './folder.js';

export {
  evictUnpinned, findBindingForHandle, forgetBinding, loadBindings, rememberBinding,
  saveBindings, updateBinding, MAX_UNPINNED,
} from './folderStore.js';

export {
  isSidecarOf, sidecarFileName, DEFAULT_SIDECAR_PREFIX,
  type SidecarKind, type SidecarNameOptions,
} from './sidecar.js';
