---
'@ifc-lite/create': patch
---

`addSpaceBoundaryToStore` — an IfcRelSpaceBoundary for elements that already exist

The space builder could only write boundaries for a room it was creating. A pairing decided later — a door and the two rooms it joins, which is a statement the model has no other way of making — had no builder at all. Both now go through the same emit, so the attribute order of `IfcRelSpaceBoundary` is written down once rather than twice.
