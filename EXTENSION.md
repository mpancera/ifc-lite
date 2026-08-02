# Extension Notes

This fork adds a data-driven **element library** for placing installation/MEP-style
elements (detectors, alarms, cameras, and similar small fixed devices) on top of
ifclite's existing Add Element authoring tool, plus a couple of fixes found while
building and using it. Everything here is generic and upstream-portable — no
project-specific data ships in this repo (see `apps/viewer/src/lib/catalog/` for
the small example catalog used to exercise it).

Branch: `add-mep-sensor-element`. Not yet proposed upstream.

## Data leaving the browser

ifclite parses and renders IFC entirely client-side, which is usually taken to
mean nothing about a model leaves the machine. That is not quite true out of
the box, and the exceptions are easy to miss because none of them look like a
network feature — they are things that simply render.

Found while preparing a deployment for an environment that has to guarantee
project data stays on the device. All four are in the base app, none is
malicious, and each is a reasonable default for a public web tool — they are
listed because the guarantee people assume is stronger than the one that held.

| What | Endpoint | What is disclosed |
|---|---|---|
| Location map tiles | `basemaps.cartocdn.com` | The building's real-world position — the tiles requested *are* the coordinates |
| Terrain elevation | `api.open-meteo.com` | Same coordinates, as query parameters |
| Place search | `nominatim.openstreetmap.org` | The typed query: a site name or address |
| CRS fallback | `epsg.io` | The EPSG code — a region, not a site |
| Icon font | `fonts.googleapis.com` | No model data, but the visitor's IP and usage on every load |

The first three fire from the Information panel without any explicit action:
opening a georeferenced model and looking at its properties was enough.

**What changed.** `lib/privacy/externalRequests.ts` is a single gate, off unless
switched on, that all four network paths consult before making a request. It is
deliberately one switch rather than a flag per feature — a per-feature opt-out
silently fails to cover whatever gets added next, and this is exactly the kind
of guarantee that has to hold for cases nobody has thought of yet. It also fails
closed when storage cannot be read, so consent that could not be recorded is
never assumed. The map explains why it is blank and offers to load, naming the
host it would contact.

The icon font is now served from this origin. It is subset to the ~48 code
points `hierarchy/ifc-icons.ts` actually uses, which is 40 KB rather than the
3.9 MB of the full variable font, and it is Apache-2.0 so redistribution is
fine.

Analytics were already sound and are unchanged: PostHog only initialises when
`VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST` are set at build time, and a scrubber
strips file names, model names and paths before anything is sent. A build
without those variables sends nothing.

Verified with an empty resource-timing log: a fresh load of the viewer now
makes zero requests to any host other than its own origin.

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

### Lists and Lens do not see the authoring overlay

Elements placed and attributes edited during a session live in the mutation
overlay; `@ifc-lite/lists` and the Lens data provider read only the store
parsed at load. A schedule or a colour rule therefore showed the file as it was
opened — authored elements were missing entirely, and edited values stayed
stale until an export + reparse round-trip. Lens additionally never
re-evaluated on an edit, so colours went stale even where the data was
reachable.

Fixed viewer-side, leaving `@ifc-lite/lists` unaware of the overlay:
`lib/lists/mutationOverlayProvider.ts` decorates a `ListDataProvider`
(authored elements become rows, deleted ones stop being rows, edited attributes
win), `lib/lens/adapter.ts` takes an optional overlay for the same merge, and
`useLens` / `useLensDiscovery` re-evaluate on `mutationVersion`. Wrapping is a
no-op for an unedited model. Only products reach rows and the colour map:
authoring an element also creates its placement/profile/solid entities, so both
call sites filter by the storey registry rather than surfacing raw overlay
contents.

### Installation classes collapsed into `IfcTypeEnum.Unknown`

`IfcTypeEnum` (`@ifc-lite/data`) covered a hand-picked set of classes. Anything
outside it — `IfcSensor`, `IfcAlarm`, `IfcAudioVisualAppliance`, the wider
MEP/distribution family, the IFC4.3 infrastructure classes — resolved to
`Unknown`. Two consequences: `getByType` could not target those classes at all,
so a class-scoped list or query silently returned nothing, and `getTypeName`
fell back to the raw uppercase STEP keyword, showing `IFCSENSOR` instead of
`IfcSensor`. The enum now carries a curated IFC4.3 class catalogue (131 added
members, ids 321+, existing values unchanged). `@ifc-lite/cache` bumps
`FORMAT_VERSION` 13 → 14, since a v13 writer stored these classes as `Unknown`.

