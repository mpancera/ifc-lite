/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Zone membership: which rooms belong to which `IfcZone`.
 *
 * The interaction this serves is "paint by numbers" — pick a zone, click the
 * rooms that belong to it, watch a lens colour them. That makes membership a
 * thing the user changes constantly, in both directions, so the model has to
 * make *removal* as cheap as assignment.
 *
 * Hence: **one `IfcRelAssignsToGroup` per zone**, whose `RelatedObjects` array
 * is rewritten in place on every change. The obvious alternative — a fresh
 * relationship per assignment, matching how the element builders emit — reads
 * fine while painting and becomes unusable when unpainting: removing one room
 * would mean finding and editing whichever of a dozen relationships happens to
 * mention it.
 *
 * Naming, deliberately: this module is `ifcZones`, not `zones`. `lib/zones` is
 * the unrelated location-zone feature (viewer-only bounding boxes that never
 * reach IFC). Conflating the two in an import path is exactly how someone ends
 * up writing one and reading the other.
 *
 * Pure — no store, no React. The caller supplies the overlay's entities and
 * applies the plan.
 */

import { parseZoneDescription } from './zoneDisplay.js';

/** An overlay entity as `MutablePropertyView.getNewEntities()` returns it. */
export interface OverlayEntity {
  expressId: number;
  type: string;
  attributes: readonly unknown[];
}

export interface ZoneInfo {
  expressId: number;
  name: string;
  /** What the author wrote in `Description`, without the colour token. */
  description: string;
  /** `#RRGGBB` from the `ZoneDisplay=` token, or `null`. See `zoneDisplay.ts`. */
  colour: string | null;
  /** Refinement, e.g. `'TriggerZone'`. `IfcZone` has no PredefinedType. */
  objectType: string | null;
  /** The `IfcRelAssignsToGroup` carrying membership, or `null` when none yet. */
  relExpressId: number | null;
  /** Express ids of the member spaces, in the order the relationship lists. */
  memberIds: number[];
}

/** `#123` → `123`; anything else → `null`. */
function refId(value: unknown): number | null {
  if (typeof value !== 'string' || !value.startsWith('#')) return null;
  const id = Number(value.slice(1));
  return Number.isFinite(id) ? id : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Read every zone this session authored, with its members.
 *
 * Zones already present in the loaded file are deliberately NOT returned:
 * painting into a grouping somebody else owns would edit the reference model
 * without saying so, which is the same line `findDistributionSystem` draws.
 */
export function readZones(entities: Iterable<OverlayEntity>): ZoneInfo[] {
  const zones = new Map<number, ZoneInfo>();
  const rels: OverlayEntity[] = [];

  for (const entity of entities) {
    if (entity.type === 'IfcZone') {
      // Description carries both the author's text and the zone colour; the
      // two are separated here so no caller has to know the token syntax.
      const described = parseZoneDescription(
        typeof entity.attributes[3] === 'string' ? entity.attributes[3] : null,
      );
      zones.set(entity.expressId, {
        expressId: entity.expressId,
        name: asString(entity.attributes[2]),
        description: described.text,
        colour: described.colour,
        objectType: typeof entity.attributes[4] === 'string' ? entity.attributes[4] : null,
        relExpressId: null,
        memberIds: [],
      });
    } else if (entity.type === 'IfcRelAssignsToGroup') {
      rels.push(entity);
    }
  }

  for (const rel of rels) {
    // (GlobalId, OwnerHistory, Name, Description, RelatedObjects, …, RelatingGroup)
    const groupId = refId(rel.attributes[6]);
    if (groupId === null) continue;
    const zone = zones.get(groupId);
    if (!zone) continue;
    // A zone with several relationships keeps the FIRST as its writable one
    // and merges the rest — a file that arrived that way still reads correctly,
    // and the next write consolidates it.
    const members = Array.isArray(rel.attributes[4])
      ? (rel.attributes[4] as unknown[]).map(refId).filter((id): id is number => id !== null)
      : [];
    if (zone.relExpressId === null) zone.relExpressId = rel.expressId;
    for (const id of members) {
      if (!zone.memberIds.includes(id)) zone.memberIds.push(id);
    }
  }

  return [...zones.values()];
}

/** A zone as it stands in the LOADED FILE, before any of this session's edits. */
export interface ParsedZone {
  readonly expressId: number;
  readonly name: string;
  /** Raw `Description` — the colour token is parsed out here, as for authored ones. */
  readonly description: string | null;
  readonly objectType: string | null;
  readonly memberIds: readonly number[];
}

/**
 * Every zone worth DRAWING: the file's and this session's, merged.
 *
 * Deliberately not {@link readZones}, which returns only what was authored
 * here. That restriction exists so the zone brush cannot paint into somebody
 * else's grouping — a rule about WRITING. Reading is the opposite case: a zone
 * that came in with the file is exactly the thing a fire plan has to draw, and
 * a boundary that appeared only for zones painted in the last ten minutes
 * would be worse than none at all.
 *
 * An id present on both sides is one zone the session has edited: the authored
 * record wins, because it carries the later name, colour and membership.
 */
export function readZonesForDisplay(
  parsed: readonly ParsedZone[],
  authored: readonly ZoneInfo[],
): ZoneInfo[] {
  const byId = new Map<number, ZoneInfo>();
  for (const zone of parsed) {
    const described = parseZoneDescription(zone.description);
    byId.set(zone.expressId, {
      expressId: zone.expressId,
      name: zone.name,
      description: described.text,
      colour: described.colour,
      objectType: zone.objectType,
      // Not ours to rewrite in place; a write would emit its own relationship.
      relExpressId: null,
      memberIds: [...zone.memberIds],
    });
  }
  for (const zone of authored) byId.set(zone.expressId, zone);
  return [...byId.values()];
}

export type PaintMode = 'add' | 'remove' | 'toggle';

export interface MembershipPlan {
  /** The complete member list to write, or `null` when nothing changes. */
  members: number[] | null;
  added: number[];
  removed: number[];
}

/**
 * What painting `spaceIds` onto a zone would make its member list.
 *
 * Returns the WHOLE list rather than a delta, because that is what gets
 * written: one relationship, one array, rewritten in place.
 *
 * `toggle` decides per space, which is what a brush that both paints and
 * unpaints needs — clicking a room already in the zone takes it out.
 */
export function planMembership(
  current: readonly number[],
  spaceIds: readonly number[],
  mode: PaintMode,
): MembershipPlan {
  const members = [...current];
  const added: number[] = [];
  const removed: number[] = [];

  for (const id of spaceIds) {
    const at = members.indexOf(id);
    const shouldRemove = mode === 'remove' || (mode === 'toggle' && at >= 0);
    if (shouldRemove) {
      if (at >= 0) { members.splice(at, 1); removed.push(id); }
    } else if (at < 0) {
      members.push(id);
      added.push(id);
    }
  }

  if (added.length === 0 && removed.length === 0) {
    return { members: null, added, removed };
  }
  return { members, added, removed };
}

/**
 * The zone a space currently belongs to, or `null`.
 *
 * A space in several zones reports the first — the painting UI treats zones as
 * exclusive, and silently showing one of two would be less confusing than
 * showing neither. Callers that care can read `readZones` directly.
 */
export function zoneOfSpace(zones: readonly ZoneInfo[], spaceId: number): ZoneInfo | null {
  for (const zone of zones) {
    if (zone.memberIds.includes(spaceId)) return zone;
  }
  return null;
}
