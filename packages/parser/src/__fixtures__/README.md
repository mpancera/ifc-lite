# Minimal STEP fixtures

Hand-written IFC files, a few hundred bytes each, that pin the unit and
elevation cases that are otherwise only reachable by loading a real project in
a browser.

They exist because every verification of the unit handling used to depend on
which file somebody happened to have open. The centimetre case went unchecked
for two rounds that way, and the mixed-unit case was never checked at all.

| File | What it pins |
| --- | --- |
| `millimetre.ifc` | The everyday case: `MILLI.METRE` with unprefixed `SQUARE_METRE`. |
| `centimetre.ifc` | Elevations `0 / 240 / 609.6`, which are `0 / 2.4 / 6.096` m. Read naively it is a 609 m building. |
| `centimetre-square-foot.ifc` | The half-converted imperial template: centimetre length, **square foot** area. Valid IFC, and wrong. |
| `no-units.ifc` | No `IfcUnitAssignment` at all. Legal — `UnitsInContext` is OPTIONAL — and unreadable at any scale. |
| `null-elevation.ifc` | A storey whose `Elevation` is `$`, so the height has to come from the placement. |
| `foot.ifc` | `IfcConversionBasedUnit` FOOT — the imperial path through the extractors. |

Everything in them is synthetic: no project data, and no geometry beyond what a
storey needs to have a placement. What is being tested is the header and the
spatial structure.

Each file keeps the same skeleton — project, site, building, storeys, two
`IfcRelAggregates` — so that a diff between any two shows only the thing that
case is about.

The elevation numbers in `centimetre.ifc` are the ones measured on a real
centimetre model, kept because they are the ones that caught the bug.
