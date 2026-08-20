/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The building the series is demonstrated on, and the handful of moves that
 * bring it into existence.
 *
 * # Why this is shared rather than repeated
 * Strand 1 builds this floor beat by beat, because watching it appear IS that
 * strand's argument. Every strand after it needs the same floor already
 * standing — and a second copy of the geometry would drift the first time a
 * wall moved, leaving strand 3 talking about rooms that strand 1 never made.
 * So the coordinates live here once, and a later strand replays them in its
 * `setup` without beats.
 *
 * # Replayed, not loaded from a file
 * The alternative was a prepared IFC per strand. Replaying is better on two
 * counts: there is nothing to regenerate when the geometry changes, and the
 * later strands start from a model that demonstrably came out of the earlier
 * ones rather than from a file somebody says is equivalent.
 *
 * The drawing under strand 1 (`demo-plan.dxf`) is generated from `WALLS` by
 * `tools/screenflow/make-demo-plan.mjs`, so the traced walls land on it.
 */

import { LocalSeedCatalogProvider, type CatalogEntry } from '@/lib/catalog';
import { EDITOR_ROLE_ID } from '@/lib/roles/disciplineRoles';
import { EVENT_LOAD_FILE } from '@/lib/tours/events';
import { createBlankIfcFile } from '@/utils/createBlankIfc';
import { modelsSettled } from '../model-lookup';
import type { ScreenflowStoreApi } from '../types';
import type { IfcStoreyLocalPoint } from '../worldPointer';

/** Wall axes in storey-local metres — the same list the DXF is drawn from. */
export const WALLS: ReadonlyArray<{ start: IfcStoreyLocalPoint; end: IfcStoreyLocalPoint; name: string }> = [
  { start: [0, 0, 0], end: [12, 0, 0], name: 'Aussenwand Sued' },
  { start: [12, 0, 0], end: [12, 8, 0], name: 'Aussenwand Ost' },
  { start: [12, 8, 0], end: [0, 8, 0], name: 'Aussenwand Nord' },
  { start: [0, 8, 0], end: [0, 0, 0], name: 'Aussenwand West' },
  { start: [4.5, 0, 0], end: [4.5, 8, 0], name: 'Trennwand 1' },
  { start: [8.5, 0, 0], end: [8.5, 8, 0], name: 'Trennwand 2' },
];

export const WALL_THICKNESS = 0.2;
export const WALL_HEIGHT = 2.8;
/** 1.0 m, not the 0.1 default: at a real building the default finds nothing at
 *  all, because thick walls never meet exactly on axis. */
export const SNAP_TOLERANCE = 1.0;

/**
 * Two doors, one per divider, so all three rooms connect.
 *
 * `along` is the direction the leaf runs, and it is not optional in practice:
 * both dividers run north-south, and a door built without it lies along the
 * placement's X axis — square ACROSS its wall rather than in it. It is the
 * divider's own direction, written out rather than derived, so the drawing,
 * the wall and the door cannot disagree about which way that wall goes.
 */
export const DOORS: ReadonlyArray<{
  at: IfcStoreyLocalPoint;
  along: [number, number, number];
  name: string;
}> = [
  { at: [4.5, 4, 0], along: [0, 1, 0], name: 'Tuer Buero-Sitzung' },
  { at: [8.5, 4, 0], along: [0, 1, 0], name: 'Tuer Sitzung-Lager' },
];

/**
 * Five placements across the three rooms, named by CATALOGUE ENTRY.
 *
 * Only the id and the position live here. What the element is — its IFC class,
 * its predefined type, its size, its technical data — comes from the catalogue
 * at placement time, because that is the argument the placing beats make:
 * these are products off a maintained range, not shapes the demo invented.
 *
 * Four kinds in five placements, with two of one kind in one room: the counter
 * in the identifier rule is scoped per room and type, so that pair is what
 * shows 001 and 002.
 */
export const PLACEMENTS: ReadonlyArray<{ catalogId: string; at: IfcStoreyLocalPoint }> = [
  { catalogId: 'fire.smoke-detector', at: [2.2, 5.4, 2.7] },
  { catalogId: 'fire.smoke-detector', at: [2.2, 2.2, 2.7] },
  { catalogId: 'fire.manual-call-point', at: [4.9, 3.4, 1.4] },
  { catalogId: 'fire.siren', at: [6.5, 7.7, 2.3] },
  { catalogId: 'fire.heat-detector', at: [10.2, 4.0, 2.7] },
];

/** The catalogue the demo places from, read without a React hook. */
const catalogue = new LocalSeedCatalogProvider();

