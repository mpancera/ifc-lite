---
'@ifc-lite/create': patch
---

Auto-space generation tells the caller which polygon it actually baked, and can see the rooms of the current session

`generateSpacesFromWalls` now returns `outline` per emitted room — the polygon the `IfcSpace` solid was built at, after the boundary mode was applied. `region.outline` stays on the wall centrelines, so a caller mirroring the new room into a viewer drew it half a wall thickness too large.

`existingSpacesByStorey` takes an optional overlay reader and, with it, also reports rooms authored in the current session. Its footprints are what stops the detector emitting a second room on top of an existing one; without the overlay it only ever saw rooms that had already been exported, so pressing Generate twice — the normal loop when tuning the snap tolerance — laid a complete second set of rooms over the first.
