# @ifc-lite/project

Project identity and folder binding for browser applications that work on a set
of models.

```bash
npm install @ifc-lite/project
```

## Why

An application that loads models has no idea when it crossed from one project
into another — and that gap produces a specific, nasty class of bug: state
derived inside one project silently carried into the next. A height above sea
level inherited from a different building is still a plausible number. It just
is not this building's, and nothing about it looks wrong.

This package provides the three things needed to close that gap.

## An opaque project key

```ts
import { createProjectKey, projectKeyFromModels, sameProject } from '@ifc-lite/project';

const key = createProjectKey();          // stored with the folder binding
sameProject(key, previousKey);           // the check every project-scoped slice makes
```

The key is opaque on purpose. Not a path, not a file name, not a project name —
each of those changes while the project stays the same, and two projects can
share any of them.

When nothing has been bound, `projectKeyFromModels(fileNames)` derives one from
the loaded set. Weaker (it cannot recognise the same project tomorrow, and adding
a model changes it) but better than no boundary at all. `isDerivedKey` tells the
two apart so an application can explain the difference.

The rule the key exists to enforce:

> On switching projects, project-scoped state travels with it or is discarded.
> Never silently inherited.

## A durable folder binding

```ts
import { canBindFolder, pickFolder, restoreFolderAccess, writeFileToFolder } from '@ifc-lite/project';

if (canBindFolder()) {
  const folder = await pickFolder();     // null when the person cancels
}
```

**There is no filesystem path, for anybody.** The File System Access API hands
out none — a handle knows its own name and nothing else, deliberately, so a page
cannot learn how the device is laid out. An application that appears to show a
folder path is showing something it made up.

What is achievable, and what this provides, is a binding: the same folder can be
reopened after a restart, recognised, and given a label by the person using it.
That label is the substitute for the path, because two folders called `Planung`
are otherwise indistinguishable.

Bindings persist in IndexedDB, since a handle is structured-clonable and has no
string form for `localStorage`. Permission is **not** durable: after a restart
the browser reports `prompt`, and regaining access needs a real user gesture —
hence `folderPermission()` (ask any time) and `restoreFolderAccess()` (from a
click) are separate.

Requires the File System Access API: Chromium has it, Firefox and Safari do not.
`canBindFolder()` reports which, so an application can offer something else
rather than a button that cannot work.

## Sidecar file names

```ts
import { sidecarFileName } from '@ifc-lite/project';

sidecarFileName('heights');                             // dc.heights.json
sidecarFileName('storeys', { subject: 'ARC-01' });      // dc.storeys.ARC-01.json
```

A project folder holds the drawings, the models and the exports — often several
hundred files. One shared prefix keeps everything a toolchain wrote in a single
block when sorted by name, and makes it obvious which files are derived and
therefore safe to regenerate. The prefix is a parameter; pass `prefix: ''` for
none.

Reading is more forgiving than writing: `isSidecarOf` accepts a file written
before the prefix existed, or by a toolchain using a different one.

## License

MPL-2.0
