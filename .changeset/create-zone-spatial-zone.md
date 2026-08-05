---
"@ifc-lite/create": minor
---

Add in-store builders for `IfcZone` and `IfcSpatialZone`.

The two are deliberately separate, because conflating them is the easy mistake. `addZoneToStore` writes an `IfcZone`: a grouping of spaces with no placement and no representation, which is what a trigger zone in an alarm concept is — it is defined by the rooms it covers, and asking for its volume is a category error. Membership reuses `emitRelAssignsToGroup`, since `IfcZone` is an `IfcSystem` is an `IfcGroup`.

`addSpatialZoneToStore` writes an `IfcSpatialZone`: a real spatial element with a body, built from a rectangle or an arbitrary footprint polygon in the file's native length unit. That is what a fire compartment is, and `IfcSpatialZoneTypeEnum` carries `FIRESAFETY` and `SECURITY` for exactly this.

A spatial zone is **not** aggregated into its storey: compartments routinely span several storeys, so filing one under a single storey would state something false. It is placed relative to the storey and left unaggregated — unlike `addSpaceToStore`, which does aggregate.
