# Extension Notes

This fork is aimed at one job: making building data usable **early** in a
project, when the documentation is still 2D drawings and a list of levels
rather than a model. That pulls in three kinds of work — establishing what a
project's numbers mean before there is a model to read them from, working from
plans, and authoring installation elements into somebody else's reference
model.

Everything here is generic and upstream-portable. No project-specific data
ships in this repository: the catalogue under `apps/viewer/src/lib/catalog/`
is a small example, and the palette under `apps/viewer/public/palettes/` only
documents the format.

Branch: `datacontainer`. `main` is left as a mirror of upstream, which is what
makes "what did this fork change?" answerable at all. Nothing has been
proposed upstream.

**The short version is in the app.** The status bar's "Funktionen" button
opens a one-line-per-feature overview, filterable by whether something came
from IFClite or was added here (`apps/viewer/src/lib/features/catalog.ts`).
This document is the long version, and explains why things are the way they
are. Two concept notes go deeper still:
`docs/design/bezugsgroessen-konzept.md` and
`docs/design/georeferenzierung-nachruesten-konzept.md`.

## Data leaving the browser

ifclite parses and renders IFC entirely client-side, which is usually taken to
mean nothing about a model leaves the machine. That is not quite true out of
the box, and the exceptions are easy to miss because none of them look like a
network feature — they are things that simply render.

Found while preparing a deployment for an environment that has to guarantee
project data stays on the device. None is malicious, and each is a reasonable
default for a public web tool — they are listed because the guarantee people
assume is stronger than the one that held.

| What | Endpoint | What is disclosed |
|---|---|---|
| Location map tiles | `basemaps.cartocdn.com` | The building's real-world position — the tiles requested *are* the coordinates |
| Terrain elevation | `api.open-meteo.com` | Same coordinates, as query parameters |
| Place search | `nominatim.openstreetmap.org` | The typed query: a site name or address |
| CRS fallback | `epsg.io` | The EPSG code — a region, not a site |
| Classification search | `api.bsdd.buildingsmart.org` | The typed query |
| Official parcel boundary | `api3.geo.admin.ch` | The E-GRID — a specific plot of land |
| Icon font | `fonts.googleapis.com` | No model data, but the visitor's IP and usage on every load |

The first three fire from the Information panel without any explicit action:
opening a georeferenced model and looking at its properties was enough.

**What changed.** `lib/privacy/externalRequests.ts` is a single gate, off
unless switched on, that every network path consults before making a request.
It is deliberately one switch rather than a flag per feature — a per-feature
opt-out silently fails to cover whatever gets added next, and this is exactly
the kind of guarantee that has to hold for cases nobody has thought of yet. It
also fails closed when storage cannot be read, so consent that could not be
recorded is never assumed. The map explains why it is blank and offers to
load, naming the host it would contact. Anything added since — bSDD, the Swiss
cadastre — went in behind the same gate and into the same `EXTERNAL_ENDPOINTS`
list, which is the point of having one. File ▸ Settings ▸ Data privacy.

The icon font is now served from this origin. It is subset to the ~48 code
points `hierarchy/ifc-icons.ts` actually uses, which is 40 KB rather than the
3.9 MB of the full variable font, and it is Apache-2.0 so redistribution is
fine.

Analytics were already sound and are unchanged: PostHog only initialises when
`VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST` are set at build time, and a scrubber
strips file names, model names and paths before anything is sent. A build
without those variables sends nothing.

Verified with an empty resource-timing log: a fresh load of the viewer makes
zero requests to any host other than its own origin.

---

# Before the model

## Project identity and folder binding

An application that loads models cannot tell when it crossed from one project
into another, and that gap carries derived state over the boundary. A height
above sea level inherited from a different building is still a plausible
number; it just is not this building's, and nothing about it looks wrong.

`@ifc-lite/project` (new package) carries an opaque **ProjectKey** — not a
path, not a file name, not a project name, since each of those changes while
the project stays the same and two projects can share any of them.
`projectKeyFromModels` derives a weaker key when nothing has been bound, so
the viewer still has a boundary for somebody who just drops a file in, and
`isDerivedKey` keeps the two distinguishable.

File ▸ Settings ▸ Projekt binds the session to a folder; the binding and its
key survive a restart in IndexedDB. The panel shows two things rather than
hiding them, since both are surprising once and confusing forever if
concealed: there is no folder path to display (the browser hands out none,
hence the user-chosen label), and a remembered folder is not an open one
(permission has to be granted again, from a click). On Firefox and Safari the
API does not exist and it says so.

Two applications working on the same project both hold one thing: the folder.
So that is where they agree on what the project *is* — no message passing, no
service in between, and it still works when only one of them is running.
Binding a folder looks for a descriptor in `dc/project.json` and adopts its
key and label. **Nothing in that file is trusted**: it is written by another
program and editable by a person, so adopting whatever it says would let a
damaged descriptor put two different projects under one key — the exact
confusion the key exists to prevent, walking in through the front door.

Sidecars are written into the folder's own `dc/` directory. The two file names
that exist are two contexts rather than a migration: into the project folder,
`dc/heights.json`, because the directory already says what the file is; into
the downloads folder, `dc.heights.json`, because there it lands among
installers and invoices with no context at all.

Zones and annotations are scoped to the project key
(`useProjectScopedState`), and both slices start empty and load when told
which project they are in. Loading at construction was the old behaviour and
is exactly what carried one project's content into the next. The hook compares
the key rather than reacting to its inputs — the model map is a new object on
every load, and re-reading storage on each would fight an import in progress.

## Reference height system and units

Storey naming, elevation and height have to mean the same thing across every
discipline model in a project, and in practice they drift. File ▸ Settings ▸
Höhen & Lage holds one project-wide reference system; individual models are
checked against it.

