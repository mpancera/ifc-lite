---
"@ifc-lite/drawing-2d": minor
---

A drawing sheet can now carry SEVERAL views, each with its own scale and rotation. `DrawingSheet` gains an optional `viewports: SheetViewport[]`, alongside `sheetViewports`, `hasMultipleViews`, `viewportScale`, `viewportRotation` and `placeViewports`.

The sheet held exactly one `scale` and one `northArrow`, which describes most drawings correctly and some not at all: a fire brigade site plan is conventionally issued as a site overview at 1:500 beside a floor plan at 1:200, on one sheet. Two scales, and also two rotations — the overview is turned to the approach direction while an inset stays north-up — and a single value of each cannot hold both. The honest consequence of keeping them was issuing two sheets where the convention is one.

Additive rather than a replacement: `viewportBounds` keeps its meaning and every existing sheet draws identically, because `viewports` is absent on all of them. `sheetViewports` is the function to read — it answers with a list for every sheet, old or new, so a consumer never handles both shapes. Reading `sheet.viewports` directly is the mistake it exists to prevent: that field is `undefined` on most sheets, and iterating it without a fallback silently draws nothing.

`placeViewports` converts fractional placements (a definition that works on A3 and A1 alike) into sheet millimetres, dropping any view that falls outside the page rather than clamping it onto its neighbour.