### Type-level properties invisible for entities authored this session

`extractTypePropertiesOnDemand`/`extractTypeQuantitiesOnDemand`
(`packages/parser/src/on-demand-extractors.ts`) resolve an instance's
`IfcRelDefinesByType` link from the parsed file's static relationship
graph only. An instance typed via a relationship authored during the
current session (not present at parse time) resolved to "no property
sets" in the Properties panel until an export+reparse round-trip.
Added an overlay fallback scoped to `PropertiesPanel.tsx`'s
`typeProperties` lookup. The same underlying gap likely affects the
extractors' other consumers (Lists, Lens, LLM context) — not fixed
there yet, each reads the parsed store directly rather than merging
the mutation overlay, so this is probably one instance of a broader
pattern worth a proper fix upstream.

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
- **`packages/create/src/in-store/library-type.ts`** — `addLibraryTypeToStore` +
  `emitRelDefinesByType`: catalog products carry their default attributes on a
  shared `IfcXxxType` (one per product, reused across placements — matched by
  a `Tag` convention) instead of repeating them on every instance, using the
  same `IfcTypeObject`/`IfcRelDefinesByType` mechanism ifclite's own parser
  already resolves onto instances.

### Company catalog import + Type-sharing across placements

- **`apps/viewer/src/lib/catalog/fileImportCatalogProvider.ts`** +
  **`idbCatalogStorage.ts`** — a second `CatalogProvider` that reads a JSON
  catalog file the user picks via the browser's file dialog, validates each
  entry, and persists it in IndexedDB (never bundled in the repo, never
  leaves the browser). `useCatalogEntries()` prefers an imported catalog over
  the built-in example one whenever entries have been imported, and exposes
  which source is active so the UI can say so.
- **`addLibraryElement` (`apps/viewer/src/store/slices/mutationSlice.ts`)** —
  placing a second instance of the same catalog product now reuses the
  existing `IfcXxxType` (matched by its `Tag`) instead of creating a
  duplicate Type per instance, linked via `IfcRelDefinesByType` — the
  Type/Instance mechanism `library-type.ts` introduced is now actually
  exercised by normal placement, not just available.
- **Product Library panel** (`apps/viewer/src/components/viewer/catalog/`,
  ribbon: Author → Create → "Product Library") — a dedicated dialog with two
  tabs: **Firmenbibliothek** (table of the active catalog, plus the
  import/reset controls) and **Projekt-Produkte** (one row per shared Type
  actually placed in the current model, expandable to its instances; click
  an instance to select it in 3D). Deliberately scoped to catalog-placed
  products only — see the doc comment in `lib/catalog/projectProducts.ts`
  for what "any Type already in the source file" would additionally need.

### Loadable colour palettes

A deployment that is not stock ifclite should be recognisable as such at a
glance — someone who uses both needs to know which one they are in before they
click anything. Type and layout stay put; only colour changes.

Palettes are data, loaded at runtime and never compiled in, so no
organisation's brand colours enter this repository. The built-in default is
ifclite's own palette, unchanged; `apps/viewer/public/palettes/example.palette.json`
documents the format. View → Interface → "Colour palette" loads one or returns
to the default.

Two independent parts, because they answer to different rules: `ui` for chrome,
which needs contrast, and `dataViz` for Lens series colours, which need mutual
distinguishability. Colours are written as inline custom properties with
`important` priority — the built-in dark theme declares its own with
`!important`, so a plain inline property would lose and dark mode would
silently ignore the palette. `evaluateAutoColorLens` takes an optional palette
that covers as many distinct values as it has colours, with the generated
sequence continuing beyond it so a finite palette never caps a lens.

### Authoring survives a reload

Everything authored in a session lived in the mutation overlay, which is memory
only: closing the tab lost it unless the model had been exported. Sessions are
now mirrored to IndexedDB on every committed edit (debounced), and restored on
load. Entirely local — nothing is uploaded.

Snapshots are keyed by the source file's SHA-256, not its name, because a name
says nothing about content: two revisions ship under the same file name all the
time, and restoring one revision's work onto another silently reattaches edits
to the wrong entities.

