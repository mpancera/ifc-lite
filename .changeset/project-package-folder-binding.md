---
"@ifc-lite/project": minor
---

New package: project identity and folder binding.

Applications that load models have no way to notice when they cross from one project into another, and that gap silently carries derived state across the boundary — a height above sea level inherited from a different building is still a plausible number, just not this building's.

Three pieces close it: an opaque `ProjectKey` (with `projectKeyFromModels` as a weaker fallback when nothing has been bound), a durable `FolderBinding` persisted in IndexedDB, and `sidecarFileName` for naming what gets written next to a project's models.

The folder API is honest about two browser facts: there is no filesystem path to store (a handle knows only its own name), and folder permission does not survive a restart, so checking and restoring are separate calls and only the second needs a user gesture. `canBindFolder()` reports whether the browser has the File System Access API at all.
