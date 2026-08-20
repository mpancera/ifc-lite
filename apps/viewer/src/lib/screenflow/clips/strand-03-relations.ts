/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Strand 3: what the model knows about itself.
 *
 * The claim: the same structure that positions a detector also draws the block
 * schema, and the trigger zones are stated once instead of maintained in a
 * drawing, a list and a schematic separately.
 *
 * # It starts from strand 1's floor, rebuilt
 * `setup` replays the building before the first caption, so the strand opens
 * on a model that demonstrably came out of the earlier strand rather than from
 * a file somebody says is equivalent. The audience never sees the rebuild —
 * showing it is strand 1's job, and doing it twice would be three minutes of
 * the same thing.
 *
 * # Why the block schema can be drawn at all
 * Because a placed device states the room it sits in, and the graph reads the
 * authoring overlay. Both were missing when this strand was first measured:
 * the chain element -> room -> storey produced 54 boxes and not one line. The
 * beats here are the payoff of those two repairs, which is also why the
 * sampling beats come first — the relation is shown on one element before it
 * is relied on for a drawing of all of them.
 *
 * # Trigger zones are `IfcZone`, not `IfcSpatialZone`
 * Decided by what the model can already say: the viewer authors `IfcZone` with
 * an `ObjectType` refinement and `IfcRelAssignsToGroup` members, and the
 * graph's zone chain follows exactly that relationship. `IfcSpatialZone` is a
 * spatial element with a different mechanism, and nothing downstream reads it.
 */

import { propertyRowAnchor } from '@/lib/tours/anchors';
import { getViewerStoreApi } from '@/store';
import { parseIfcZoneKey } from '@/store/slices/ifcZonesSlice';
import { authoredCount, authoredDevices, authoredSpaces, buildDemoBuilding, catalogEntry, placeFromCatalogue, target } from './demo-building';
import type { ScreenflowBeat, ScreenflowClip, ScreenflowStoreApi } from '../types';
import type { IfcStoreyLocalPoint } from '../worldPointer';

/** The property the sampling beats point at: the room a device is contained in. */
const CONTAINED_ROW = propertyRowAnchor('Pset_ConstructionOccurence', 'AssetIdentifier');

/** Three more devices, placed after the first schema is on screen. */
const LATER_PLACEMENTS: ReadonlyArray<{ catalogId: string; at: IfcStoreyLocalPoint }> = [
  { catalogId: 'fire.smoke-detector', at: [3.4, 6.8, 2.7] },
  { catalogId: 'fire.smoke-detector', at: [7.4, 1.6, 2.7] },
  { catalogId: 'fire.heat-detector', at: [10.6, 6.4, 2.7] },
];

/**
 * The trigger zones, and which rooms belong to each.
 *
 * Room indices, not express ids: the rooms are detected at setup time and
 * their ids are whatever the run produced. The order is the detection order,
 * which is stable for a fixed floor.
 */
const ZONES: ReadonlyArray<{ name: string; colour: string; rooms: number[] }> = [
  { name: 'MG 13', colour: '#e11d48', rooms: [0] },
  { name: 'MG 14', colour: '#0ea5e9', rooms: [1, 2] },
];

/**
 * Where the pointer sits while each zone is painted — the middle of its first
 * room, in storey-local metres. Written out rather than derived from the room
 * geometry: a space authored this session has its footprint in the overlay,
 * and reading it back here would make the pointer depend on the very write the
 * beat is still waiting to prove.
 */
const ZONE_POINTS: ReadonlyArray<[number, number, number]> = [
  [2.25, 4, 1.2],
  [6.5, 4, 1.2],
];

/**
 * One beat per zone: create it, then paint its rooms into it.
 *
 * Two beats per zone rather than one, because the interesting half is the
 * second: creating a zone is bookkeeping, deciding which rooms belong in it is
 * the engineering. The brush is left on between them so what the audience sees
 * is the tool being used, not a result appearing.
 */
