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
import { EVENT_LOAD_FILE } from '@/lib/tours/events';
import { getViewerStoreApi } from '@/store';
import { propertyRowAnchor } from '@/lib/tours/anchors';
import { underlayDemoFile } from '../dataset';
import { midpoint } from '../worldPointer';
import { modelsSettled } from '../model-lookup';
import { planViewport } from '@/lib/plan/planViewport';
import {
  authoredCount, authoredDevices, catalogEntry, DOORS, makeEditable, placeFromCatalogue,
  PLACEMENTS, SNAP_TOLERANCE, target, WALL_HEIGHT, WALL_THICKNESS, WALLS,
} from './demo-building';
import { IfcTypeEnum } from '@ifc-lite/data';
import type { ListDefinition } from '@ifc-lite/lists';
import type { ScreenflowBeat, ScreenflowClip } from '../types';

/**
 * Where the numbering rule writes: the standard occurrence pset. The clip
 * points at this exact row, so it and the rule cannot drift apart.
 */
const IDENTIFIER = { pset: 'Pset_ConstructionOccurence', property: 'AssetIdentifier' } as const;

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
      const expressId = authoredDevices(store)[index] ?? null;
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
    settled: (s) => s.selectedEntityId === authoredDevices(getViewerStoreApi())[index],
    settleTimeoutMs: 6000,
    holdMs: index === 0 ? 4600 : 3400,
  };
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
      perform: (store) => placeFromCatalogue(store, placement),
      settled: () => {
        const store = getViewerStoreApi();
        return authoredCount(store, 'IfcSensor') + authoredCount(store, 'IfcAlarm') > i;
      },
      settleTimeoutMs: 6000,
    };
  });
}

/**
 * The list this clip shows: what was placed, and where it hangs.
 *
 * Built here rather than picked from the presets because none of them is this
 * list — the closest is "All Elements", which answers with the walls and the
 * rooms too, and the beat's whole claim is that the five devices came out
 * carrying their room. A list that does not match its caption is worse than no
 * list, because the caption is what the audience will remember.
 */
const DEVICE_LIST: ListDefinition = {
  id: 'screenflow-devices',
  name: 'Platzierte Geraete',
  description: 'Was in diesem Geschoss gesetzt wurde, mit Nummer und Raum',
  createdAt: 0,
  updatedAt: 0,
  entityTypes: [IfcTypeEnum.IfcSensor, IfcTypeEnum.IfcAlarm],
  conditions: [],
  columns: [
    { id: 'attr-name', source: 'attribute', propertyName: 'Name' },
    { id: 'attr-objecttype', source: 'attribute', propertyName: 'ObjectType' },
    // The number the rule assigns on placement -- the point of three earlier
    // beats, and the reason this list is worth exporting at all.
    {
      id: 'prop-occurrence-assetidentifier',
      source: 'property',
      psetName: 'Pset_ConstructionOccurence',
      propertyName: 'AssetIdentifier',
      label: 'AssetIdentifier',
    },
    { id: 'spatial-container', source: 'spatial', propertyName: 'Container', label: 'Raum' },
  ],
};

/**
 * The plan's fit counter as it stood before the fit beat asked for one.
 *
 * Module-level rather than closed over because `prepare` and `settled` are
 * separate calls on the same beat object, and a clip is a value rather than an
 * instance -- there is nowhere else for one beat to keep a note to itself.
 */
