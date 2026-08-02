---
"@ifc-lite/create": minor
---

Add `IfcDistributionSystem` builders so authored elements can be grouped into the installation they belong to.

- `addDistributionSystemToStore` creates the system (IfcRoot header + ObjectType + LongName + PredefinedType).
- `emitRelAssignsToGroup` assigns elements to it. Grouping is independent of spatial containment, so an element keeps the storey placement its element builder emitted.
- `findDistributionSystem` matches an already-authored system by PredefinedType **and** ObjectType, so one system is reused across placements instead of one per element. Both parts of the key matter: several distinct installations share a single `IfcDistributionSystemEnum` value (all fire systems are `FIREPROTECTION`), and only `ObjectType` tells them apart.
