# Extension Notes

This fork adds a data-driven **element library** for placing installation/MEP-style
elements (detectors, alarms, cameras, and similar small fixed devices) on top of
ifclite's existing Add Element authoring tool, plus a couple of fixes found while
building and using it. Everything here is generic and upstream-portable — no
project-specific data ships in this repo (see `apps/viewer/src/lib/catalog/` for
the small example catalog used to exercise it).

Branch: `add-mep-sensor-element`. Not yet proposed upstream.

## Fixes to the base app

### Authored elements vanish under Solo / storey isolation

`registerAuthoredElement()` (`apps/viewer/src/utils/spatialHierarchy.ts`) only
updated the flat `byStorey` map — what the Hierarchy tree panel reads — for
non-space elements. It never touched the storey tree node's own `elements`
array, which is what storey isolation (Solo mode, via
`collectSpatialSubtreeElementsWithIfcSpace`) actually walks to decide what's
visible. Any freshly authored element (wall, door, sensor, a library element,
anything placed via Add Element) would show correctly in the Hierarchy tree
but disappear the instant Solo mode was active for its storey — not specific
to any one element type, and not new geometry, just missing from the
isolation set.

Fixed by writing both representations. Regression test added in
`spatialHierarchy.test.ts`.

## New features

### Element Library ("Library" type in Add Element)

A single-click placement type, alongside the built-in wall/slab/door/window/etc.,
that places elements from a data-driven catalog instead of one hardcoded type
per element.

- **`packages/create/src/in-store/library-element.ts`** — `addLibraryElementToStore`,
  a generic in-store builder for any IFC entity shaped like "header + optional
  single `PredefinedType` enum" (covers `IfcSensor`, `IfcAlarm`,
  `IfcAudioVisualAppliance`, and most other `IfcDistributionControlElement` /
  simple `IfcFlowTerminal` subtypes). One builder instead of a bespoke file per
  element type.
- **`apps/viewer/src/lib/catalog/`** — the catalog data model (`CatalogEntry`,
  `CatalogProvider`) and a small local example catalog (`LocalSeedCatalogProvider`).
  The entry shape deliberately mirrors Asset-Administration-Shell-style product
  data (a `globalAssetId`-shaped identifier, a flat "Technical Data" property
  bag, a `provenance` field noting where an entry came from) so a real external
  product-data source can be plugged in later as a second `CatalogProvider`
  without reshaping the UI or the builder.
- **Add Element panel** — a searchable, discipline-filterable catalog browser
  replaces one fixed chip per type; picking an entry drives the same
  click-to-place / hover-ghost / undo-redo flow every other Add Element type
  already has.

### F5 groundwork (not yet wired into authoring)

Two isolated, tested utilities for a "place an element into whichever
`IfcSpace` contains it, with a stable readable id" workflow — not yet called
from the Add Element flow:

- **`packages/create/src/in-store/extract-walls.ts`** — `existingSpacesByStorey()`,
  an id-preserving sibling of the existing `existingSpaceFootprintsByStorey()`
  (which only returned polygons, not which `IfcSpace` each one belongs to).
- **`apps/viewer/src/lib/relationships/`** — `resolveContainingSpace()`
  (point-in-polygon lookup against the above) and `assetId.ts` (a
  `SITE.BUILDING.FLOOR.SPACE.ASSETTYPE.COUNTER`-style id generator, pure string
  logic, counter continues from whatever `Tag` values already exist in the
  model).