Three findings from real models are baked in rather than rediscovered. The
elevations sit in `IfcBuildingStorey.Elevation` — deprecated, and the only
attribute either test model populated; neither wrote `ElevationOfFFLRelative`
or `ElevationOfSSLRelative`. So that attribute is the primary source and the
pset a supplement, and every storey records **where** its number came from.

**Levels are columns, not rows.** Named heights (OK-Fertigboden,
UK-Rohboden) are defined once for the system and read across the table as
columns showing their absolute elevation per storey, because the everyday act
is comparing one level across storeys rather than inspecting one storey's
offsets. Level keys are derived from the label (`ok-fertigboden`) rather than
random, so the exported JSON stays legible and a hand-written system can use
the same keys; a collision suffixes rather than overwrites.

**A system can be built before any model exists.** The height system could
originally only be derived from a loaded model, which is the wrong order for
how projects actually start: drawings first, a set of levels somebody knows,
and a model weeks later if at all. Everything else in the 2.5D flow hangs off
these numbers — where a plan is stacked, how tall a room is extruded — so they
have to come first. `createEmptyHeightSystem` plus `addStorey`/`removeStorey`;
a hand-built system then behaves exactly like a derived one, and
`derivedFrom.fileName` becomes optional and is omitted rather than invented.

**Export is the point of the whole thing.** `heights.json` leaves the viewer
as a file another application reads, repeatably. The name is deliberately
generic — the contract is the JSON *shape*, and a product-specific name in a
public repository would say more about who wrote it than about what it is.
Values are rounded to the millimetre, because elevations are computed by
subtraction and carry float noise (`0.1 - -2.43 = 2.5300000000000002`);
harmless in memory, noise in a document somebody else parses.

Alongside it, `dc.storeys.<model>.json` records how each loaded model
**actually** is, one file per model. Separate files, because merging them
would mean deciding here which model wins a disagreement, and that is the
reader's call. Nothing is rounded there: the comparison reports differences
from 5 cm up, and a value rounded to the centimetre has already spent a fifth
of that budget.

**Units** fold into the same panel, because both answer the same question:
what do the numbers in this project mean? IFC gives no help — checked against
`IFC4X3_ADD2.exp`, the only rule is `IfcCorrectUnitAssignment`, which merely
forbids duplicate unit types, and `IfcContext.UnitsInContext` is optional, so
a valid file may declare nothing at all. `describeAllUnits` is the missing
reader; the two that existed answer only about LENGTH, because that is what
geometry needs. The value is not the list but the **disagreements**.

## Georeferencing retrofitted

Concept: `docs/design/georeferenzierung-nachruesten-konzept.md`.

**Reference points instead of an angle.** The base panel asks for
`XAxisAbscissa`, which is the cosine of an angle nobody has. What people do
have is points: a building corner, a survey mark, a boundary point whose real
coordinates are on a survey list. Two pairs fix position and rotation at once
and the attributes fall out.

Deliberately not `solveDxfPlacement`, and the module says why at length.
Drawing space renders +y downward so that solver negates its rotation; map
space is +y north. Sharing it would mean a sign flag at the boundary — the
kind of parameter that is read wrong once and silently mirrors a building.
Scale means the opposite thing too: for a DXF it is the missing unit and worth
reporting, here IFC fixes it, so it is locked and what the points imply
becomes a *check* on the picks, reported in ppm.

**Contradictions are reported.** The panel accepts any number typed into it,
so a coordinate that puts the model in Turkmenistan looks exactly like one
that puts it on its plot, and nothing surfaces until somebody federates and
finds an offset. The check that works needs no external data: a file states
its position twice, as `IfcMapConversion` and as `IfcSite` reference angles.
A disagreement is the file contradicting itself, whichever of the two is
wrong. On the model that prompted this the two sit almost antipodal — 57.47 E
against 122.39 W at the same latitude, an authoring tool's default location
beside a coordinate operation with a sign error.

**Fitting an outline onto a surveyed one.** When a model carries its plot —
a site outline, a flat site plate, terrain cut to the parcel — that outline
and the official parcel geometry are the same ring described twice.

- `extract-outline.ts` recovers the ring from triangles: edges belonging to
  exactly one triangle are the border, and chaining them gives the outline
  back exactly. No hull, no alpha shape, no tolerance to tune, and a concave
  boundary stays concave — real parcels are not convex. Edges are counted as
  *unordered* pairs, because `MeshData` documents winding as unreliable.
- `footprint.ts` does the other thing, for closed bodies where every edge is
  shared: the projected silhouette, by rasterising in plan and tracing the
  covered cells. Not a convex hull — the hull of an L-shaped block spans the
  notch. The cell size *is* the accuracy, so it is reported rather than
  hidden.
- The rotation is searched for (coarse sweep, then closest-point refinement)
  rather than read off bounding boxes. Boxes only agree when the model happens
  to be axis-aligned; turn the same plate 30° and its box grows by tens of
  metres while the outline still matches perfectly.
- `mesh-to-map.ts` bridges mesh coordinates to `IfcMapConversion` attributes.
  A point read straight out of `MeshData.positions` sits at neither the IFC
  origin nor the map origin — WASM may apply an RTC offset in Z-up, the mesh
  collector flips Z-up to Y-up, and the coordinate handler may shift again. On
  a georeferenced file the RTC offset is kilometres.

The parcel comes from `api3.geo.admin.ch` behind the privacy gate. Swiss
knowledge is confined to one file behind a `ParcelSource` interface;
`parcelSourceForCrs` returns null for a model in UTM32N, which is the honest
answer — parcel fitting is unavailable there, not a Swiss lookup that returns
nothing.

The fit is driven by the viewport **selection** rather than by hunting for an
`IfcGeographicElement` with `.TERRAIN.`. It cannot tell a parcel boundary from
a setback line or a building footprint; it matches whatever it is given and
reports a plausible error either way. Naming the surface is a judgement about
the model, so it stays with the person who knows the model.