let fitFrom: number | null = null;

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
      perform: (store) => {
        // Room visibility is persisted in localStorage, so a previous run that
        // switched it off (this clip does, before the lens) leaves the next
        // one generating three rooms nobody can see. A clip has to start from
        // a state it set, not from whatever the last one left behind.
        if (!store.getState().typeVisibility.rooms) store.getState().toggleTypeVisibility('rooms');
        // Named the way a real project is, because the asset identifier is
        // assembled out of these very names: `A.01.03_FST.RM.001`. A building
        // called "Building" on a storey called "Level 1" produces an
        // identifier that reads like placeholder text, which is exactly what
        // the numbering beat is meant to show working.
        window.dispatchEvent(new CustomEvent(EVENT_LOAD_FILE, {
          detail: createBlankIfcFile({
            projectName: 'Musterbau',
            buildingName: 'A',
            storeyName: '01',
            storeyLongName: '1. Obergeschoss',
          }),
        }));
      },
      settled: (s) => modelsSettled(s, 1) && s.typeVisibility.rooms,
      settleTimeoutMs: 60_000,
    },
    {
      // The role decides whether anything may be written at all. Switching it
      // in one beat looked like the software deciding for itself; this shows
      // the choice being made, which is what it is.
      id: 'roles-shown',
      captionDe: 'Wer darf hier eigentlich etwas ändern? Die Fachrolle entscheidet das.',
      captionEn: 'Who is allowed to change anything here? The discipline role decides.',
      // The File tab first, and not for show: the ribbon renders only the
      // active tab, so the role control is not in the tree at all until this
      // runs -- the request went nowhere and the beat timed out. Measured on
      // the first take of this version.
      prepare: (store) => store.getState().setRibbonTab('file'),
      perform: (store) => store.getState().setRoleDialogOpen(true),
      settled: () => document.querySelector('[role="dialog"]') !== null,
      settleTimeoutMs: 6000,
      holdMs: 5200,
    },
    {
      id: 'make-editable',
      captionDe: 'Ansehen, oder eine Anlage bearbeiten – hier: Bearbeiten.',
      captionEn: 'View only, or author one installation - here: authoring.',
      perform: (store) => {
        makeEditable(store);
        // The dialog has done its job; leaving it up would cover the next
        // beat. Closed through the store: the first version sent an Escape
        // keystroke, which the screenflow's own handler reads as "stop the
        // clip" -- it would have ended the recording, not the dialog.
        store.getState().setRoleDialogOpen(false);
      },
      settled: (s) =>
        s.activeDisciplineSystemId !== 'viewer'
        && s.mutationViews.size > 0
        && document.querySelector('[role="dialog"]') === null,
      settleTimeoutMs: 6000,
      holdMs: 2600,
    },
    {
      // Plan FIRST, drawing second. The other order put the drawing into a
      // perspective view where nobody could read it, and then cut to a 2D view
      // that already had everything in it -- the arrival of the drawing, which
      // is the point of this stretch, happened off screen.
      id: 'plan-view',
      captionDe: 'Grundriss statt Perspektive – gezeichnet wird in 2D.',
      captionEn: 'Plan view, not perspective - drawing happens in 2D.',
      perform: (store) => store.getState().setViewMode('2d'),
      settled: (s) => s.viewMode === '2d',
      settleTimeoutMs: 8000,
      holdMs: 2800,
    },
    {
      id: 'underlay',
      captionDe: 'Die Zeichnung kommt als DXF dazu – als Unterlage, nicht als Modell.',
      captionEn: 'The drawing arrives as DXF - as an underlay, not as a model.',
      perform: () => underlayDemoFile('plan'),
      settled: (s) => s.dxfUnderlays.length > 0,
      settleTimeoutMs: 30_000,
      holdMs: 2600,
    },
    {
      id: 'zoom-to-drawing',
      captionDe: 'Massstäblich hinterlegt – nicht importiert.',
      captionEn: 'Placed underneath to scale - not imported.',
      // The proof is the view itself, because framing changes no fact about
      // the model — and it has to be a MOVE, not merely a different number.
      //
      // Fitting is what makes the drawing visible at all here. The plan does
      // NOT frame itself in this state: its auto-fit waits for a cut, and
      // there is no cut yet — nothing has been traced. So the paper sits at
      // one pixel per metre and a 12 m building is twelve pixels wide, which
      // is what the earlier takes of this beat were showing.
      //
      // The proof reads `planFitVersion` and not the transform itself. A
      // `settled` predicate is re-evaluated when the VIEWER STORE changes and
      // at no other time, so a proof that watches a module variable is checked
      // once, before the work lands, and then never again -- it times out
      // however well the beat worked. Measured, three takes running.
      prepare: (store) => { fitFrom = store.getState().planFitVersion; },
      perform: (store) => store.getState().requestPlanFit(),
      settled: (s) => fitFrom !== null && s.planFitVersion > fitFrom,
      settleTimeoutMs: 8000,
      holdMs: 4200,
    },
    {
      id: 'what-is-in-the-drawing',
      captionDe: 'Möbel, Bemassung, Raster, Raumstempel – davon wird nichts zum Bauteil.',
      captionEn: 'Furniture, dimensions, grid, room stamps - none of it becomes an element.',
      holdMs: 4600,
    },
    {
      id: 'underlay-in-3d',
      captionDe: 'Und räumlich liegt sie auf der Höhe ihres Geschosses.',
      captionEn: 'And in space it sits at the level of its own storey.',
      perform: (store) => {
        store.getState().setViewMode('3d');
        store.getState().cameraCallbacks.fitAll?.();
      },
      settled: (s) => s.viewMode === '3d',
      settleTimeoutMs: 8000,
      holdMs: 4200,
    },
    {
      id: 'back-to-plan',
      captionDe: 'Nachgezogen wird trotzdem im Grundriss – da stimmen die Masse.',
      captionEn: 'Tracing still happens in the plan - that is where the measurements are.',
      perform: (store) => {
        store.getState().setViewMode('2d');
        store.getState().requestPlanFit();
      },
      settled: (s) => s.viewMode === '2d',
      settleTimeoutMs: 8000,
      holdMs: 2400,
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
            // Without this the leaf runs along X and stands square across a
            // north-south divider instead of in it -- a visible modelling
            // error in a clip about producing a correct model.
            RefDirection: door.along,
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
      // Between the preview and the commit, because the preview IS the answer
      // and it was on screen for no time at all: the pointer sat on the same
      // panel through three beats and then three rooms appeared at once, which
      // read as the software having done something unexplained.
      id: 'room-preview-read',
      captionDe: 'Drei Flächen, weil zwei Trennwände drin stehen.',
      captionEn: 'Three areas, because two dividers stand in there.',
      worldPoint: [6, 4, 0],
      holdMs: 4800,
    },
    {
      id: 'rooms',
      anchor: 'add-element-panel',
      captionDe: 'Übernehmen – und die drei Räume stehen als Volumen im Modell.',
      captionEn: 'Commit - and the three rooms stand in the model as volumes.',
      perform: (store) => {
        const at = target(store);
        if (!at) return;
        // `{nn}` zero-pads: rooms come out `01`, `02`, `03`, which is how a
        // room number is written and what the identifier's third segment
        // reads.
        store.getState().generateSpacesFromWalls(at.modelId, at.storeyId, {
          snapTolerance: SNAP_TOLERANCE,
          namePattern: '{nn}',
        });
        store.getState().setAddElementAutoSpacePreview(null);
      },
      // Three rooms is the whole point of the two dividers; fewer would mean
      // the traced walls did not close, which is worth failing the take over.
      settled: () => authoredCount(getViewerStoreApi(), 'IfcSpace') >= 3,
      settleTimeoutMs: 30_000,
      holdMs: 3600,
    },
    {
      id: 'rooms-named',
      captionDe: 'Büro, Sitzung, Lager – benannt, mit Fläche, und jeder kennt sein Geschoss.',
      captionEn: 'Office, meeting, store - named, with an area, each knowing its storey.',
      worldPoint: [6, 4, 0],
      holdMs: 4400,
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
      holdMs: 3600,
    },
    {
      // The range itself, held long enough to read. Everything placed in the
      // next eight beats comes out of this list, and a viewer who never saw
      // the list reads the placements as drawing rather than as picking.
      id: 'library-range',
      anchor: 'add-element-panel',
      captionDe: 'Eine bereinigte Produktpalette, jedes Gerät mit seinen Daten.',
      captionEn: 'A curated product range, each device with its data.',
      holdMs: 5600,
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
      // Rooms off BEFORE the lens, not after. Coloured by class the rooms get
      // a colour like everything else, and three opaque volumes then stand in
      // front of every device inside them -- the lens showed the argument and
      // hid the evidence for it.
      id: 'rooms-out-of-the-way',
      captionDe: 'Die Raumvolumen weg – sonst verdecken sie genau das, worum es gleich geht.',
      captionEn: 'Room volumes out of the way - they hide exactly what comes next.',
      perform: (store) => {
        if (store.getState().typeVisibility.rooms) store.getState().toggleTypeVisibility('rooms');
      },
      settled: (s) => !s.typeVisibility.rooms,
      settleTimeoutMs: 6000,
      holdMs: 2800,
    },
    {
      id: 'lens',
      anchor: 'activity-lens',
      panel: 'lens',
      captionDe: 'Eine Lens färbt nach Bauteilart – Wand, Tür, Gerät.',
      captionEn: 'A lens colours by element class - wall, door, device.',
      prepare: (store) => store.getState().showWorkspacePanel('lens'),
      perform: (store) => store.getState().setActiveLens('lens-by-class'),
      settled: (s) => s.activeLensId !== null,
      settleTimeoutMs: 6000,
      holdMs: 4200,
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
      perform: (store) => {
        store.getState().showWorkspacePanel('lists');
        // At the default 300 px the table showed a header and two rows, which
        // is not a list -- it is the promise of one.
        store.getState().setBottomPanelHeight(560);
        // And the list has to be ANSWERED, not merely opened. Showing the
        // panel alone left an empty builder on screen, and the two export
        // beats after it had nothing to export -- both timed out, measured.
        store.getState().requestListRun(DEVICE_LIST);
      },
      settled: (s) => s.listPanelVisible && (s.listResult?.rows.length ?? 0) >= PLACEMENTS.length,
      settleTimeoutMs: 20_000,
      holdMs: 5200,
    },
    {
      id: 'list-export-csv',
      panel: 'lists',
      captionDe: 'Und sie verlässt das Werkzeug – als CSV, für die Tabelle daneben.',
      captionEn: 'And it leaves the tool - as CSV, for the spreadsheet next door.',
      perform: (store) => store.getState().requestListExport('csv'),
      // The request is consumed by the table; cleared means it was taken.
      settled: (s) => s.listExportRequested === null,
      settleTimeoutMs: 15_000,
      holdMs: 3200,
    },
    {
      id: 'list-export-xlsx',
      panel: 'lists',
      captionDe: 'Oder als XLSX – mit den Gruppen und Summen, die auf dem Schirm stehen.',
      captionEn: 'Or as XLSX - with the groups and totals that are on the screen.',
      perform: (store) => store.getState().requestListExport('xlsx'),
      settled: (s) => s.listExportRequested === null,
      settleTimeoutMs: 15_000,
      holdMs: 3200,
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
