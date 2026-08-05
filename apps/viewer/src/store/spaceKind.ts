/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Telling the kinds of `IfcSpace` apart for the visibility filter.
 *
 * One toggle for "Spaces" hid three things that are used completely
 * differently: the rooms people work in, the storey-sized volume that carries
 * the gross floor area, and parking bays. Turning spaces on to look at a room
 * also dropped a slab-shaped GFA volume over the whole floor, which is why the
 * toggle was usually just left off.
 *
 * Rooms are the DEFAULT bucket, not the `.SPACE.` bucket. `IfcSpaceTypeEnum`
 * offers BERTH, EXTERNAL, GFA, INTERNAL, PARKING, SPACE, USERDEFINED and
 * NOTDEFINED, and ordinary rooms in real files are usually INTERNAL or
 * NOTDEFINED — our own space builder writes INTERNAL. Matching only `.SPACE.`
 * would leave almost every real room ungrouped, so anything that is not
 * explicitly gross-area or parking counts as a room.
 *
 * Two notes on the enum itself, which the grouping deliberately does not
 * expose:
 *
 *   - `INTERNAL` / `EXTERNAL` are carry-overs from IFC2X3. Inside vs. outside
 *     belongs in `Pset_SpaceCommon.IsExternal` now, so a file still using them
 *     is stating something the modern schema states elsewhere. They land under
 *     Rooms and are NOT named in the group's description: describing the
 *     grouping by a legacy value would teach the wrong thing.
 *   - `BERTH` (a boat berth) is rare enough here that it rides along under
 *     Rooms rather than earning a group of its own.
 */

/** The visibility groups an `IfcSpace` can fall into. */
export type SpaceKind = 'room' | 'storeySpace' | 'parking';

/**
 * Which group a space belongs to, from its `PredefinedType`.
 *
 * Accepts the value with or without STEP dots and in any case, because it
 * arrives from the columnar table in one shape and from a re-parse in another.
 */
export function classifySpace(predefinedType: string | null | undefined): SpaceKind {
  const value = (predefinedType ?? '').replace(/\./g, '').trim().toUpperCase();
  if (value === 'GFA') return 'storeySpace';
  if (value === 'PARKING') return 'parking';
  return 'room';
}

/**
 * Human wording for the group, kept next to the classification so the panel
 * and any report say the same thing.
 */
export const SPACE_KIND_LABEL: Readonly<Record<SpaceKind, string>> = {
  room: 'Rooms',
  storeySpace: 'Storey Spaces',
  parking: 'Parking',
};

export const SPACE_KIND_DESCRIPTION: Readonly<Record<SpaceKind, string>> = {
  room: 'General rooms (IfcSpace)',
  storeySpace: 'One volume per storey, carrying the gross floor area (IfcSpace.GFA)',
  parking: 'Parking spots for vehicles (IfcSpace.PARKING)',
};

/**
 * Per-model index of space express id → kind, built once and cached.
 *
 * A mesh carries no `PredefinedType`, and reading one costs a re-parse of the
 * entity, so resolving it per mesh per frame is out. Spaces are few — tens, not
 * thousands — and the spatial hierarchy already knows exactly which ids they
 * are, so the whole index is a handful of lookups built on first use.
 *
 * Keyed by the parsed store OBJECT, which is created once per load, so a new
 * file gets a fresh index and a re-render does not.
 */
const indexCache = new WeakMap<object, Map<number, SpaceKind>>();

/** Minimal shape needed to build the index, narrowed for testability. */
export interface SpaceKindSource {
  spatialHierarchy?: { bySpace: ReadonlyMap<number, unknown> } | null;
  predefinedTypeOf: (expressId: number) => string | null | undefined;
}

export function buildSpaceKindIndex(source: SpaceKindSource): Map<number, SpaceKind> {
  const index = new Map<number, SpaceKind>();
  for (const expressId of source.spatialHierarchy?.bySpace.keys() ?? []) {
    index.set(expressId, classifySpace(source.predefinedTypeOf(expressId)));
  }
  return index;
}

/** Cached `buildSpaceKindIndex`, keyed by the store it describes. */
export function spaceKindIndexFor(
  store: object | null | undefined,
  build: () => Map<number, SpaceKind>,
): Map<number, SpaceKind> {
  if (!store) return new Map();
  const cached = indexCache.get(store);
  if (cached) return cached;
  const built = build();
  indexCache.set(store, built);
  return built;
}
