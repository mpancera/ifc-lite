---
"@ifc-lite/drawing-2d": minor
---

Add `storeyFloorLevelsFromMeshes`, the per-storey form of the mesh-derived floor levels that `storeyFloorsFromMeshes` already computed and then discarded the ids from. A consumer that has to cut a NAMED storey (a floor plan cut at a stated height above its floor) needs to know which level belongs to which storey, and deriving that separately would let it drift from the level the projection bands use — the two would then disagree about where a floor is on any model whose `IfcBuildingStorey.Elevation` differs from its geometry, which is every georeferenced one. `storeyFloorsFromMeshes` is now the sorted view of the same map and is unchanged in behaviour.
