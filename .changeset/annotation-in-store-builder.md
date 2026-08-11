---
"@ifc-lite/create": minor
---

Add `addAnnotationToStore`, an anchored builder for `IfcAnnotation` — drafting content that belongs to the model rather than to one viewing session (a note, a marked area, a revision cloud, a dimension line). It deliberately shares none of the element builders' shape: `IfcAnnotation` is an `IfcProduct` with no `Tag`, so `ifcElementHeader` would emit one attribute too many, and its geometry is 2D curves or a text literal in an `'Annotation'` representation rather than a swept solid in a `'Body'` one. `PredefinedType` is emitted only on IFC4X3, where the attribute exists.