function paintZoneBeats(): ScreenflowBeat[] {
  const beats: ScreenflowBeat[] = [];
  ZONES.forEach((zone, index) => {
    beats.push({
      id: `zone-${index}-new`,
      anchor: 'activity-zones',
      captionDe: `Eine neue Gruppe: ${zone.name}.`,
      captionEn: `A new group: ${zone.name}.`,
      perform: (store) => {
        const at = target(store);
        if (!at) return;
        const zoneId = store.getState().createIfcZone(at.modelId, {
          name: zone.name,
          colour: zone.colour,
          // `IfcZone` has no PredefinedType; ObjectType is where a refinement
          // can live, and this is what a trigger zone IS.
          objectType: 'TriggerZone',
        });
        if (zoneId === null) return;
        // The brush needs a target, or the next beat's strokes go nowhere.
        store.getState().setActiveIfcZone(at.modelId, zoneId);
        store.getState().setIfcZoneBrushActive(true);
      },
      settled: () => authoredCount(getViewerStoreApi(), 'IfcZone') >= index + 1,
      settleTimeoutMs: 10_000,
      holdMs: 3000,
    });
    beats.push({
      id: `zone-${index}-paint`,
      // Pointed at the first room of the group, in the building rather than at
      // the panel: the click that matters happens on the model.
      worldPoint: ZONE_POINTS[index],
      captionDe: zone.rooms.length === 1
        ? 'Ein Raum hinein – mehr gehört nicht dazu.'
        : 'Zwei Räume hinein – die gehören zusammen.',
      captionEn: zone.rooms.length === 1
        ? 'One room into it - nothing else belongs.'
        : 'Two rooms into it - those belong together.',
      perform: (store) => {
        const at = target(store);
        const parsed = parseIfcZoneKey(store.getState().activeIfcZoneKey);
        if (!at || !parsed) return;
        const rooms = authoredSpaces(store);
        const members = zone.rooms
          .map((i) => rooms[i])
          .filter((id): id is number => id !== undefined);
        if (members.length > 0) store.getState().paintIfcZone(at.modelId, parsed.zoneId, members, 'add');
      },
      settled: (s) => {
        const at = target(getViewerStoreApi());
        if (!at) return false;
        const zones = s.ifcZonesOf(at.modelId);
        return (zones[index]?.memberIds.length ?? 0) >= zone.rooms.length;
      },
      settleTimeoutMs: 10_000,
      holdMs: 4200,
    });
  });
  return beats;
}

/** Total devices once the later three have landed. */
const DEVICES_AFTER = 5 + LATER_PLACEMENTS.length;

function selectDevice(store: ScreenflowStoreApi, index: number): void {
  const expressId = authoredDevices(store)[index];
  const modelId = [...store.getState().models.keys()][0];
  if (expressId === undefined || !modelId) return;
  // The triad, not just the highlight: these are 15 cm devices on a ceiling,
  // and a highlighted one behind a wall looks exactly like a highlighted one
  // two rooms away. Set here rather than in a beat of its own so it holds for
  // every selection this clip makes.
  store.getState().setShowSelectionOrigin(true);
  store.getState().setActiveTool('select');
  store.getState().showWorkspacePanel('properties');
  store.getState().setPropertiesActiveTab('properties');
  store.getState().setSelectedEntity({ modelId, expressId });
  store.getState().setSelectedEntityId(expressId);
}

/** One beat per later placement, so the three additions read as additions. */
function laterPlacementBeats(): ScreenflowBeat[] {
  return LATER_PLACEMENTS.map((placement, i) => ({
    id: `later-${i + 1}`,
    captionDe: i === 0
      ? 'Drei weitere Geräte — nichts am Schema wird dafür angefasst.'
      : 'Und weiter, wie zuvor aus der Bibliothek.',
    captionEn: i === 0
      ? 'Three more devices - and nothing in the schema is touched for them.'
      : 'And on, from the library as before.',
    holdMs: i === 0 ? 3600 : 1300,
    worldPoint: placement.at,
    prepare: (store) => {
      const entry = catalogEntry(placement.catalogId);
      if (entry) store.getState().setAddElementLibrarySelection(entry);
    },
    perform: (store) => placeFromCatalogue(store, placement),
    settled: () => {
      const store = getViewerStoreApi();
      return authoredCount(store, 'IfcSensor') + authoredCount(store, 'IfcAlarm') >= 5 + i + 1;
    },
    settleTimeoutMs: 6000,
  }));
}