The distances come **before** the apply button, and the worst-fit distance is
measured in both directions. The first live run showed "mean 0.503 m" beside
"max 0.386 m" — a maximum below its own mean, which reads as a broken number.
The max had been measured outline-to-parcel only, so it could not see a parcel
corner the outline never reaches. Symmetric, the honest maximum on that case
is 12.98 m: the plate is close on average and wildly off in one place, which
is the panel correctly saying the selected surface is probably not the
boundary.

---

# Working from plans

## Plan mode

View ▸ Mode ▸ 2D, and a 2D/3D pair beside the basepoint toggle at the bottom
right of the viewport. A **mode**, not a camera preset: a top-down camera over
a 3D scene still foreshortens, still lets elements at different heights drift
apart on screen, and still picks whatever is nearest the eye instead of what
is on the floor being worked on.

The mode reuses `Drawing2DCanvas` rather than teaching the 3D renderer to draw
flat, and three requirements fall out of that choice instead of being built:
there is no camera on a canvas, so foreshortening cannot occur; the drawing
contains only what the cut produced and every line already carries its
`entityId`, so a hit test hits what is on this floor rather than the slab
overhead; and the drawing is what the SVG/DXF/PDF exports already lay out.

Storey isolation rides `applyLevelDisplayMode`, the single transition the
viewer requires — plan mode growing its own isolation channel is precisely
what left models stuck isolated before, and it would have disagreed with the
hierarchy about which floor is in scope. The previous mode is restored on the
way out: looking at a floor plan and switching back should leave the building
the way it was.

**Tools in a strip of their own** along the top edge: 3D overlay, body-cut vs
symbolic, IFC annotations, construction projection, drawing settings, DXF
underlays, the annotation tools, zoom, fit, export, regenerate — plus the
storey picker and the cut height, which are what make this a plan rather than
a section. Everything belonging to the model rather than to the drawing stays
in its own ribbon; this strip is not a second home for the application. The
same strip is now offered on the 3D viewport, so the two views do not disagree
about where a tool lives.

**Placing from the plan** drives the same `handleAddElementDrop` a click in 3D
drives — it only ever needed a renderer-frame point and reads the rest from
the store, so it needed exporting, not reimplementing. Every element type
therefore works in the plan without plan mode knowing any of them exist, and a
wall started in 3D can be finished in the plan. The storey is overridden to
the one being **drawn** rather than the Add Element panel's selector.

**A mark can be committed into the model** as an `IfcAnnotation` carrying the
same geometry, and the mark *stays* on screen. That is the point of offering
it as a command rather than as a mode: the same note is often wanted as a
working scribble first and as a deliverable later, and having to decide up
front is what makes markup tools annoying. All four kinds convert; a text
box's extent is converted through the live zoom, since the box is stored in
screen pixels.

### Turning the plan

A building modelled with a north deviation is awkward to work on. The plan
turns so a chosen axis runs straight — and turns **only the picture**.

The rotation is a property of the view. No coordinate that gets written passes
through it: the drawing keeps its world coordinates, only the mapping from
drawing space to screen gains an angle, and the single inverse in
`planScreenToDrawing` puts every write-side path back into true coordinates.
Picking, placing and committing an annotation therefore stay correct for free,
the georeferencing is untouched, and the DXF export needs no special case —
it writes the drawing, and the drawing was never turned.

It is saved as working state, never as model content: a model exported from a
turned session is byte-for-byte one exported from an unturned one. It rides
the project-scoped storage zones and annotations use, because the deviation is
a property of the building and outlives a storey, a session and a reload.

The north arrow **is** the tool. The angle and the thing the angle describes
belong together; kept apart you set a rotation in one corner and check it in
another. So the rotation controls live in a panel under the arrow, in the
ViewCube's corner, with a scale bar in the other.

### What a plan has to draw to be a plan

- **Doors and windows as symbols, with the swing arc.** Without them a plan
  reads as a maze: a door cut at 1.25 m is a gap with a slab of leaf in it,
  and nothing says which way it opens. Scoped to models carrying no symbolic
  representation of their own — the FZK-Haus emits 248 symbolic polylines and
  not one belongs to a door — hence the toggle, since both at once would
  double every arc. One symbol per **door**, not per door type.
- **The swing is read off the drawn leaf**, not off `OperationType`. In a real
  project model the door leaf is modelled *standing open*; that is what the
  file says and why its 3D view is correct. It also means the element's
  bounding box is as deep as the door is wide and its middle sits half a
  leaf-length out in the room, which pushed every symbol off its own doorway.
- **A door has three widths** and the arc sweeps the smallest. Every
  measurement is named rather than derived twice.
- **Room name and area written into the room.** The area-weighted centroid is
  right for every rectangular room and wrong for exactly the ones that matter
  — an L-shaped flat, a corridor bent round a core — where it lands in the
  notch, so it is tested against the footprint and falls back to the largest
  triangle's own centroid, which is inside by construction.
- **A scale instead of a zoom percentage.** "142 %" describes the window;
  1:100 describes the drawing. It can be set as well as read, and the chosen
  scale is written into the drawing display options — so the number on screen
  and the number that comes out of the printer are the same number, and
  "print at a true scale" stops being a separate feature.
- **Small devices are drawn as marks**, not at their own size. A smoke
  detector is 100 mm across: one millimetre of paper at 1:100, absent at
  1:200. Taken from the **storey**, not from the cut — a ceiling detector is
  above the 1.25 m cut and a floor socket below what the projection reaches,
  so this is not decoration of the section, it is the only thing that puts
  these elements on the plan.
