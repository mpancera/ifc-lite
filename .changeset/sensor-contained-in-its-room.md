---
'@ifc-lite/create': minor
---

A placed sensor states the room it sits in

`addSensorToStore` takes an optional `ContainerId`, so the emitted
`IfcRelContainedInSpatialStructure` can name the enclosing `IfcSpace` instead
of the storey. It defaults to `anchor.storeyId`, so existing callers are
unchanged. This is the same contract `addLibraryElementToStore` already had —
a detector's containment must not depend on which way it was placed.

Why it matters: measured at a real fire-detection model, every detector was
contained in its storey and the room existed only as a text property, so the
element → room → storey chain a block schema is derived from produced 54 nodes
and not one edge. The geometric placement stays chained to the storey either
way; containment is spatial decomposition, `IfcLocalPlacement` is a coordinate
system, and re-parenting the placement would move the device.
