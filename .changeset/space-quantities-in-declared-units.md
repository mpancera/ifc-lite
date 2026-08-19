---
"@ifc-lite/create": minor
---

`IfcSpace` quantities are now written in the AREA and VOLUME units the file declares, instead of always in m²/m³. `SpatialAnchor` gains optional `areaUnitScale` and `volumeUnitScale`, which `resolveSpatialAnchor` fills from `IfcUnitAssignment`.

`IfcUnitAssignment` declares LENGTHUNIT, AREAUNIT and VOLUMEUNIT independently, and a quantity is stated in the unit its own measure type declares. The builder honoured that for lengths and assumed SI for areas and volumes, which is right for most metric files and wrong for every imperial one: against a Revit foot export, a 24 m² room was written as `GrossFloorArea = 24` into a file whose area unit is SQUARE FOOT — 2.2 m², as any reader honouring the declaration then showed it. `Pset_SpaceCommon.GrossPlannedArea` / `NetPlannedArea` are `IfcAreaMeasure` and follow the same rule.

Deriving the area scale by squaring the length scale would swap the failure rather than fix it: a metric millimetre export states MILLI.METRE lengths beside plain SQUARE_METRE areas, where the square is wrong by a factor of a million. Both scales default to 1 — the SI unit, which is what IFC means when a project declares neither — so a file without a unit assignment, and any caller that builds a `SpatialAnchor` by hand, keeps the previous behaviour.