- **Same bytes** → restored without asking. That case is a recovered tab, not a
  decision worth interrupting someone for.
- **A different version of the file** → nothing is applied. The snapshot is
  reconciled against what is now open and the result is shown first
  (`RestoreSessionDialog`): what still fits, what sits in an area that changed,
  and what refers to entities the file no longer has. Declining a part leaves
  the snapshot intact rather than discarding it.

Entity references are stored twice for exactly that reason. Express ids are what
the overlay uses, but they are assigned per export and are not stable, so every
reference into the *source file* also carries its GlobalId. On restore, an edit
whose entity now sits at a different express id is dropped rather than replayed
onto whatever occupies the old one.

The snapshot also records the reference model as it stood at save time — every
GlobalId, plus a geometry fingerprint for the entities the work anchors to.
Existence alone cannot tell "unchanged" from "re-planned": an architect who
reshapes a room keeps its GlobalId, which is what GlobalIds are for. Checking
identity only reports such a room as fine and silently restores an element that
may now sit inside a new wall. Comparing the anchor's geometry hash turns that
false pass into a flag. Snapshots written before this exists still load; the
check then degrades to existence and says so rather than claiming certainty.

### Seeing what was changed on the reference model

When work is additive — elements placed, grouped and typed, with the
architecture model only referenced — anything that does touch that model is an
exception worth naming. Those edits previously sat in the same overlay as
everything else, so a correction to an architect's wall was indistinguishable
from placing a detector.

`ReferenceOverridesPanel` (Author → Properties) lists them: which entity, which
field, and the before/after, keyed by GlobalId so an entry survives a re-export.
Placing an element never appears; editing one that came from the file always
does. Nothing about how edits are stored changes — this only reads them apart.

Preview meshes are stored rather than re-derived from the parametric input:
duplication clones its source's geometry, which no parametric record can
reproduce. `MeshData` is typed arrays and numbers, so structured clone persists
it as-is.

### Elements contained in a space have no storey

`SpatialHierarchy.elementToStorey` was populated from storey-like containers
only, propagating through `Aggregates`. An element contained in an `IfcSpace`
— a device in a room, furniture in an office, all ordinary IFC, since an
element has exactly one container and reaches its storey through the space —
therefore had no storey assignment at all, and every "which storey is this on"
lookup came back blank for it: the Storey column of a schedule, level offsets,
search filters. Spaces are already mapped to their storey as spatial children,
so the assignment now carries one level down, guarded so direct storey
containment still wins. `elementToContainer` keeps reporting the space as the
element's actual container. Affects any file that contains elements in rooms.

### Room containment for placed elements

An element placed inside a room is now contained in that `IfcSpace` rather
than in the storey — what makes "which devices are in this room" answerable
from the file instead of by re-deriving it from coordinates. Placement outside
any modelled space falls back to the storey exactly as before.

Containment and placement stay independent: the placement chain remains
anchored to the storey, since containment states where an element belongs and
the placement states where it sits. `addLibraryElementToStore` takes an
optional `ContainerId` for this; `apps/viewer/src/lib/relationships/spaceLookup.ts`
caches each model's space footprints against the store object, so a placement
click doesn't re-read every space out of the STEP source.

### Discipline roles — grouping placed elements into installations

A trade planner does not place loose devices, they build a system. Picking a
discipline role in the Add Element panel makes that explicit: while one is
active, every element placed from the catalogue also joins that installation's
`IfcDistributionSystem` via `IfcRelAssignsToGroup`. "Standard" (the default)
groups nothing and leaves placement exactly as it was.

- **`apps/viewer/src/lib/roles/disciplineRoles.ts`** — roles are data, not code
  paths; adding a trade or a system inside one is a new entry, nothing else.
- **`packages/create/src/in-store/distribution-system.ts`** —
  `addDistributionSystemToStore`, `emitRelAssignsToGroup`, and
  `findDistributionSystem`, which matches an already-authored system by
  `PredefinedType` **and** `ObjectType` so one system is reused across
  placements. Both parts matter: several distinct installations share one
  `IfcDistributionSystemEnum` value, and only `ObjectType` separates them.

Grouping is independent of spatial containment, so an element keeps the storey
placement its builder emitted.

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
