/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Every `IfcRelContainedInSpatialStructure` in a model, as it stands NOW.
 *
 * Three places have to agree before a move can be planned, and they disagree
 * about almost everything:
 *
 *  - the parsed file, where a reference is a bare express id;
 *  - entities authored this session, where a reference is a `#123` string,
 *    because that is the form `StoreEditor.addEntity` takes;
 *  - positional overrides, which are how an EARLIER move rewrote a parsed
 *    relationship's element list — without them a second move in the same
 *    session plans against the file as it was loaded and undoes the first.
 *
 * Reading them into one shape here is what lets `planStoreyMove` be a pure
 * function of ids.
 */

import type { ContainmentRel } from './plan-storey-move.js';

/** `IfcRelContainedInSpatialStructure` attribute slots. */
export const RELATED_ELEMENTS = 4;
export const RELATING_STRUCTURE = 5;

export const CONTAINMENT_TYPE = 'IfcRelContainedInSpatialStructure';

interface EntityLike {
  expressId: number;
  attributes?: readonly unknown[] | null;
}

export interface ContainmentSource {
  /** Parsed `IfcRelContainedInSpatialStructure` entities. */
  parsed: Iterable<EntityLike>;
  /** Overlay entities created this session, of any type. */
  authored: Iterable<EntityLike & { type?: string }>;
  /** Positional overrides for an entity, index → value, or null when none. */
  positionalOf?: (expressId: number) => ReadonlyMap<number, unknown> | null | undefined;
}

/** An express id out of a reference in either notation, or `null`. */
export function asRef(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    const m = /^#(\d+)$/.exec(value.trim());
    return m ? Number(m[1]) : null;
  }
  return null;
}

function refList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const id = asRef(item);
    if (id !== null) out.push(id);
  }
  return out;
}

export function readContainmentRels(source: ContainmentSource): ContainmentRel[] {
  const out: ContainmentRel[] = [];
  const seen = new Set<number>();

  const take = (entity: EntityLike) => {
    if (seen.has(entity.expressId)) return;
    const overrides = source.positionalOf?.(entity.expressId) ?? null;
    const attrs = entity.attributes ?? [];
    const rawElements = overrides?.has(RELATED_ELEMENTS)
      ? overrides.get(RELATED_ELEMENTS)
      : attrs[RELATED_ELEMENTS];
    const rawStructure = overrides?.has(RELATING_STRUCTURE)
      ? overrides.get(RELATING_STRUCTURE)
      : attrs[RELATING_STRUCTURE];
    const structureId = asRef(rawStructure);
    if (structureId === null) return;
    seen.add(entity.expressId);
    out.push({ expressId: entity.expressId, structureId, elementIds: refList(rawElements) });
  };

  for (const entity of source.parsed) take(entity);
  // Authored second, and by id, so a relationship that exists in both halves is
  // read once — from the parsed entity, whose overrides carry the later state.
  for (const entity of source.authored) {
    if (entity.type === CONTAINMENT_TYPE) take(entity);
  }
  return out;
}
