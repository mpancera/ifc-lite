---
"@ifc-lite/data": minor
"@ifc-lite/cache": minor
---

Extend `IfcTypeEnum` with a curated IFC4.3 class catalogue (131 new members, ids 321+).

Classes outside the originally hand-picked set — `IfcSensor`, `IfcAlarm`, `IfcAudioVisualAppliance`, the wider MEP/distribution family, the IFC4.3 infrastructure classes and the abstract supertypes — collapsed into `IfcTypeEnum.Unknown`. Two consequences followed from that: `EntityTable.getByType` could not target them at all (so a class-scoped list or query silently returned nothing), and `getTypeName` fell back to the raw uppercase STEP keyword, surfacing `IFCSENSOR` instead of `IfcSensor` in the UI. Both are fixed by giving each class a distinct member.

The change is additive: existing members keep their values, so nothing is renumbered. `@ifc-lite/cache` bumps `FORMAT_VERSION` 13 → 14 because the byte layout is unchanged but the meaning of stored `typeEnum` values shifted — a v13 writer stored these classes as `Unknown`, so restoring a v13 cache would leave those entities unreachable by class. The bump invalidates pre-catalogue caches so they re-parse.
