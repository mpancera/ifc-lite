/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Is the assignment of rooms to zones FINISHED, and how big is each zone.
 *
 * The brush answers "put this room in that zone". This answers the two
 * questions that follow, and neither can be read off the model by looking at
 * it:
 *
 * - **How large is the zone.** A Brandabschnitt is formed from the usage, the
 *   resulting total area and the resulting escape route lengths (IG BIM&BS
 *   Arbeitspapier, 6.1). The area is the one of those three the model can
 *   answer today, and it is the number that decides whether a compartment is
 *   admissible. The panel used to show a room COUNT, which decides nothing.
 * - **Which rooms have none yet.** Assignment by hand is done room by room,
 *   and the failure is always the same: a room nobody looked at. On paper the
 *   highlighter made that visible — every uncoloured room was the answer. In a
 *   model, an unassigned room looks exactly like a room you have not scrolled
 *   to yet.
 *
 * Per THEME, not across all zones. A room is legitimately in one Brandabschnitt
 * and one Meldezone at once, so "unassigned" is only a question about one theme
 * at a time — asked across all of them it would report every room as assigned
 * the moment it had any zone at all.
 *
 * # Two in one theme is an error, and is reported rather than resolved
 *
 * IFC lets a space be a member of any number of zones and nothing stops two
 * compartments claiming the same room. The truth is that one of them is wrong,
 * but which one is a question only the author can answer — so this names the
 * room and leaves it. Silently preferring the first would make the area of the
 * other compartment quietly too small, which is exactly the kind of wrong
 * number a specialist would act on.
 *
 * # A room can be assigned through more than one kind of container
 *
 * The exchange requirement documents the assignment "anhand der Räume
 * (IfcSpace) und ihrer Zugehörigkeit zu Zonen (IfcZone) und
 * Zonierungselementen (IfcSpatialZone)" — two containers, one question. A
 * room referenced by a Brandabschnitt BODY is assigned, and reporting it as
 * unassigned because it is not also in a group would send its author looking
 * for work that is done.
 *
 * Those come in through `alsoAssigned` rather than as more rows, and they do
 * NOT make a room contested: one compartment expressed both as a group of
 * rooms and as the body derived from it is one compartment, and flagging that
 * pair as a double claim would turn the intended modelling into an error
 * report.
 *
 * Pure: takes the rooms and the zones, returns the reading. No store, no IFC.
 */

import type { ZoneInfo } from './membership.js';

/** One room, as much as this needs to know about it. */
export interface RosterRoom {
  expressId: number;
  name: string;
  /** Floor area in m², or `null` when neither a quantity nor geometry gave one. */
  area: number | null;
}

/** One zone of the theme, with what it adds up to. */
export interface RosterRow {
  expressId: number;
  name: string;
  colour: string | null;
  /** Members that are rooms this roster knows. */
  rooms: number;
  /**
   * Members the roster has no room for — a space on a model that is not
   * loaded, or one deleted since. Counted apart so the area is never quietly
   * short by a room nobody is told about.
   */
  strangers: number;
  /** Sum over the members that have an area, m². */
  area: number;
  /** Members counted in `rooms` whose area is unknown, so `area` is a floor. */
  withoutArea: number;
}

export interface Roster {
  rows: RosterRow[];
  /** Rooms in no zone of this theme, in the order given. */
  unassigned: RosterRoom[];
  /** Rooms claimed by more than one zone OF THIS THEME — always an error. */
  contested: Array<{ room: RosterRoom; zoneIds: number[] }>;
  /** Every room the roster saw, so a caller can say "12 of 40". */
  roomCount: number;
}

/**
 * Read the assignment of `rooms` to `zones`.
 *
 * `zones` must already be filtered to ONE theme — see the note above. Doing
 * the filtering here would need this module to know the theme catalogue, and
 * the caller knows which theme it is asking about anyway.
 */
export function readRoster(
  rooms: readonly RosterRoom[],
  zones: readonly ZoneInfo[],
  alsoAssigned: ReadonlySet<number> = new Set(),
): Roster {
  const byId = new Map<number, RosterRoom>(rooms.map((room) => [room.expressId, room]));
  /** Which zones of this theme claim each room. */
  const claims = new Map<number, number[]>();

  const rows: RosterRow[] = zones.map((zone) => {
    let area = 0;
    let withoutArea = 0;
    let known = 0;
    let strangers = 0;
    // A member listed twice in one relationship is counted once: its area must
    // not enter the sum twice, and it is one room either way.
    for (const memberId of new Set(zone.memberIds)) {
      const room = byId.get(memberId);
      if (!room) {
        strangers += 1;
        continue;
      }
      known += 1;
      if (room.area === null) withoutArea += 1;
      else area += room.area;
      const claimed = claims.get(memberId);
      if (claimed) claimed.push(zone.expressId);
      else claims.set(memberId, [zone.expressId]);
    }
    return {
      expressId: zone.expressId,
      name: zone.name,
      colour: zone.colour,
      rooms: known,
      strangers,
      area,
      withoutArea,
    };
  });

  const unassigned: RosterRoom[] = [];
  const contested: Roster['contested'] = [];
  for (const room of rooms) {
    const claimed = claims.get(room.expressId);
    if (!claimed) {
      if (!alsoAssigned.has(room.expressId)) unassigned.push(room);
    } else if (claimed.length > 1) {
      contested.push({ room, zoneIds: claimed });
    }
  }

  return { rows, unassigned, contested, roomCount: rooms.length };
}

/**
 * The area as a plan writes it: one decimal, thousands grouped.
 *
 * Two decimals would imply a precision a footprint derived from a mesh does
 * not have — the same reason `formatRoomArea` stops at one.
 */
export function formatArea(squareMetres: number): string {
  return `${squareMetres.toLocaleString('de-CH', {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  })} m²`;
}
