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

/** Total devices once the later three have landed. */
const DEVICES_AFTER = 5 + LATER_PLACEMENTS.length;

function selectDevice(store: ScreenflowStoreApi, index: number): void {
  const expressId = authoredDevices(store)[index];
  const modelId = [...store.getState().models.keys()][0];
  if (expressId === undefined || !modelId) return;
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
  state.showWorkspacePanel('graph');
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
      prepare: showBlockSchema,
      settled: (s) => s.graphStartTypes.length > 0 && s.graphChainId === 'storey',
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
      prepare: (store) => { store.getState().showWorkspacePanel('graph'); },
      perform: showBlockSchema,
      settled: () => authoredDevices(getViewerStoreApi()).length >= DEVICES_AFTER,
      settleTimeoutMs: 8000,
      holdMs: 4600,
    },
    {
      id: 'zones',
      anchor: 'activity-zones',
      panel: 'zones',
      captionDe: 'Jetzt die Auslösezonen: zwei Meldergruppen, je mit ihrer Nummer.',
      captionEn: 'Now the trigger zones: two detection groups, each with its number.',
      prepare: (store) => { store.getState().showWorkspacePanel('zones'); },
      perform: (store) => {
        const at = target(store);
        if (!at) return;
        const rooms = authoredSpaces(store);
        for (const zone of ZONES) {
          const zoneId = store.getState().createIfcZone(at.modelId, {
            name: zone.name,
            colour: zone.colour,
            // `IfcZone` has no PredefinedType; ObjectType is where a
            // refinement can live, and this is what a trigger zone IS.
            objectType: 'TriggerZone',
          });
          if (zoneId === null) continue;
          const members = zone.rooms.map((i) => rooms[i]).filter((id): id is number => id !== undefined);
          if (members.length > 0) store.getState().paintIfcZone(at.modelId, zoneId, members, 'add');
        }
      },
      settled: () => authoredCount(getViewerStoreApi(), 'IfcZone') >= ZONES.length,
      settleTimeoutMs: 10_000,
      holdMs: 4200,
    },
    {
      id: 'detection-tree',
      anchor: 'activity-graph',
      panel: 'graph',
      captionDe: 'Und derselbe Bestand nochmal – diesmal nach Auslösezone gelesen.',
      captionEn: 'And the same stock again - read by trigger zone this time.',
      prepare: (store) => { store.getState().showWorkspacePanel('graph'); },
      perform: (store) => {
        const state = store.getState();
        state.setGraphChainId('zone');
        state.setGraphStartTypes(['IfcSensor', 'IfcAlarm']);
      },
      settled: (s) => s.graphChainId === 'zone' && s.graphStartTypes.length > 0,
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
