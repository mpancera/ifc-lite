/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Strand 1: from a drawing to a model.
 *
 * The case this strand exists for is the common one — no model arrives, only
 * plans — and the claim is that it still ends in a model rather than in
 * another drawing. Everything here runs against a blank project, so the clip
 * shows the whole way from an empty screen and borrows nothing.
 *
 * # Tracing is a choice, and the drawing has to prove it
 * `demo-plan.dxf` carries furniture, dimension lines, a structural grid and
 * room stamps on their own layers, and the clip touches none of them. A plan
 * containing only wall axes would make the tracing look like an import and
 * lose the point: what becomes a building element is decided here, not in the
 * file. The drawing is generated from the same axes the clip traces
 * (`tools/screenflow/make-demo-plan.mjs`), so the walls land on their lines.
 *
 * # Tracing happens in the plan view, because that is where it happens
 * `setViewMode('2d')` — the app's own mode, not a camera looking down. Drawing
 * a wall while the scene is in perspective is not what anybody does, and a
 * clip that shows it that way teaches the wrong habit.
 *
 * # The time jump is shown, not cut
 * Tracing a whole floor takes an afternoon. Cutting silently to a finished
 * model would imply seconds, so the clip traces this floor, says in a card
 * what it is skipping and in what quantity, and continues.
 *
 * # The room claim is now one the file supports
 * A device placed after the detection is contained in the room it sits in, not
 * in the storey — measured, all five of them. That took the room lookup
 * learning to read the authoring overlay; before that it answered from the
 * parsed file, the rooms were seconds old and invisible to it, and every
 * device landed on the storey while the rooms were on screen.
 */

import { createBlankIfcFile } from '@/utils/createBlankIfc';
import { EDITOR_ROLE_ID } from '@/lib/roles/disciplineRoles';
import { EVENT_LOAD_FILE } from '@/lib/tours/events';
import { getViewerStoreApi } from '@/store';
import { underlayDemoFile } from '../dataset';
import { propertyRowAnchor } from '@/lib/tours/anchors';
import { LocalSeedCatalogProvider, type CatalogEntry } from '@/lib/catalog';
import { midpoint } from '../worldPointer';
import { modelsSettled } from '../model-lookup';
import type { ScreenflowBeat, ScreenflowClip, ScreenflowStoreApi } from '../types';
import type { IfcStoreyLocalPoint } from '../worldPointer';

/** Wall axes in storey-local metres — the same list the DXF is drawn from. */
const WALLS: ReadonlyArray<{ start: IfcStoreyLocalPoint; end: IfcStoreyLocalPoint; name: string }> = [
  { start: [0, 0, 0], end: [12, 0, 0], name: 'Aussenwand Sued' },
  { start: [12, 0, 0], end: [12, 8, 0], name: 'Aussenwand Ost' },
  { start: [12, 8, 0], end: [0, 8, 0], name: 'Aussenwand Nord' },
  { start: [0, 8, 0], end: [0, 0, 0], name: 'Aussenwand West' },
  { start: [4.5, 0, 0], end: [4.5, 8, 0], name: 'Trennwand 1' },
  { start: [8.5, 0, 0], end: [8.5, 8, 0], name: 'Trennwand 2' },
];

const WALL_THICKNESS = 0.2;
const WALL_HEIGHT = 2.8;

/** Two doors, one per divider, so all three rooms connect. */
const DOORS: ReadonlyArray<{ at: IfcStoreyLocalPoint; name: string }> = [
  { at: [4.5, 4, 0], name: 'Tuer Buero-Sitzung' },
  { at: [8.5, 4, 0], name: 'Tuer Sitzung-Lager' },
];

/**
 * Five placements across the three rooms, named by CATALOGUE ENTRY.
 *
 * Only the id and the position live here. What the element is — its IFC class,
 * its predefined type, its size, its technical data — comes from the catalogue
 * at placement time, because that is the argument this beat makes: these are
 * products off a maintained range, not shapes the demo invented. A clip that
 * restated the geometry would be a second, drifting copy of the range.
 *
 * Four kinds in five placements, with two of one kind in one room: the counter
 * in the identifier rule is scoped per room and type, so that pair is what
 * shows 001 and 002 later.
 */
const PLACEMENTS: ReadonlyArray<{ catalogId: string; at: IfcStoreyLocalPoint }> = [
  { catalogId: 'fire.smoke-detector', at: [2.2, 5.4, 2.7] },
  { catalogId: 'fire.smoke-detector', at: [2.2, 2.2, 2.7] },
  { catalogId: 'fire.manual-call-point', at: [4.9, 3.4, 1.4] },
  { catalogId: 'fire.siren', at: [6.5, 7.7, 2.3] },
  { catalogId: 'fire.heat-detector', at: [10.2, 4.0, 2.7] },
];

