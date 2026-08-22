/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The parts of a schematic that only the STEP text can answer.
 *
 * The columnar store is built for the questions a viewer asks constantly —
 * what is this, what is it called, what is it related to — and it answers them
 * from indices. Three questions a schematic asks fall outside that, and all
 * three need the source buffer re-read:
 *
 *  - **Which decomposition edges are nesting?** The parser folds `IfcRelNests`
 *    into the `Aggregates` bucket on purpose, so an IDS `partOf` check
 *    traverses either. A drawing cannot afford the merge — see
 *    {@link buildNestsIndex}.
 *  - **What makes this connection?** `IfcRelConnectsPorts.RealizingElement` is
 *    the cable, and `getRelated` answers ids, not payload.
 *  - **What kind of device is this?** `PredefinedType`, `FlowDirection`,
 *    `SystemType` — the enum slots that separate a fire detector from a
 *    thermostat and a supply port from a load.
 *
 * Kept out of `storeSource.ts` because the seam is real: everything here reads
 * raw STEP and returns `null` or an empty answer when there is none to read,
 * and everything there composes the parse with the authoring overlay. A store
 * rebuilt from the geometry cache carries no source text — every function here
 * degrades to a documented fallback rather than throwing, because a cached
 * model still has to draw.
 */

import type { IfcAttributeValue } from '@ifc-lite/data';
import {
  EntityExtractor,
  extractAllEntityAttributes,
  getAttributeNames,
  type IfcDataStore,
} from '@ifc-lite/parser';
import type { GraphEdgeInfo, GraphNodeTraits } from '@ifc-lite/graph';
import type { NewEntity } from '@ifc-lite/mutations';
import { RELATION_ROLES } from '@/lib/mutations/overlayRelationIndex';

/**
 * Every express id in one attribute slot, whichever shape it arrives in.
 *
 * `refIds` in `overlayRelationIndex.ts` cannot serve here, and the difference
 * is easy to miss because both sides call the same thing an attribute list.
 * The authoring overlay keeps references as STEP text — `'#42'` — because that
 * is what gets serialised. `EntityExtractor` has already resolved them, and
 * hands back the bare number `42`. A reader written against one shape finds
 * NOTHING on the other, silently: it returns an empty list, which is
 * indistinguishable from a relationship that genuinely relates nothing.
 *
 * Both shapes are accepted here, single or in a list, so this stays true if the
 * extractor's representation ever changes.
 */
function referencedIds(value: unknown): number[] {
  const one = (entry: unknown): number | null => {
    if (typeof entry === 'number') return Number.isFinite(entry) ? entry : null;
    if (typeof entry === 'string' && entry.startsWith('#')) {
      const id = Number(entry.slice(1));
      return Number.isFinite(id) ? id : null;
    }
    return null;
  };
  if (Array.isArray(value)) {
    const out: number[] = [];
    for (const entry of value) {
      const id = one(entry);
      if (id !== null) out.push(id);
    }
    return out;
  }
  const single = one(value);
  return single === null ? [] : [single];
}

/** What these readers need of a store — deliberately less than `IfcDataStore`. */
export interface RawReadableStore {
  entityIndex: { byType: Iterable<[string, number[]]> };
  source?: unknown;
}

/**
 * The store as a raw reader, or `null` when it has no source text.
 *
 * One narrowing in one place, so a caller either gets a reader or knows it has
 * to do without. Checking per call site is how half the fallbacks end up
 * missing.
 */
function rawStoreOf(store: RawReadableStore): IfcDataStore | null {
  const candidate = store as unknown as IfcDataStore;
  if (!candidate.source) return null;
  if (!candidate.entityIndex?.byId) return null;
  return candidate;
}

/**
 * Every express id of one raw STEP type token.
 *
 * `entityIndex.byType` is keyed by the file's own spelling, which is uppercase
 * in every producer seen so far but is not guaranteed to be, so the comparison
 * is case-folded rather than a `Map.get`.
 */
