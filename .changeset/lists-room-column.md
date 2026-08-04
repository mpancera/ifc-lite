---
"@ifc-lite/lists": minor
---

Add a `Room` level to the spatial column.

`Container` resolves the element's immediate spatial parent and falls back to the storey, which is correct for "what directly contains this" but makes it useless for finding elements that have no room — every storey-contained element reports a storey, indistinguishable from a genuine miss.

`Room` resolves only an enclosing `IfcSpace` and is empty otherwise, so "which elements are not in a room yet" becomes a sort or a filter. Providers opt in with `getSpaceName`; one that does not implement it leaves the column empty rather than failing.