/** The catalogue the demo places from, read without a React hook. */
const catalogue = new LocalSeedCatalogProvider();

function catalogEntry(catalogId: string): CatalogEntry | null {
  const entries = catalogue.listEntries();
  return Array.isArray(entries) ? entries.find((e) => e.id === catalogId) ?? null : null;
}

/**
 * Where the numbering rule writes: the standard occurrence pset. The clip
 * points at this exact row, so it and the rule cannot drift apart.
 */
const IDENTIFIER = { pset: 'Pset_ConstructionOccurence', property: 'AssetIdentifier' } as const;

/** The n-th device this session created, in creation order. */
function authoredDevice(store: ScreenflowStoreApi, index: number): number | null {
  const state = store.getState();
  const modelId = [...state.models.keys()][0];
  const view = modelId ? state.mutationViews.get(modelId) : undefined;
  if (!view) return null;
  const devices: number[] = [];
  for (const entity of view.getNewEntities()) {
    if ((entity.type === 'IfcSensor' || entity.type === 'IfcAlarm') && !view.isDeleted(entity.expressId)) {
      devices.push(entity.expressId);
    }
  }
  return devices[index] ?? null;
}

/**
 * Select one device and show its properties.
 *
 * Three of these in a row is the point: the identifier is assembled from the
 * room and a counter scoped to it, so the second detector in a room reads 002
 * and the first one in the next room is back to 001. One example proves
 * nothing about a rule; three show it.
 */
function showIdentifierBeat(index: number, captionDe: string, captionEn: string): ScreenflowBeat {
  return {
    id: `identifier-${index + 1}`,
    anchor: propertyRowAnchor(IDENTIFIER.pset, IDENTIFIER.property),
    panel: 'properties',
    captionDe,
    captionEn,
    prepare: (store) => {
      const expressId = authoredDevice(store, index);
      const modelId = [...store.getState().models.keys()][0];
      if (expressId === null || !modelId) return;
      // Belt and braces with the beat that switches back to 3D: an active
      // add-element tool keeps the Information panel out of the side slot,
      // and this beat is nothing without it.
      store.getState().setActiveTool('select');
      store.getState().showWorkspacePanel('properties');
      store.getState().setPropertiesActiveTab('properties');
      store.getState().setSelectedEntity({ modelId, expressId });
      store.getState().setSelectedEntityId(expressId);
    },
    settled: (s) => s.selectedEntityId === authoredDevice(getViewerStoreApi(), index),
    settleTimeoutMs: 6000,
    holdMs: index === 0 ? 4600 : 3400,
  };
}

/**
 * How many entities of this type the session has authored.
 *
 * Every beat that creates something proves itself against this rather than
 * against `models.size > 0`. Learned the hard way: written as `settled: () =>
 * true`, five wall beats played their captions, advanced happily, and created
 * nothing at all — the clip looked right and the model stayed empty, which is
 * exactly the failure the proof exists to catch.
 */
export function authoredCount(store: ScreenflowStoreApi, ifcType: string): number {
  const state = store.getState();
  const modelId = [...state.models.keys()][0];
  const view = modelId ? state.mutationViews.get(modelId) : undefined;
  if (!view) return 0;
  let count = 0;
  for (const entity of view.getNewEntities()) {
    if (entity.type === ifcType && !view.isDeleted(entity.expressId)) count += 1;
  }
  return count;
}

/**
 * Make the project editable.
 *
 * Two gates stand between a loaded model and a created element, and both fail
 * SILENTLY — `runInStoreElementBuilder` returns `{ error }` that nobody reads.
 * The role must not be the viewer one (`mayCreateEntities`), and the model
 * needs a mutation overlay (`ensureMutationView`). A person clicking through
 * the UI passes both without noticing; a clip has to ask for them.
 */
function makeEditable(store: ScreenflowStoreApi): void {
  const state = store.getState();
  state.setActiveDisciplineSystemId(EDITOR_ROLE_ID);
  const modelId = [...state.models.keys()][0];
  if (modelId) state.ensureMutationView(modelId);
}