- **Wall thickness comes off the wall as drawn.** Three other sources were
  measured against a real model and all three lied: the wall mesh returns
  0.19–0.98 across a door because of returns and corners,
  `Qto_WallBaseQuantities.Width` reads 150000 everywhere while Length and
  Height are honest millimetres, and GrossFootprintArea/Length is right but
  mixes m² with mm and trusts the exporter twice. The cut polygon cannot be
  wrong the same way: it is the wall at the height being drawn, in the frame
  being drawn.
- **Rooms can be derived from an imported plan**, not only from wall axes.
  Same detector, new adapter. A drawn outline means something different: walls
  give centrelines and get inset by thickness, a drawing already has both
  faces so nothing is inset — and consequently no `GrossFloorArea` is written,
  because the area is a net measure and a wrong number in a take-off is worse
  than a missing one.

## DXF underlays (2.5D)

Typing offset, rotation and scale is not aligning, it is trial and error: the
three interact, so correcting one throws off the other two. **Two point pairs
determine all three at once** — name two features on the drawing, say where
they belong, and the transform follows. Two pairs is exactly enough for a
similarity transform and no more; a third would be over-determined and need a
least-squares fit, which averages a mis-picked point away instead of showing
it.

The picking evolved into **two named lines**, mathematically the same
transform and much easier to carry out: the two picks of a pair sit far apart
on screen, so alternating between drawings made the eye jump on every click
and nothing said which of the four you were on. Now the *reference* line is
drawn on the model, on something whose position is known, and the *fitting*
line on the plan, on the same feature — both ends visible while working, drawn
thick-solid against thin-dashed so they are distinguishable without reading
anything.

The solved scale is treated as an **answer**, not just a parameter: a DXF
carries no reliable unit — `$INSUNITS` is optional and often absent — so the
solve is what tells you which unit the file was in.

**Each plan is assigned to a storey** of the height system, which since the
hand-built system can exist before any model. Without that, a folder of DXFs
lay at zero on top of itself: a pile of drawings rather than a building.
Stored as the storey ID, not a copied elevation — a copy would survive a
storey being deleted but stop agreeing the moment somebody corrects a level,
and a plan silently sitting at last week's height is worse than one that says
it lost its floor.

---

# Authoring

## Element library

A single-click placement type, alongside the built-in
wall/slab/door/window/etc., that places elements from a data-driven catalogue
instead of one hardcoded type per element.

- **`packages/create/src/in-store/library-element.ts`** —
  `addLibraryElementToStore`, a generic in-store builder for any IFC entity
  shaped like "header + optional single `PredefinedType` enum" (covers
  `IfcSensor`, `IfcAlarm`, `IfcAudioVisualAppliance`, and most other
  `IfcDistributionControlElement` / simple `IfcFlowTerminal` subtypes). One
  builder instead of a bespoke file per element type.
- **`apps/viewer/src/lib/catalog/`** — the catalogue data model and a small
  local example provider. The entry shape deliberately mirrors
  Asset-Administration-Shell-style product data (a `globalAssetId`-shaped
  identifier, a flat "Technical Data" property bag, a `provenance` field) so a
  real external product-data source can be plugged in as a second
  `CatalogProvider` without reshaping the UI or the builder.
- **`fileImportCatalogProvider.ts` + `idbCatalogStorage.ts`** — a company
  catalogue read from a JSON file the user picks, validated per entry and
  persisted in IndexedDB. Never bundled in the repo, never leaves the browser.
  `useCatalogEntries()` prefers an imported catalogue over the example one and
  exposes which source is active so the UI can say so.
- **Product Library panel** (Author ▸ Create ▸ Product Library) — two tabs:
  *Firmenbibliothek* (the active catalogue, plus import/reset) and
  *Projekt-Produkte* (one row per shared Type actually placed in the current
  model, expandable to its instances). Deliberately scoped to catalogue-placed
  products; see the doc comment in `lib/catalog/projectProducts.ts` for what
  "any Type already in the source file" would additionally need.

**Types are shared across placements.** Catalogue products carry their default
attributes on a shared `IfcXxxType` — one per product, matched by a `Tag`
convention and reused across placements, linked with `IfcRelDefinesByType` —
instead of repeating them on every instance
(`packages/create/src/in-store/library-type.ts`).

**Room containment.** An element placed inside a room is contained in that
`IfcSpace` rather than in the storey, which is what makes "which devices are
in this room" answerable from the file instead of by re-deriving it from
coordinates. Placement outside any modelled space falls back to the storey.
Containment and placement stay independent: the placement chain remains
anchored to the storey, since containment states where an element *belongs*
and the placement states where it *sits*.
`apps/viewer/src/lib/relationships/spaceLookup.ts` caches each model's space
footprints against the store object, so a placement click doesn't re-read
every space out of the STEP source.

## Roles

A discipline role adds to the reference model: devices, systems, the data that
hangs off them. It does not redraw the architect's walls. With a role active,
every edit to an entity that came from the file is refused — attributes,
properties, quantities, retype, delete, move, rotate. Encoded as a rule rather
than a convention, an accidental edit is caught where it happens instead of
surfacing later as an unexplained difference in a model somebody else owns.

The base role was **split into Viewer and Editor**. There had been one
non-discipline role with full access, so opening a model put you in a mode
that could rewrite it — and most people who open a model never author in it,
they look. Viewer is now the default and writes nothing, Editor is what
Standard was, and a discipline role sits between them with additions only.

Three gates, all keyed off the same normalized role id:

- `mayEditEntity` — Viewer refuses even entities authored this session. An
  exception there would mean read-only silently stopped being read-only the
  moment a snapshot restored an earlier session's work.
- `mayCreateEntities` — creation needs its own gate, because a new element has
  no entity to ask `mayEditEntity` about and would be "authored" by
  definition. It funnels through `runInStoreElementBuilder`, so every builder
  is covered by one check.