function idsOfStepType(store: RawReadableStore, stepType: string): readonly number[] {
  for (const [name, ids] of store.entityIndex.byType) {
    if (name.toUpperCase() === stepType) return ids;
  }
  return [];
}

/**
 * One relationship entity's attribute list, straight out of the STEP text.
 *
 * `extractAllEntityAttributes` cannot serve here: it flattens every slot to a
 * scalar, and `RelatedObjects` is a LIST of references — exactly the slot that
 * has to survive.
 */
function relAttributes(
  raw: IfcDataStore,
  extractor: EntityExtractor,
  expressId: number,
): readonly IfcAttributeValue[] | null {
  const ref = raw.entityIndex.byId.get(expressId);
  if (!ref) return null;
  return extractor.extractEntity(ref)?.attributes ?? null;
}

/** `relating>related`, the key both indices below are built on. */
export function pairKey(from: number, to: number): string {
  return `${from}>${to}`;
}

function pushInto(map: Map<number, number[]>, key: number, value: number): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/**
 * `IfcRelNests`, indexed both ways and separable from `IfcRelAggregates`.
 *
 * `excluded` is the other half of the job. The store's `Aggregates` bucket
 * holds BOTH relationships; knowing exactly which pairs came from nesting is
 * what lets `IfcRelAggregates` be asked for and answer with aggregation alone.
 * Without it, giving one relation its true meaning would have quietly taken
 * the other's away — a storey's decomposition and a pump's ports would still
 * be one indistinguishable set, just under a different name.
 */
export interface NestsIndex {
  forward: Map<number, number[]>;
  inverse: Map<number, number[]>;
  /** Every nesting pair as `relating>related`, to subtract from Aggregates. */
  excluded: Set<string>;
}

/**
 * Index the file's `IfcRelNests`, or `null` when the source text is gone.
 *
 * The pass covers the `IFCRELNESTS` entities only — hundreds in a plant model,
 * not the whole file — and runs once per graph build, beside the type indexing
 * that already happens there.
 *
 * A file with no nesting at all returns an EMPTY index, not `null`: that is a
 * real answer, and it makes the subtraction a no-op instead of a fallback.
 */
export function buildNestsIndex(store: RawReadableStore): NestsIndex | null {
  const raw = rawStoreOf(store);
  if (!raw) return null;

  const index: NestsIndex = { forward: new Map(), inverse: new Map(), excluded: new Set() };
  const ids = idsOfStepType(store, 'IFCRELNESTS');
  if (ids.length === 0) return index;

  const roles = RELATION_ROLES.IfcRelNests;
  const extractor = new EntityExtractor(raw.source);
  for (const relId of ids) {
    const attributes = relAttributes(raw, extractor, relId);
    if (!attributes) continue;
    for (const from of referencedIds(attributes[roles.relating])) {
      for (const to of referencedIds(attributes[roles.related])) {
        pushInto(index.forward, from, to);
        pushInto(index.inverse, to, from);
        index.excluded.add(pairKey(from, to));
      }
    }
  }
  return index;
}

/** `Name` sits at slot 2 on every `IfcRoot`; `RealizingElement` at 6 on this one. */
const REL_NAME_INDEX = 2;
const REALIZING_ELEMENT_INDEX = 6;

/**
 * What every `IfcRelConnectsPorts` carries besides the two ends it joins.
 *
 * Keyed by the UNORDERED pair, because the relationship is unordered: which
 * port a producer wrote as `RelatingPort` is an authoring artifact, and a
 * lookup that respected it would find the cable for half the connections and
 * nothing for the other half — the same class of bug `symmetricEdgeId` exists
 * to prevent in the graph package.
 *
 * `RealizingElement` is the slot that matters. It names the CABLE that makes
 * the joint, which is the whole difference between "these two devices are
 * connected" and a wiring list somebody can work from.
 *
 * Connections carrying neither a name nor a realizing element are left out
 * entirely, so the map's size is the number of connections that actually say
 * something rather than the number that exist.
 */
