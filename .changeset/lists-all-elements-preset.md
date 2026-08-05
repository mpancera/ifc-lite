---
"@ifc-lite/lists": patch
---

The `All Elements` preset now constrains no class at all.

It used to name twelve classes, so anything outside that list — an `IfcSensor`, an `IfcPipeSegment`, anything a discipline places — was missing from the overview named after covering everything. An empty `entityTypes` is already how the engine expresses "no class constraint", so the preset says what it means and needs no maintenance as classes are added.
