---
"@ifc-lite/parser": patch
"@ifc-lite/create": minor
---

Resolve the storey of an element contained in an `IfcSpace`, and let the in-store library builder target one.

`SpatialHierarchy.elementToStorey` was populated from storey-like containers only, propagating through `Aggregates`. An element contained in a space — a detector in a room, furniture in an office, all standard IFC, since an element has exactly one container and reaches its storey through the space — got no storey assignment at all, so every "which storey is this on" lookup (the Storey column in a schedule, level offsets, search filters) came back blank for it. Spaces are already mapped to their storey as spatial children, so the assignment now carries one level down. Direct storey containment still wins, and `elementToContainer` keeps reporting the space as the actual container.

`addLibraryElementToStore` gains an optional `ContainerId`, defaulting to `anchor.storeyId` as before, so a caller that knows which space encloses the placement can state it. The placement chain stays anchored to the storey: containment says where an element belongs, the placement says where it sits, and IFC keeps those independent.