/** The blank project has exactly one model and one storey; both are the first. */
function target(store: ScreenflowStoreApi): { modelId: string; storeyId: number } | null {
  const state = store.getState();
  const [modelId, model] = [...state.models.entries()][0] ?? [];
  const ids = model?.ifcDataStore?.entityIndex?.byType?.get('IFCBUILDINGSTOREY');
  if (!modelId || !ids || ids.length === 0) return null;
  return { modelId, storeyId: ids[0] };
}

/** One beat per wall, so the tracing reads as tracing and not as a jump cut. */
function traceWallBeats(): ScreenflowBeat[] {
  return WALLS.map((wall, i) => ({
    id: `wall-${i + 1}`,
    captionDe: i === 0
      ? 'Nur die Wandachsen werden nachgezogen – Anfang, Ende, fertig.'
      : i === 4
        ? 'Zwei Trennwände machen aus der Fläche drei Räume.'
        : 'Zug für Zug, direkt auf der Linie der Zeichnung.',
    captionEn: i === 0
      ? 'Only the wall axes get traced - start, end, done.'
      : i === 4
        ? 'Two dividers turn the floor into three rooms.'
        : 'Stroke by stroke, straight onto the drawing line.',
    // Short holds: the caption repeats, the action is what carries the beat.
    holdMs: i === 0 ? 3600 : 1100,
    worldPoint: midpoint(wall.start, wall.end),
    perform: (store) => {
      const at = target(store);
      if (!at) return;
      store.getState().addWall(at.modelId, at.storeyId, {
        Start: [...wall.start] as [number, number, number],
        End: [...wall.end] as [number, number, number],
        Thickness: WALL_THICKNESS,
        Height: WALL_HEIGHT,
        Name: wall.name,
      });
    },
    // The wall exists, counted: this beat is the (i+1)-th one to draw one.
    settled: () => authoredCount(getViewerStoreApi(), 'IfcWall') > i,
    settleTimeoutMs: 5000,
  }));
}

/** One beat per device, so the placing reads as placing. */
/**
 * One beat per placement, each one selecting its product first.
 *
 * `setAddElementLibrarySelection` puts the entry into the store, so the panel
 * highlights the product the beat is about to place. Without it the library is
 * on screen but nothing says which line of it is being used, and the beat
 * reads as "a device appeared" rather than "this product was chosen".
 *
 * Every parameter comes off the entry. The clip knows a position and an id;
 * the range knows what the thing is.
 */
function placeDeviceBeats(): ScreenflowBeat[] {
  return PLACEMENTS.map((placement, i) => {
    const entry = catalogEntry(placement.catalogId);
    return {
      id: `device-${i + 1}`,
      captionDe: i === 0
        ? 'Die Geräte kommen aus der Bibliothek – eine gepflegte Produktpalette.'
        : i === 2
          ? 'Nicht nur Melder: Handfeuermelder und Signalgeber stehen daneben.'
          : 'Weiter, Raum für Raum – jedes Mal ein Produkt aus derselben Liste.',
      captionEn: i === 0
        ? 'The devices come from the library - a maintained product range.'
        : i === 2
          ? 'Not only detectors: call points and sounders sit beside them.'
          : 'On through the rooms - each one a product from the same list.',
      holdMs: i === 0 || i === 2 ? 3600 : 1300,
      worldPoint: placement.at,
      prepare: (store) => {
        // Show which product is being used, in the panel, while it is used.
        if (entry) store.getState().setAddElementLibrarySelection(entry);
      },
      perform: (store) => {
        const at = target(store);
        if (!at || !entry) return;
        store.getState().addLibraryElement(at.modelId, at.storeyId, {
          IfcEntity: entry.ifc.entity,
          Position: [...placement.at] as [number, number, number],
          PredefinedType: entry.ifc.predefinedType,
          Name: entry.label,
          Width: entry.geometry?.width,
          Depth: entry.geometry?.depth,
          Height: entry.geometry?.height,
          Discipline: entry.discipline,
          CatalogEntryId: entry.id,
          TechnicalData: entry.technicalData,
        });
      },
      settled: () => {
        const store = getViewerStoreApi();
        return authoredCount(store, 'IfcSensor') + authoredCount(store, 'IfcAlarm') > i;
      },
      settleTimeoutMs: 6000,
    };
  });
}