- `normalizeRoleId` — the pre-split `standard` value means Editor, since that
  is the access it had; silently demoting someone mid-project would look like
  the tool had broken. Anything unrecognised falls back to Viewer, read-only
  being the safe direction to fail in.

Ownership comes from the authoring overlay rather than express-id ranges: an
id above the file's watermark is a good hint but stops being a guarantee once
a session snapshot restores ids allocated earlier.

Because it gates editing, the role is visible: File ▸ Settings ▸ Disziplin,
plus a badge in the status bar — Viewer gets one too, since it is the default
and therefore the state whose refusals would otherwise look like a bug.

**Grouping into installations.** A trade planner does not place loose devices,
they build a system. While a discipline role is active, every element placed
from the catalogue also joins that installation's `IfcDistributionSystem` via
`IfcRelAssignsToGroup`. Roles are data
(`apps/viewer/src/lib/roles/disciplineRoles.ts`), so adding a trade is a new
entry and nothing else. `findDistributionSystem` matches an already-authored
system by `PredefinedType` **and** `ObjectType`, because several distinct
installations share one `IfcDistributionSystemEnum` value and only
`ObjectType` separates them. Grouping is independent of spatial containment.

## Zones and compartments

Groundwork for cause-and-effect chains (Wirkungsketten), of which a fire
matrix is one view. Built generically from the start: a valve closing and
affecting three rooms is the same shape as a trigger zone raising an alarm,
and baking "fire" into the names would only have to be unpicked later.

**Zone and spatial zone are separate builders**, because conflating them is
the easy mistake. An `IfcZone` groups *spaces* and carries no placement and no
representation — a trigger zone is defined by the rooms it covers, and asking
for its volume is a category error; membership reuses `emitRelAssignsToGroup`,
since an `IfcZone` is an `IfcSystem` is an `IfcGroup`. An `IfcSpatialZone` is
the opposite: a real spatial element with a body, whose
`IfcSpatialZoneTypeEnum` supplies `FIRESAFETY` and `SECURITY` so fire and
security compartments need no `USERDEFINED` crutch.

**Painting rooms into a zone.** Pick a zone (which is to say, pick a colour),
switch the brush on, click rooms; a Lens on "Zone / Group" colours the result
live. One `IfcRelAssignsToGroup` per zone whose `RelatedObjects` array is
rewritten in place — not a fresh relationship per assignment, which is how the
element builders emit. The difference only shows when *un*painting: with one
relationship per assignment, removing a room means finding and editing
whichever of a dozen mentions it, and painting is something done in both
directions constantly. A stroke that changes nothing returns null, so an
idempotent click costs no mutation, no undo entry and no autosave churn. The
brush rides on selection, so it inherits picking, federation and highlighting.

**The colour travels in `IfcZone.Description` as a labelled token.** A trigger
zone's colour is not decoration — it is the colour that zone has in the fire
concept, so it has to survive an export and come back on reload. IFC gives a
group no colour attribute and no standard pset, so:

    Auslösezone Ostflügel ZoneDisplay=#472A24

The token always sits at the **end**, after whatever the author wrote, so
somebody opening the file in another IFC tool reads their own sentence first
and a labelled key-value after it rather than opening with machine noise.
Reading is lenient and writing is canonical: the token is found wherever it
sits, in any case, with or without spaces, and `#f00` expands to `#FF0000`.

**Themes.** A zone without a theme is a bag of rooms. Fire compartments,
trigger zones, ventilation sections and construction phases group the same
rooms in different overlapping ways, and a colouring that mixes them is not
merely incomplete but misleading, because a room belongs to one zone per theme
and can only be drawn once. IFC records the theme in two different places,
which is the whole reason a table exists: `IfcZone` has no `PredefinedType` at
all, so the theme lives in `ObjectType`; `IfcSpatialZone` has
`IfcSpatialZoneTypeEnum`, with `ObjectType` carrying what the enum is too
coarse for. One theme, both landings derived from one row.

**Naming.** The viewer's pre-existing "Location zones" — drawn boxes, nothing
to do with `IfcZone` — are now **Compartments** (Author ▸ Create), because two
features called Zones sitting next to each other, one grouping rooms and one
drawing boxes, is how a reader stops trusting either. The panel id stays
`zones`: it is persisted in the sidebar layout and in exported flavors, so
renaming it would silently drop a user's rail order for a cosmetic gain.
Relatedly, the panel had described `IfcSpatialZone` as "Gross-area volumes",
which is wrong — a gross-area volume is an `IfcSpace` with PredefinedType GFA;
an `IfcSpatialZone` is a spatial region and has nothing to do with floor area.

**The Spaces visibility toggle was split** into rooms, the storey-sized GFA
volume, and parking, which are used completely differently. One toggle for all
three meant turning rooms on also dropped a slab over the entire floor, which
is why the toggle was usually just left off. Rooms are the *default* kind, not
the `.SPACE.` kind: `IfcSpaceTypeEnum` offers eight values and ordinary rooms
in real files are usually INTERNAL or NOTDEFINED.

## Smart Properties

An asset identifier is derived, not typed: building, storey, room, product
type, instance tag, joined by separators. Typing it by hand is where
transcription errors come from, and retyping it when a room number changes is
worse.

`apps/viewer/src/lib/smartProperties/` evaluates rules made of segments, each
carrying a separator, a value source (`IfcSite` / `IfcBuilding` /
`IfcBuildingStorey` / `IfcSpace` / `IfcEntity` / `IfcEntityType` and a field)
and — the part that matters — what to do when that source is empty. Real
models are incomplete: a device in a corridor has no room, a type may have no
tag.

- `omit` drops the segment **and** the separator before it. Keeping the
  separator yields `50266.E00._smoke-detector`, which reads as a defect rather
  than as an element that legitimately sits in a corridor.
