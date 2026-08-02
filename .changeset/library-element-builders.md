---
"@ifc-lite/create": minor
---

Add data-driven builders for placing catalogue elements, so a library of installation elements no longer needs one bespoke builder file per IFC class.

- `addLibraryElementToStore` builds any entity shaped like "IfcRoot header + optional single `PredefinedType` enum" — `IfcSensor`, `IfcAlarm`, `IfcAudioVisualAppliance` and most other `IfcDistributionControlElement` / simple `IfcFlowTerminal` subtypes.
- `addLibraryTypeToStore` + `emitRelDefinesByType` put a catalogue product's shared defaults on an `IfcXxxType` and link occurrences to it, using the `IfcTypeObject` / `IfcRelDefinesByType` mechanism the parser already resolves onto instances, rather than repeating the values on every placement.
- `existingSpacesByStorey` returns each storey's `IfcSpace` footprints **with** their express ids. The existing `existingSpaceFootprintsByStorey` returns geometry only, which is enough for auto-space detection but not for assigning an element to the space that contains it; it is now implemented in terms of the new function, with unchanged behaviour.
