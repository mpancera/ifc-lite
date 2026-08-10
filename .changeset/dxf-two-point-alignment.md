---
"@ifc-lite/drawing-2d": minor
---

Two-point alignment for DXF underlays.

`solveDxfPlacement` derives offset, rotation and scale from two point pairs, so a drawing is aligned by naming two features rather than by typing three numbers that interact. `inverseDxfPlacement` maps a point on a placed underlay back to the drawing's own coordinates, so re-aligning an already-moved plan replaces its placement instead of compounding it.

`describeSolvedScale` names only the round unit factors — a solved 1000 means the drawing was in millimetres, which is the answer to a question a DXF often cannot give, while 1.04 gets no name because it is a badly picked point rather than a unit.