export function buildPortConnectionInfo(store: RawReadableStore): Map<string, GraphEdgeInfo> {
  const info = new Map<string, GraphEdgeInfo>();
  const raw = rawStoreOf(store);
  if (!raw) return info;

  const ids = idsOfStepType(store, 'IFCRELCONNECTSPORTS');
  if (ids.length === 0) return info;

  const roles = RELATION_ROLES.IfcRelConnectsPorts;
  const extractor = new EntityExtractor(raw.source);
  for (const relId of ids) {
    const attributes = relAttributes(raw, extractor, relId);
    if (!attributes) continue;
    const [from] = referencedIds(attributes[roles.relating]);
    const [to] = referencedIds(attributes[roles.related]);
    if (from === undefined || to === undefined) continue;

    const rawName = attributes[REL_NAME_INDEX];
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const [realizedBy] = referencedIds(attributes[REALIZING_ELEMENT_INDEX]);
    if (!name && realizedBy === undefined) continue;

    const entry: GraphEdgeInfo = {
      ...(name ? { name } : {}),
      ...(realizedBy !== undefined ? { realizedBy } : {}),
    };
    info.set(pairKey(from, to), entry);
    info.set(pairKey(to, from), entry);
  }
  return info;
}

/**
 * The enum slots a schematic reads, and the `GraphNodeTraits` field each fills.
 *
 * Read by NAME on both the parsed and the authored path, never by position:
 * `PredefinedType` is slot 8 on an `IfcSensor` and slot 9 on an
 * `IfcDistributionPort`, so a hand-counted index is a bug waiting for the first
 * model that holds both — which is every plant model.
 */
const TRAIT_SLOTS = [
  ['PredefinedType', 'predefinedType'],
  ['FlowDirection', 'flowDirection'],
  ['SystemType', 'systemType'],
] as const satisfies ReadonlyArray<readonly [string, keyof GraphNodeTraits]>;

/** `.FIRESENSOR.` → `FIRESENSOR`. STEP writes enums dotted. */
function undot(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('.') && trimmed.endsWith('.') ? trimmed.slice(1, -1) : trimmed;
}

/**
 * The enum slots of a parsed entity, or `null` when there is no source to read.
 *
 * Costs one re-parse of the entity — the same cost class as
 * `resolveEntityPredefinedType` and the property auto-colour sources already
 * pay — and is charged once per node in a drawing, not once per element in the
 * model.
 */
export function readParsedTraits(
  store: RawReadableStore,
  expressId: number,
): GraphNodeTraits | null {
  const raw = rawStoreOf(store);
  if (!raw) return null;
  const attributes = extractAllEntityAttributes(raw, expressId);
  if (attributes.length === 0) return null;

  const traits: GraphNodeTraits = {};
  for (const [attributeName, field] of TRAIT_SLOTS) {
    const found = attributes.find((a) => a.name === attributeName);
    if (!found) continue;
    // The extractor already strips the enum markers; `undot` is a no-op here
    // and is applied anyway so the two paths cannot drift apart.
    const value = undot(String(found.value));
    if (value) traits[field] = value;
  }
  return traits;
}

/**
 * The enum slots of an entity this session created.
 *
 * Separate from the parsed path because a `NewEntity` is not in the file at
 * all: asking the parse for it answers nothing, which reads as "this detector
 * has no PredefinedType" for exactly the elements the user just placed.
 */
export function readAuthoredTraits(entity: NewEntity): GraphNodeTraits {
  const names = getAttributeNames(entity.type);
  const traits: GraphNodeTraits = {};
  for (const [attributeName, field] of TRAIT_SLOTS) {
    const at = names.indexOf(attributeName);
    if (at < 0) continue;
    const value = entity.attributes[at];
    if (typeof value !== 'string') continue;
    const cleaned = undot(value);
    if (cleaned) traits[field] = cleaned;
  }
  return traits;
}