export function catalogEntry(catalogId: string): CatalogEntry | null {
  const entries = catalogue.listEntries();
  return Array.isArray(entries) ? entries.find((e) => e.id === catalogId) ?? null : null;
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

/** Express ids of the devices this session created, in creation order. */
export function authoredDevices(store: ScreenflowStoreApi): number[] {
  const state = store.getState();
  const modelId = [...state.models.keys()][0];
  const view = modelId ? state.mutationViews.get(modelId) : undefined;
  if (!view) return [];
  const devices: number[] = [];
  for (const entity of view.getNewEntities()) {
    if ((entity.type === 'IfcSensor' || entity.type === 'IfcAlarm') && !view.isDeleted(entity.expressId)) {
      devices.push(entity.expressId);
    }
  }
  return devices;
}

/** Express ids of the rooms this session created, in creation order. */
export function authoredSpaces(store: ScreenflowStoreApi): number[] {
  const state = store.getState();
  const modelId = [...state.models.keys()][0];
  const view = modelId ? state.mutationViews.get(modelId) : undefined;
  if (!view) return [];
  const spaces: number[] = [];
  for (const entity of view.getNewEntities()) {
    if (entity.type === 'IfcSpace' && !view.isDeleted(entity.expressId)) spaces.push(entity.expressId);
  }
  return spaces;
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
export function makeEditable(store: ScreenflowStoreApi): void {
  const state = store.getState();
  state.setActiveDisciplineSystemId(EDITOR_ROLE_ID);
  const modelId = [...state.models.keys()][0];
  if (modelId) state.ensureMutationView(modelId);
}

/** The demo project has exactly one model and one storey; both are the first. */
export function target(store: ScreenflowStoreApi): { modelId: string; storeyId: number } | null {
  const state = store.getState();
  const [modelId, model] = [...state.models.entries()][0] ?? [];
  const ids = model?.ifcDataStore?.entityIndex?.byType?.get('IFCBUILDINGSTOREY');
  if (!modelId || !ids || ids.length === 0) return null;
  return { modelId, storeyId: ids[0] };
}

/** Place one catalogue product. Shared so both the beat and the replay agree. */
export function placeFromCatalogue(
  store: ScreenflowStoreApi,
  placement: { catalogId: string; at: IfcStoreyLocalPoint },
): void {
  const at = target(store);
  const entry = catalogEntry(placement.catalogId);
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
    CatalogEntryTag: entry.tag,
    TechnicalData: entry.technicalData,
  });
}

function waitFor(store: ScreenflowStoreApi, ready: () => boolean, timeoutMs: number): Promise<boolean> {
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => { unsub(); resolve(false); }, timeoutMs);
    const unsub = store.subscribe(() => {
      if (!ready()) return;
      window.clearTimeout(timer);
      unsub();
      resolve(true);
    });
  });
}

/**
 * Build the whole floor without beats, for a strand that starts from it.
 *
 * Runs in a clip's `setup`, before the first caption, so the audience never
 * sees it happen — the strand that shows this being built is strand 1, and
 * repeating it would be the same three minutes twice.
 *
 * Returns false when the model never arrived; the caller's first beat then
 * fails its own proof, which is where it should surface.
 */
export async function buildDemoBuilding(store: ScreenflowStoreApi): Promise<boolean> {
  // The same names strand 1 traces by hand, so both clips produce identical
  // asset identifiers and a viewer moving between them sees one building.
  window.dispatchEvent(new CustomEvent(EVENT_LOAD_FILE, {
    detail: createBlankIfcFile({
      projectName: 'Musterbau',
      buildingName: 'A',
      storeyName: '01',
      storeyLongName: '1. Obergeschoss',
    }),
  }));
  if (!await waitFor(store, () => modelsSettled(store.getState(), 1), 60_000)) return false;

  makeEditable(store);
  const at = target(store);
  if (!at) return false;

  for (const wall of WALLS) {
    store.getState().addWall(at.modelId, at.storeyId, {
      Start: [...wall.start] as [number, number, number],
      End: [...wall.end] as [number, number, number],
      Thickness: WALL_THICKNESS,
      Height: WALL_HEIGHT,
      Name: wall.name,
    });
  }
  for (const door of DOORS) {
    store.getState().addDoor(at.modelId, at.storeyId, {
      Position: [...door.at] as [number, number, number],
      Width: 1,
      Height: 2.1,
      Name: door.name,
    });
  }
  store.getState().generateSpacesFromWalls(at.modelId, at.storeyId, {
    snapTolerance: SNAP_TOLERANCE,
    namePattern: '{nn}',
  });
  if (!await waitFor(store, () => authoredCount(store, 'IfcSpace') >= 3, 30_000)) return false;

  for (const placement of PLACEMENTS) placeFromCatalogue(store, placement);
  return authoredDevices(store).length === PLACEMENTS.length;
}
