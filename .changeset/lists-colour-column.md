---
"@ifc-lite/lists": minor
---

Add a `colour` column source.

A `colour` column has no value in the model — it exists so a list can show, per row, the colour the current lens paints that element in 3D. The engine returns null for it; the consumer supplies the colour, because a colour is a property of the current *view* rather than of the element, and two people looking at the same list under different lenses are both right.

`propertyName` carries the id of the lens to paint with, or is empty for "whichever lens is active".
