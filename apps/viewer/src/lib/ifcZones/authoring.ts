/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Writing zones: create one, colour it, paint rooms into it, delete it.
 *
 * The counterpart to `membership.ts`, which only reads. Everything here takes a
 * `StoreEditor` and returns what changed, so the store slice above it stays a
 * thin wrapper that does undo bookkeeping and nothing else — and so the actual
 * IFC rules are testable without a React tree or a Zustand store.
 *
 * The one rule worth restating: **one `IfcRelAssignsToGroup` per zone**, whose
 * `RelatedObjects` array is rewritten in place. See `membership.ts` for why
 * (unpainting a room has to be as cheap as painting it).
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { addZoneToStore, emitRelAssignsToGroup } from '@ifc-lite/create';
import { planMembership, readZones, type OverlayEntity, type PaintMode, type ZoneInfo } from './membership.js';
import { formatZoneDescription } from './zoneDisplay.js';

/** Positional attribute indices we write. Named so the calls read. */
const ZONE_DESCRIPTION = 3;
const ZONE_NAME = 2;
const REL_RELATED_OBJECTS = 4;

export interface CreateZoneParams {
  name: string;
  /** Free text the author wrote. The colour is appended to it, not into it. */
  description?: string;
  /** `#RRGGBB`, or `null` for a zone with no colour of its own. */
  colour?: string | null;
  /** `IfcZone` has no PredefinedType, so a refinement lives here. */
  objectType?: string | null;
}

/**
 * Create an `IfcZone` with no members yet.
 *
 * The colour is folded into `Description` here rather than by the caller, so
 * there is exactly one place that knows the token syntax.
 */
export function createZone(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  params: CreateZoneParams,
): number {
  const description = formatZoneDescription(params.description ?? '', params.colour ?? null);
  return addZoneToStore(editor, ownerHistoryId, {
    Name: params.name,
    Description: description || undefined,
    ObjectType: params.objectType ?? undefined,
  }).zoneId;
}

/**
 * Recolour a zone, keeping whatever the author wrote in `Description`.
 *
 * Returns `false` when the zone is not an authored one — a zone that came in
 * with the file is somebody else's, and silently rewriting its description is
 * the kind of edit that shows up in a diff nobody expected.
 */
export function setZoneColour(
  editor: StoreEditor,
  entities: Iterable<OverlayEntity>,
  zoneId: number,
  colour: string | null,
): boolean {
  const zone = findAuthoredZone(entities, zoneId);
  if (!zone) return false;

  const next = formatZoneDescription(zone.description, colour);
  editor.setPositionalAttribute(zoneId, ZONE_DESCRIPTION, next || null);
  return true;
}

/** Rename a zone. Same authored-only rule as {@link setZoneColour}. */
export function setZoneName(
  editor: StoreEditor,
  entities: Iterable<OverlayEntity>,
  zoneId: number,
  name: string,
): boolean {
  if (!findAuthoredZone(entities, zoneId)) return false;
  editor.setPositionalAttribute(zoneId, ZONE_NAME, name);
  return true;
}

/**
 * Set the author's text, keeping the colour token attached.
 *
 * Splitting this from {@link setZoneColour} means the panel can offer a plain
 * description field without the author ever seeing `ZoneDisplay=`.
 */
export function setZoneDescription(
  editor: StoreEditor,
  entities: Iterable<OverlayEntity>,
  zoneId: number,
  text: string,
): boolean {
  const zone = findAuthoredZone(entities, zoneId);
  if (!zone) return false;

  const next = formatZoneDescription(text, zone.colour);
  editor.setPositionalAttribute(zoneId, ZONE_DESCRIPTION, next || null);
  return true;
}

export interface PaintResult {
  added: number[];
  removed: number[];
  /** The relationship that now carries membership. */
  relExpressId: number;
  /** True when this stroke had to create the relationship. */
  createdRelationship: boolean;
}

/**
 * Paint rooms into a zone — or out of it.
 *
 * Returns `null` when nothing changed, which is the common case for a brush
 * dragged across a room it already covered. Callers rely on that to avoid
 * pushing an undo step and dirtying the model for a no-op.
 */
export function paintZone(
  editor: StoreEditor,
  entities: Iterable<OverlayEntity>,
  ownerHistoryId: number | null,
  zoneId: number,
  spaceIds: readonly number[],
  mode: PaintMode,
): PaintResult | null {
  const zone = findAuthoredZone(entities, zoneId);
  if (!zone) return null;

  const plan = planMembership(zone.memberIds, spaceIds, mode);
  if (plan.members === null) return null;

  if (zone.relExpressId === null) {
    // First stroke: the relationship does not exist yet. Removing from a zone
    // that has no members can't get here — `planMembership` reports no change.
    const relExpressId = emitRelAssignsToGroup(editor, ownerHistoryId, plan.members, zoneId);
    return { added: plan.added, removed: plan.removed, relExpressId, createdRelationship: true };
  }

  editor.setPositionalAttribute(
    zone.relExpressId,
    REL_RELATED_OBJECTS,
    plan.members.map((id) => `#${id}`),
  );
  return {
    added: plan.added,
    removed: plan.removed,
    relExpressId: zone.relExpressId,
    createdRelationship: false,
  };
}

/**
 * Delete a zone and the relationship carrying its membership.
 *
 * The member rooms are untouched — they exist independently of the grouping,
 * which is exactly the difference between an `IfcZone` and a spatial container.
 * Returns the express ids that were removed, empty when the zone was not ours.
 */
export function deleteZone(
  editor: StoreEditor,
  entities: Iterable<OverlayEntity>,
  zoneId: number,
): number[] {
  const zone = findAuthoredZone(entities, zoneId);
  if (!zone) return [];

  const removed: number[] = [];
  if (zone.relExpressId !== null && editor.removeEntity(zone.relExpressId)) {
    removed.push(zone.relExpressId);
  }
  if (editor.removeEntity(zoneId)) removed.push(zoneId);
  return removed;
}

/**
 * A suggested colour for the next zone: the first palette entry no zone uses.
 *
 * Falls back to cycling once the palette is exhausted, so creating zone number
 * nine still produces something rather than nothing.
 */
export function nextZoneColour(
  zones: readonly ZoneInfo[],
  palette: readonly string[],
): string | null {
  if (palette.length === 0) return null;
  const taken = new Set(zones.map((z) => z.colour).filter((c): c is string => c !== null));
  const free = palette.find((c) => !taken.has(c.toUpperCase()) && !taken.has(c));
  return free ?? palette[zones.length % palette.length];
}

/** The authored zone with this express id, or `null`. */
function findAuthoredZone(entities: Iterable<OverlayEntity>, zoneId: number): ZoneInfo | null {
  return readZones(entities).find((z) => z.expressId === zoneId) ?? null;
}