/** Draw the block schema: devices, the rooms they are in, the storey above. */
function showBlockSchema(store: ScreenflowStoreApi): void {
  const state = store.getState();
  // `setGraphPanelVisible`, not `showWorkspacePanel('graph')`: the latter's
  // bottom-panel branch sets the script, schedule, list and heights flags and
  // does not know about the graph, so asking it to reveal the graph silently
  // does nothing. Reported rather than patched here — `store/index.ts` is
  // being worked on elsewhere.
  state.setGraphPanelVisible(true);
  state.setGraphChainId('storey');
  state.setGraphStartTypes(['IfcSensor', 'IfcAlarm']);
}

export const STRAND_03_RELATIONS: ScreenflowClip = {
  id: 'strand-03-relations',
  number: 3,
  titleDe: 'Was das Modell über sich weiss',
  titleEn: 'What the model knows about itself',
  messageDe: 'Eine Struktur, mehrere Auswertungen — nichts doppelt gepflegt.',
  messageEn: 'One structure, several readings - nothing maintained twice.',
  version: 1,
  setup: async (store) => { await buildDemoBuilding(store); },
  beats: [
    {
      id: 'title',
      frame: 'card',
      captionDe: 'Das Geschoss aus Strang 1: drei Räume, fünf Geräte.',
      captionEn: 'The floor from strand 1: three rooms, five devices.',
      holdMs: 3400,
    },
    {
      id: 'sample-1',
      anchor: CONTAINED_ROW,
      panel: 'properties',
      captionDe: 'Stichprobe: dieser Melder weiss, in welchem Raum er hängt.',
      captionEn: 'A sample: this detector knows which room it hangs in.',
      prepare: (store) => selectDevice(store, 0),
      settled: (s) => s.selectedEntityId === authoredDevices(getViewerStoreApi())[0],
      settleTimeoutMs: 6000,
      holdMs: 4400,
    },
    {
      id: 'sample-2',
      anchor: CONTAINED_ROW,
      panel: 'properties',
      captionDe: 'Der zweite im selben Raum trägt dieselbe Herkunft – und die 002.',
      captionEn: 'The second one in that room carries the same origin - and the 002.',
      prepare: (store) => selectDevice(store, 1),
      settled: (s) => s.selectedEntityId === authoredDevices(getViewerStoreApi())[1],
      settleTimeoutMs: 6000,
      holdMs: 3600,
    },
    {
      id: 'nothing-more',
      frame: 'card',
      captionDe: 'Mehr als „liegt in diesem Raum" steht nicht drin. Es reicht.',
      captionEn: 'Nothing more than "sits in this room" is recorded. It is enough.',
      holdMs: 3400,
    },
    {
      id: 'block-schema',
      anchor: 'activity-graph',
      panel: 'graph',
      captionDe: 'Daraus fällt das Blockschema: Geräte unter Räumen, Räume unter dem Geschoss.',
      captionEn: 'The block schema falls out: devices under rooms, rooms under the storey.',
      // Panel first, chain and starts second — and in separate phases, not one
      // call. The panel clears its start picks when the model it is looking at
      // changes, and on the frame it first appears that value is still
      // settling; picks made before it were wiped out again a beat later.
      // `schema-again` below has always been split this way and has never
      // failed. Measured: starts went 0 -> 2 on this beat, then 2 -> 0 from
      // GraphPanel on the next.
      prepare: (store) => {
        // At the default 300 px a chain graph shows a row of boxes and the
        // top of the next -- the shape it exists to make visible is cut off.
        store.getState().setBottomPanelHeight(560);
        store.getState().setGraphPanelVisible(true);
      },
      perform: showBlockSchema,
      settled: (s) => s.graphPanelVisible && s.graphChainId === 'storey' && s.graphStartTypes.length > 0,
      settleTimeoutMs: 8000,
      holdMs: 5200,
    },
    ...laterPlacementBeats(),
    {
      id: 'schema-again',
      anchor: 'activity-graph',
      panel: 'graph',
      captionDe: 'Zurück zum Schema – die drei stehen an ihrer Stelle, ohne Zutun.',
      captionEn: 'Back to the schema - the three are in place, with nothing done for them.',
      prepare: (store) => { store.getState().setGraphPanelVisible(true); },
      perform: showBlockSchema,
      settled: () => authoredDevices(getViewerStoreApi()).length >= DEVICES_AFTER,
      settleTimeoutMs: 8000,
      holdMs: 4600,
    },
    {
      // The zones used to be created and filled inside one beat, which meant
      // two of them appeared complete with no visible act in between: the step
      // that carries the whole idea -- a person decides which rooms belong
      // together -- happened in a single frame. Now the brush is picked up
      // first, and each zone is painted room by room.
      id: 'zone-brush',
      anchor: 'activity-zones',
      captionDe: 'Auslösezonen zeichnet man – mit dem Pinsel, Raum für Raum.',
      captionEn: 'Trigger zones are painted - with the brush, room by room.',
      prepare: (store) => {
        const state = store.getState();
        // Rooms back on: they are what gets painted. Strand 1 turned them off
        // so the devices could be seen, and this clip starts from its result.
        if (!state.typeVisibility.rooms) state.toggleTypeVisibility('rooms');
        // And let go of the detector the sample beats left selected. The brush
        // paints whatever is selected, so an armed brush over a device puts a
        // refusal on screen -- "IFC lässt nur Räume zu" -- in the middle of a
        // take. A person picking up a brush is not still holding the last
        // thing they clicked either.
        state.setSelectedEntityId(null);
        state.setSelectedEntity(null);
        state.setActiveTool('zonePaint');
      },
      settled: (s) => s.activeTool === 'zonePaint' && s.typeVisibility.rooms && s.selectedEntityId === null,
      settleTimeoutMs: 8000,
      holdMs: 4200,
    },
    ...paintZoneBeats(),
    {
      id: 'zones-in-the-lens',
      anchor: 'activity-lens',
      panel: 'lens',
      captionDe: 'Und im Modell steht die Zuordnung als Farbe.',
      captionEn: 'And in the model the grouping stands as colour.',
      prepare: (store) => {
        store.getState().setActiveTool('select');
        store.getState().showWorkspacePanel('lens');
      },
      perform: (store) => store.getState().setActiveLens('lens-by-zone'),
      settled: (s) => s.activeLensId === 'lens-by-zone',
      settleTimeoutMs: 8000,
      holdMs: 5200,
    },
    {
      id: 'detection-tree',
      anchor: 'activity-graph',
      panel: 'graph',
      captionDe: 'Und derselbe Bestand nochmal – diesmal nach Auslösezone gelesen.',
      captionEn: 'And the same stock again - read by trigger zone this time.',
      prepare: (store) => { store.getState().setGraphPanelVisible(true); },
      perform: (store) => {
        const state = store.getState();
        state.setGraphChainId('zone');
        state.setGraphStartTypes(['IfcSensor', 'IfcAlarm']);
      },
      settled: (s) => s.graphPanelVisible && s.graphChainId === 'zone' && s.graphStartTypes.length > 0,
      settleTimeoutMs: 8000,
      holdMs: 5200,
    },
    {
      id: 'close',
      frame: 'card',
      captionDe: 'Ein Modell, drei Lesarten: Raum, Geschoss, Auslösezone.',
      captionEn: 'One model, three readings: room, storey, trigger zone.',
      holdMs: 3800,
    },
  ],
};