- `alternative` substitutes another source, so an element placed without a
  shared type still yields something recognisable instead of a hole.
- `warn` reports rather than shortens: an element with no storey is a
  modelling problem, and a silently shorter identifier still looks plausible.

Rules run after the element is registered in the spatial hierarchy, not inside
the builder — storey and room only resolve once it is registered. The result
is written into a real property set, so it reaches schedules, Lens, the
properties panel and the export without any of them knowing rules exist. The
shipped default builds an `AssetIdentifier` into `Pset_ConstructionOccurence`
(buildingSMART publishes that pset with a single "r" — spelling it correctly
misses the standard set).

**A counter segment** distinguishes the second detector of the same product in
the same room from the first. It is structurally unlike every other source: it
is not read off the model, it is **allocated**, and once allocated it must
never move. If detector 002 is deleted, 003 stays 003 — renumbering would
invalidate every label, drawing and reference quoting the old value, and would
do it with no visible edit. Two consequences: "next free" is highest-in-use
plus one rather than lowest-unused, since filling a deletion's gap hands a new
device the identifier older documents still associate with the removed one;
and the number lives in `Pset_ConstructionOccurence.TagNumber` — a standard
property meaning exactly this — rather than being parsed back out of the
assembled identifier, which any separator inside a room name would defeat.
Peers come from the authoring overlay, so a counter numbers what this
discipline placed rather than what the architect modelled.

**An editor** (Author ▸ Properties ▸ Smart Property) lays a rule out as a row
of segments, matching how the value reads. The fallback sits next to its
source rather than behind a settings icon, because in real models it fires
constantly — it is part of reading the rule, not an edge case. The preview
evaluates through the *same* resolver the rules use in anger; a rule editor
whose preview lies is worse than none. Edited rules **replace** the shipped
defaults rather than merging, since merging would make "I deleted that rule"
mean "it returns next reload". Rules load at the layout root rather than
beside the viewport, which renders only once a model is open — loading there
tied "which rules are in force" to "has a file been opened", so the first
placements of a session quietly used the defaults.

**Values stay current** as the model changes: saving a rule re-evaluates, so
existing elements follow the changed rule instead of keeping values no rule
would now produce.

---

# Reading the model

## Lists

**List Edit** turns the results grid into an editable spreadsheet — same saved
lists, same columns, filters, sorting and grouping — under Edit Mode. The
panel could only read, and anything a planner wanted to correct across a set
of elements meant clicking each one in the properties panel, which is why the
data most in need of maintenance is the data nobody maintains. It writes
through the mutation overlay, so a committed value is immediately visible
everywhere else that reads through it. Three rules, pure and directly tested:

- `editTarget` decides which columns have a meaningful inverse. Attributes and
  single-set properties do. `Storey`, `Room`, materials, classifications and
  quantities do not: they are readings of a relationship or of geometry, and
  accepting typed text there would mean guessing at a re-containment or
  writing a value the next reparse silently discards. Read-only cells say
  *why* rather than ignoring the double-click.
- `coerceCellInput` types the text against the value it replaces. Room numbers
  look like `06`, and eagerly reading digits as a number turns that into a
  different room. A number only wins when the text is exactly how JavaScript
  would print it, so `06`, `1.50` and `+3` stay strings.
- `clipboardGrid` handles the tab/newline rectangle Excel puts on the
  clipboard, pastes onto the *selected range* rather than the cell it was
  dragged to, and reports what a paste could not apply.

Plus a fill handle and a Colour column.

**A Room column**, and `Container` renamed to "Contained in". Lists could
report Project, Building, Storey and "Container", and "Container" was both
unexplained and — for anything sitting directly on a storey — an exact copy of
the Storey column. There was no way to ask "which elements are not in a room
yet", the question that actually matters when placing devices. `Room` resolves
only an enclosing `IfcSpace` and is empty otherwise, so the miss is visible and
sortable; it deliberately does not inherit `Container`'s fallback to the
storey, because a room column full of storey names answers nothing. Saved
lists migrate.

**Lists answer their own filter, not the viewport's.** The visible-only filter
defaulted to on, which quietly turned every list into a view of whatever
happens to be on screen: with a storey soloed, an "All Elements" list over
~19,500 entities returned 392 rows, and turning Rooms visibility off emptied a
room schedule outright. A schedule that silently omits what it was asked for
is worse than a long one, because the row count looks like an answer. The
toggle stays, it is just no longer the default.

**The All Elements preset means all elements.** It named twelve classes, so
anything outside that list was missing from the overview named after covering
everything — `IfcMember`, `IfcOpeningElement`, `IfcPlate`, `IfcVirtualElement`,
`IfcRamp`, and every `IfcSensor` a discipline places, which is precisely the
content this fork exists to author. An empty `entityTypes` is already how the
engine expresses "no class constraint", so the preset now says what it means
and needs no maintenance as classes are added.

## Lens

**A zone dictates its own colour** in "Color by Zone / Group". Auto-colour
allocates from a palette by bucket order, which is right for values with no
colour of their own and wrong for a trigger zone: it is red because it is red
in the fire concept, and it has to stay red when painting one more room
reshuffles the count-sorted order. `LensDataProvider.getValueColor` is
optional and returns `null` to leave the bucket to the palette; the viewer
implements it for `group`, reading the `ZoneDisplay` token. "By Zone" can be
narrowed to one theme.

**Ghosted or hidden** is now a choice. Ghosting is right whenever most
elements match — By IFC Class, By Material — and wrong on volumetric ones:
isolate a storey's rooms under a zone lens and the thirty rooms without a zone
stack their 15 % alpha into an opaque block that hides the building behind it.
Fifteen percent, thirty times over, is not fifteen percent. The split lives in
the viewer, not the engine: the engine result stays truthful about what
matched, and how that is presented is a property of the current view.

## Graph