export const STRAND_01_FROM_A_DRAWING: ScreenflowClip = {
  id: 'strand-01-from-a-drawing',
  number: 1,
  titleDe: 'Vom Papierplan zum Modell',
  titleEn: 'From a drawing to a model',
  messageDe: 'Auch ohne Modell vom Architekten endet der Weg in einem Modell.',
  messageEn: 'Even with no model from the architect, the road still ends in one.',
  version: 2,
  requires: ['plan'],
  beats: [
    {
      id: 'title',
      frame: 'card',
      captionDe: 'Der Normalfall: kein Modell, nur Pläne.',
      captionEn: 'The common case: no model, only drawings.',
      holdMs: 3200,
    },
    {
      id: 'blank-project',
      captionDe: 'Ein leeres Projekt – noch nichts darin ausser einem Geschoss.',
      captionEn: 'An empty project - nothing in it yet but a storey.',
      perform: () => {
        window.dispatchEvent(new CustomEvent(EVENT_LOAD_FILE, { detail: createBlankIfcFile() }));
      },
      settled: (s) => modelsSettled(s, 1),
      settleTimeoutMs: 60_000,
    },
    {
      id: 'make-editable',
      captionDe: 'Rolle auf Bearbeiten – ab hier darf das Modell wachsen.',
      captionEn: 'Role set to editing - from here the model may grow.',
      perform: makeEditable,
      settled: (s) => s.activeDisciplineSystemId !== 'viewer' && s.mutationViews.size > 0,
      settleTimeoutMs: 5000,
    },
    {
      id: 'underlay',
      captionDe: 'Die Zeichnung kommt als DXF dazu – als Unterlage, nicht als Modell.',
      captionEn: 'The drawing arrives as DXF - as an underlay, not as a model.',
      perform: () => underlayDemoFile('plan'),
      settled: (s) => s.dxfUnderlays.length > 0,
      settleTimeoutMs: 30_000,
    },
    {
      id: 'plan-view',
      captionDe: 'Grundriss statt Perspektive – gezeichnet wird in 2D.',
      captionEn: 'Plan view, not perspective - drawing happens in 2D.',
      perform: (store) => {
        store.getState().setViewMode('2d');
        store.getState().cameraCallbacks.fitAll?.();
      },
      settled: (s) => s.viewMode === '2d',
      settleTimeoutMs: 8000,
    },
    {
      id: 'what-is-in-the-drawing',
      captionDe: 'Möbel, Bemassung, Raster, Raumstempel – davon wird nichts zum Bauteil.',
      captionEn: 'Furniture, dimensions, grid, room stamps - none of it becomes an element.',
      holdMs: 4600,
    },
    ...traceWallBeats(),
    {
      id: 'doors',
      captionDe: 'Zwei Türen, je eine in einer Trennwand.',
      captionEn: 'Two doors, one in each dividing wall.',
      worldPoint: DOORS[0].at,
      perform: (store) => {
        const at = target(store);
        if (!at) return;
        for (const door of DOORS) {
          store.getState().addDoor(at.modelId, at.storeyId, {
            Position: [...door.at] as [number, number, number],
            Width: 1,
            Height: 2.1,
            Name: door.name,
          });
        }
      },
      settled: () => authoredCount(getViewerStoreApi(), 'IfcDoor') >= DOORS.length,
      settleTimeoutMs: 8000,
    },
    {
      id: 'time-jump',
      frame: 'card',
      captionDe: 'Später. Ein ganzes Geschoss, von Hand nachgezogen.',
      captionEn: 'Later. A whole floor, traced by hand.',
      holdMs: 3400,
    },
    {
      id: 'room-tool',
      anchor: 'add-element-panel',
      captionDe: 'Räume zeichnet niemand nach – das Werkzeug liest sie aus den Wänden.',
      captionEn: 'Nobody traces rooms - the tool reads them out of the walls.',
      prepare: (store) => {
        // Show the tool that is about to run, with its parameters: the whole
        // point of this beat is that the detection is a choice with settings,
        // not something that quietly happens.
        const state = store.getState();
        state.setActiveTool('addElement');
        state.setAddElementType('space');
        state.setAddElementSpaceSource('walls');
      },
      settled: (s) => s.addElementType === 'space' && s.addElementSpaceSource === 'walls',
      settleTimeoutMs: 6000,
    },
    {
      id: 'room-preview',
      anchor: 'add-element-panel',
      captionDe: 'Erst die Vorschau: drei geschlossene Flächen, bei 1,0 m Fangweite.',
      captionEn: 'Preview first: three enclosed areas, at a 1.0 m snap tolerance.',
      perform: (store) => {
        const at = target(store);
        if (!at) return;
        // The dry run draws its outlines in the viewport. A commit without a
        // visible preview would look like magic; this is the beat that shows
        // the tool doing the work.
        const result = store.getState().generateSpacesFromWalls(at.modelId, at.storeyId, {
          snapTolerance: 1.0,
          dryRun: true,
        });
        if ('error' in result) return;
        store.getState().setAddElementAutoSpacePreview({
          storeyExpressId: at.storeyId,
          source: 'walls',
          outlines: result.detected.map((d) => d.outline.map((p) => [p[0], p[1]] as [number, number])),
          regions: result.detected.map((d) => ({ area: d.area })),
          wallsConsidered: result.wallsConsidered,
          wallsContributing: result.wallsContributing,
        });
      },
      settled: (s) => (s.addElementAutoSpacePreview?.outlines.length ?? 0) >= 3,
      settleTimeoutMs: 15_000,
    },
    {
      id: 'rooms',
      anchor: 'add-element-panel',
      captionDe: 'Übernehmen – und die drei Räume stehen als Volumen im Modell.',
      captionEn: 'Commit - and the three rooms stand in the model as volumes.',
      perform: (store) => {
        const at = target(store);
        if (!at) return;
        store.getState().generateSpacesFromWalls(at.modelId, at.storeyId, { snapTolerance: 1.0 });
        store.getState().setAddElementAutoSpacePreview(null);
      },
      // Three rooms is the whole point of the two dividers; fewer would mean
      // the traced walls did not close, which is worth failing the take over.
      settled: () => authoredCount(getViewerStoreApi(), 'IfcSpace') >= 3,
      settleTimeoutMs: 30_000,
    },
    {
      id: 'open-library',
      anchor: 'add-element-panel',
      captionDe: 'Installationselemente kommen nicht von Hand – sondern aus der Bibliothek.',
      captionEn: 'Installation elements are not drawn by hand - they come from the library.',
      prepare: (store) => {
        // The room tool left the panel on 'space'; switching it to the library
        // is what puts the product range on screen, and the range on screen is
        // the whole point of this beat.
        const state = store.getState();
        state.setActiveTool('addElement');
        state.setAddElementType('library');
      },
      settled: (s) => s.addElementType === 'library',
      settleTimeoutMs: 6000,
      holdMs: 4200,
    },
    ...placeDeviceBeats(),
    {
      id: 'back-to-3d',
      captionDe: 'Zurück in die Räumlichkeit – aus den Strichen ist ein Bauwerk geworden.',
      captionEn: 'Back into space - the strokes have become a building.',
      perform: (store) => {
        store.getState().setViewMode('3d');
        // Leave the add-element tool: it owns the docked side panel while it
        // is active, and every beat after this one wants the Information
        // panel there instead. Measured: the identifier rows were simply not
        // in the DOM until the tool let go.
        store.getState().setActiveTool('select');
        store.getState().cameraCallbacks.fitAll?.();
      },
      settled: (s) => s.viewMode === '3d',
      settleTimeoutMs: 8000,
      holdMs: 4200,
    },
    {
      id: 'lens',
      anchor: 'activity-lens',
      panel: 'lens',
      captionDe: 'Eine Lens färbt nach Bauteilart – Wand, Tür, Raum, Gerät.',
      captionEn: 'A lens colours by element class - wall, door, room, device.',
      prepare: (store) => store.getState().showWorkspacePanel('lens'),
      perform: (store) => store.getState().setActiveLens('lens-by-class'),
      settled: (s) => s.activeLensId !== null,
      settleTimeoutMs: 6000,
    },
    showIdentifierBeat(
      0,
      'Die Nummer ist nicht getippt – eine Regel setzt sie beim Platzieren.',
      'The number was not typed - a rule assigns it as the device is placed.',
    ),
    showIdentifierBeat(
      1,
      'Zweiter Melder im selben Raum: derselbe Weg, Nummer 002.',
      'Second detector in the same room: same path, number 002.',
    ),
    showIdentifierBeat(
      2,
      'Anderer Raum – und der Zähler beginnt dort wieder bei 001.',
      'A different room - and the counter starts again at 001 there.',
    ),
    {
      id: 'lists',
      anchor: 'activity-lists',
      panel: 'lists',
      captionDe: 'Alles Gesetzte steht als Liste – fünf Geräte, mit ihrem Raum.',
      captionEn: 'Everything placed is a list - five devices, each with its room.',
      perform: (store) => store.getState().showWorkspacePanel('lists'),
      settled: (s) => s.listPanelVisible,
      settleTimeoutMs: 6000,
    },
    {
      id: 'close',
      frame: 'card',
      captionDe: 'Aus einer Zeichnung wurde ein Modell. Ohne CAD, ohne Konvertierung.',
      captionEn: 'A drawing became a model. No CAD, no conversion.',
      holdMs: 3800,
    },
  ],
};