Elements arranged by what they belong to rather than by where they are — a
schematic beside the model, not instead of it (Analyze ▸ Data ▸ Graph). Three
layers:

- **`packages/graph`** (new package) — neutral `{nodes, edges}` from IFC
  relationships. Pure, no DOM, no React, private to the workspace. Chains
  describe the hops, so a new diagram kind is a value rather than code, and
  every hop is 1:n by construction.
- **elkjs in a worker** — layered, orthogonal, left to right. A superseded run
  terminates the worker and rejects, because elkjs queues on one worker and an
  oversized layout would otherwise block every later one.
- **`@xyflow/react`** — the renderer, outermost so it stays swappable.

Clicking a node selects through the channel the other panels actually read.
It had set `selectedEntity`, the multi-model ref — which looks like the more
modern call and is the wrong one: the Information panel, the hierarchy tree
and the renderer's highlight all key off `selectedEntityId`, and
`useModelSelection` derives the ref from that rather than the other way round.
So the click selected the element in a store nobody was reading.

---

# The session

## Authoring survives a reload

Everything authored in a session lived in the mutation overlay, which is
memory only: closing the tab lost it unless the model had been exported.
Sessions are mirrored to IndexedDB on every committed edit (debounced) and
restored on load. Entirely local.

Snapshots are keyed by the source file's SHA-256, not its name, because a name
says nothing about content: two revisions ship under the same file name all
the time, and restoring one revision's work onto another silently reattaches
edits to the wrong entities.

- **Same bytes** → restored without asking. That case is a recovered tab, not
  a decision worth interrupting someone for.
- **A different version of the file** → nothing is applied. The snapshot is
  reconciled against what is now open and the result is shown first
  (`RestoreSessionDialog`): what still fits, what sits in an area that
  changed, and what refers to entities the file no longer has. Declining a
  part leaves the snapshot intact rather than discarding it.

Entity references are stored twice for exactly that reason. Express ids are
what the overlay uses, but they are assigned per export and are not stable, so
every reference into the *source file* also carries its GlobalId. On restore,
an edit whose entity now sits at a different express id is dropped rather than
replayed onto whatever occupies the old one.

The snapshot also records the reference model as it stood at save time — every
GlobalId, plus a geometry fingerprint for the entities the work anchors to.
Existence alone cannot tell "unchanged" from "re-planned": an architect who
reshapes a room keeps its GlobalId, which is what GlobalIds are for. Checking
identity only reports such a room as fine and silently restores an element
that may now sit inside a new wall. Comparing the anchor's geometry hash turns
that false pass into a flag. Older snapshots still load; the check then
degrades to existence and says so rather than claiming certainty.

Preview meshes are stored rather than re-derived from the parametric input:
duplication clones its source's geometry, which no parametric record can
reproduce. `MeshData` is typed arrays and numbers, so structured clone
persists it as-is.

## Seeing what was changed on the reference model

When work is additive — elements placed, grouped and typed, with the
architecture model only referenced — anything that does touch that model is an
exception worth naming. Those edits previously sat in the same overlay as
everything else, so a correction to an architect's wall was indistinguishable
from placing a detector.

`ReferenceOverridesPanel` (Author ▸ Properties ▸ Changes to the reference
model) lists them: which entity, which field, and the before/after, keyed by
GlobalId so an entry survives a re-export. Placing an element never appears;
editing one that came from the file always does. Nothing about how edits are
stored changes — this only reads them apart.

## Loadable colour palettes

A deployment that is not stock ifclite should be recognisable as such at a
glance — someone who uses both needs to know which one they are in before they
click anything. Type and layout stay put; only colour changes.

Palettes are data, loaded at runtime and never compiled in, so no
organisation's brand colours enter this repository. The built-in default is
ifclite's own palette, unchanged;
`apps/viewer/public/palettes/example.palette.json` documents the format. File
▸ Settings ▸ Colour palette loads one or returns to the default.

Two independent parts, because they answer to different rules: `ui` for
chrome, which needs contrast, and `dataViz` for Lens series colours, which
need mutual distinguishability. Colours are written as inline custom
properties with `important` priority — the built-in dark theme declares its own
with `!important`, so a plain inline property would lose and dark mode would
silently ignore the palette. `evaluateAutoColorLens` takes an optional palette
that covers as many distinct values as it has colours, with the generated
sequence continuing beyond it so a finite palette never caps a lens.

---

# Fixes to the base app

## Readers that know the parse and not the overlay

This is the recurring one, and worth stating as a pattern rather than as a
series of surprises: **anything that reads the parsed store needs asking
whether the authoring overlay has more to say.** The instances found so far,
roughly in the order they surfaced:

1. **Solo / storey isolation.** `registerAuthoredElement()` only updated the
   flat `byStorey` map — what the Hierarchy tree reads — for non-space
   elements. It never touched the storey tree node's own `elements` array,
   which is what `collectSpatialSubtreeElementsWithIfcSpace` walks to decide
   what is visible. Any freshly authored element showed correctly in the tree
   and disappeared the instant Solo mode was active for its storey. Fixed by
   writing both representations; regression test in `spatialHierarchy.test.ts`.
2. **Lists and Lens.** `@ifc-lite/lists` and the Lens data provider read only
   the store parsed at load, so a schedule or a colour rule showed the file as
   it was opened. Fixed viewer-side, leaving `@ifc-lite/lists` unaware of the
   overlay: `lib/lists/mutationOverlayProvider.ts` decorates a
   `ListDataProvider`, `lib/lens/adapter.ts` takes an optional overlay for the
   same merge, and `useLens`/`useLensDiscovery` re-evaluate on
   `mutationVersion`. Wrapping is a no-op for an unedited model. Only products
   reach rows and the colour map, filtered by the storey registry — authoring
   an element also creates its placement/profile/solid entities.
3. **Type-level properties.** `extractTypePropertiesOnDemand` /
   `extractTypeQuantitiesOnDemand` resolve an instance's `IfcRelDefinesByType`
   link from the parsed file's static relationship graph only, so an instance
   typed during the current session resolved to "no property sets". Overlay
   fallback added, scoped to `PropertiesPanel.tsx`.
4. **The Relationships card.** It read the parse-time graph, so a device could
   belong to an installation, be bound to a product type and sit in a room,
   and the card reported nothing at all. Two of those have no home in the
   parser's four categories and get their own headings rather than being
   forced into Groups — *Contained in* (first, because for an authored device
   it answers "where is this" before openings and connections do) and *Product
   type*. Group membership merges into the existing section, skipping
   anything the parse already reported so a zone is not listed twice.
5. **The Groups/Zones tree** enumerated `entityIndex.byType`, so a zone
   painted this session was missing from the very tab named after zones.
6. **Zone lists** came back with only the file's zones — not the enumeration
   this time, but the row filter, which asked "is it registered against a
   storey"; an `IfcZone` groups rooms and sits nowhere in space, so it could
   never pass. `isRowEntity` now gets the class, and the group family plus
   `IfcSpatialZone` count as rows.
7. **`getEntityGroups`** read only the parsed relationship graph, so a zone
   painted this session was invisible to the lens.

## Other fixes

**Installation classes collapsed into `IfcTypeEnum.Unknown`.** The enum
covered a hand-picked set, so `IfcSensor`, `IfcAlarm`,
`IfcAudioVisualAppliance`, the wider MEP/distribution family and the IFC4.3
infrastructure classes all resolved to `Unknown`. Two consequences: `getByType`
could not target them at all, so a class-scoped list or query silently
returned nothing, and `getTypeName` fell back to the raw uppercase STEP
keyword, showing `IFCSENSOR`. The enum now carries a curated IFC4.3 catalogue
(131 added members, ids 321+, existing values unchanged). `@ifc-lite/cache`
bumps `FORMAT_VERSION` 13 → 14, since a v13 writer stored these as `Unknown`.

**Elements contained in a space had no storey.** `SpatialHierarchy.elementToStorey`
was populated from storey-like containers only, propagating through
`Aggregates`. An element contained in an `IfcSpace` — a device in a room,
furniture in an office, all ordinary IFC, since an element has exactly one
container and reaches its storey through the space — therefore had no storey
assignment at all, and every "which storey is this on" lookup came back blank:
the Storey column of a schedule, level offsets, search filters. Spaces are
already mapped to their storey as spatial children, so the assignment carries
one level down, guarded so direct storey containment still wins.
`elementToContainer` keeps reporting the space as the actual container.

**Authored elements reported the storey as their container.**
`registerAuthoredElement` put every authored element into `byStorey` and onto
the storey tree node even when its IFC containment named a room, and the
ancestry index walks that tree and lets it win over `elementToContainer`. It
now lands in `bySpace` and under the room node — the same split the parser
already makes, so authored and parsed elements finally agree.

**Restoring a session lost the room an element was placed in.** The snapshot
recorded the enclosing room, but restore only re-registered the storey, so
after any reload the room link was gone while the IFC containment in the
overlay still named it. Every lookup then answered with the storey: a rule
reading `IfcSpace.*` fell through to its fallback and quietly dropped its room
segment while still looking plausible, and the Container column showed the
storey. Restore now resolves the stored room GlobalId; a room the current file
no longer has falls back to the storey rather than claiming one that is not
there. Only visible after a reload, so placing and inspecting in one sitting
looked entirely correct.

**The overlay snapshot doubled on every restore.** Ten real edits became
8,519,838 mutation records in one day's session, until IndexedDB refused the
write with an out-of-memory error and the tab died. The snapshot was a
journal, not a state: capture stored the whole mutation history, restore
replayed every record into a fresh view, which recorded them again — so each
load/save cycle doubled the log, which is why the counts landed on exact
powers of two (`TagNumber` appeared 524,287 times, 2^19 − 1, carrying the
identical value "1"). Compacting proved how little was really there: 2,129,954
records collapsed losslessly to 13 distinct targets.

**Non-ASCII in STEP string literals.** ISO-10303-21 literals are ASCII-only,
but both escapers passed anything outside that range through unchanged, so an
authored name like "Löschung" landed in the exported `.ifc` as raw UTF-8 bytes
rather than a conforming literal. Both — the private one in `@ifc-lite/data`
behind `serializeValue`/`generateHeader`, and `@ifc-lite/export`'s exported
`escapeStepString` — now route through `encodeIfcString`, emitting `\X\F6`,
`\X2\03A9\X0\` and `\X4\0001F600\X0\`. It escapes the literal backslash itself
(`\` → `\X\5C`), so the old doubling is gone; keeping it would have
double-escaped.

**Windows.** The viewer's test script and the section generator both assumed a
POSIX checkout and now run on a Windows one.

---

# Groundwork, not yet wired

- **`packages/create/src/in-store/extract-walls.ts`** —
  `existingSpacesByStorey()`, an id-preserving sibling of
  `existingSpaceFootprintsByStorey()` (which only returned polygons, not which
  `IfcSpace` each one belongs to). Used by the space resolver below.
- **`apps/viewer/src/lib/relationships/assetId.ts`** — a
  `SITE.BUILDING.FLOOR.SPACE.ASSETTYPE.COUNTER`-style id generator, pure
  string logic. **Superseded by Smart Properties** and currently called from
  nowhere; kept only because nothing has decided whether the rule engine
  should grow its counter-continuation behaviour (it continues from whatever
  `Tag` values already exist in the model, which the rule engine does not do).
- `resolveContainingSpace()` from the same F5 groundwork *is* now wired — it
  is what `spaceLookup.ts` uses for room containment on placement.
