/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A first cut at the fire compartments of one storey.
 *
 * Not an answer — a starting point a fire-safety engineer corrects. That
 * distinction runs through the whole module: every room carries the REASON it
 * landed where it did, nothing is written to the model here, and the names are
 * chosen so a wrong one is obvious on the sheet rather than plausible.
 *
 * ## The rules, and where they come from
 *
 * Two are Marc's, and they are rules rather than judgements (2026-09-16):
 *
 *   - The escape stair is its own compartment. A stair that serves as the way
 *     out must not share a compartment with anything that can burn, or the
 *     route out is only as safe as the worst room next to it.
 *   - The escape corridors are their own compartment, one per storey. Same
 *     reason, and one rather than several because a corridor system on a floor
 *     is one route, not several.
 *
 * Both get `FireExit = TRUE`.
 *
 * The third is a judgement and is made cheaply on purpose: everything left
 * over is split by WHERE IT IS, into one or two groups, so that a storey comes
 * out with the three or four compartments Marc asked for. Splitting on
 * position rather than on use is the honest cut — the real criteria (usage
 * class, fire load, escape-route length, total area) need data this model does
 * not carry, and a split dressed up in those terms would look like it had
 * consulted them.
 *
 * ## Why the remainder is split on the long axis
 *
 * A compartment has to be a contiguous piece of building. Grouping rooms by
 * area or by name would scatter a compartment across a floor, which is not a
 * compartment at all. Cutting the remainder across its longer extent, at the
 * median room, produces two halves that are at least spatially coherent — and
 * the wing structure of a real building usually falls out of it, because
 * buildings are long in the direction their wings run.
 */

import { isEscapeRoute, roomUseFromName, type RoomUse } from './roomUse';

/** One room, as this needs it. `centre` is anywhere consistent inside it. */
export interface ProposalRoom {
  expressId: number;
  name?: string;
  longName?: string;
  /** Net floor area in m², for the report. `0` when the model has none. */
  area: number;
  centre: { x: number; y: number };
}

/** Why a room ended up in its compartment. Shown, not logged. */
export type ProposalReason =
  | 'escape-stair'
  | 'escape-corridor'
  | 'remainder-single'
  | 'remainder-split';

export interface ProposedRoom {
  expressId: number;
  name: string;
  area: number;
  reason: ProposalReason;
}

export interface ProposedCompartment {
  /** Stable within one proposal: `<storey>.<n>`, e.g. "00.1". */
  key: string;
  /** What the zone is called in the model. */
  name: string;
  /** `Pset_SpaceCommon.FireExit` for every room in it. */
  fireExit: boolean;
  /** The role that produced it, for colouring and for the report. */
  use: RoomUse | 'mixed';
  rooms: ProposedRoom[];
  /** Sum of the members' areas, m². */
  area: number;
}

export interface CompartmentProposal {
  compartments: ProposedCompartment[];
  /** Rooms with no usable geometry, left out and named rather than guessed. */
  skipped: ProposedRoom[];
}

/** Below this the remainder stays one compartment: splitting two rooms is noise. */
const MIN_ROOMS_TO_SPLIT = 6;

/** And below this area too — a small floor is one compartment, not two. */
const MIN_AREA_TO_SPLIT_M2 = 400;

function label(room: ProposalRoom): string {
  const number = room.name?.trim();
  const readable = room.longName?.trim();
  if (number && readable) return `${number} ${readable}`;
  return readable || number || `#${room.expressId}`;
}

function totalArea(rooms: readonly ProposedRoom[]): number {
  return rooms.reduce((sum, r) => sum + r.area, 0);
}

/**
 * Split a set of rooms in two across its longer extent.
 *
 * The cut is at the MEDIAN room along that axis, not at the midpoint of the
 * extent: one outlying room — a terrace, a plant enclosure at the far end —
 * would otherwise drag the midpoint out and leave one half nearly empty.
 */
function splitByPosition(rooms: readonly ProposalRoom[]): [ProposalRoom[], ProposalRoom[]] {
  const xs = rooms.map((r) => r.centre.x);
  const ys = rooms.map((r) => r.centre.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const along = spanX >= spanY ? (r: ProposalRoom) => r.centre.x : (r: ProposalRoom) => r.centre.y;

  const sorted = [...rooms].sort((a, b) => along(a) - along(b));
  const cut = Math.ceil(sorted.length / 2);
  return [sorted.slice(0, cut), sorted.slice(cut)];
}

/**
 * Propose the compartments of one storey.
 *
 * `storeyName` only names the compartments; nothing here reads it. Rooms with
 * a non-finite centre are skipped and reported — a room whose position is
 * unknown cannot be grouped by position, and putting it somewhere anyway is
 * the kind of quiet guess that survives into a fire-safety concept.
 */
export function proposeCompartments(
  storeyName: string,
  rooms: readonly ProposalRoom[],
): CompartmentProposal {
  const usable: ProposalRoom[] = [];
  const skipped: ProposedRoom[] = [];
  for (const room of rooms) {
    if (Number.isFinite(room.centre.x) && Number.isFinite(room.centre.y)) usable.push(room);
    else {
      skipped.push({
        expressId: room.expressId,
        name: label(room),
        area: room.area,
        reason: 'remainder-single',
      });
    }
  }

  const byUse = new Map<RoomUse, ProposalRoom[]>();
  for (const room of usable) {
    const use = roomUseFromName(room.name, room.longName);
    const list = byUse.get(use);
    if (list) list.push(room);
    else byUse.set(use, [room]);
  }

  const compartments: ProposedCompartment[] = [];
  let n = 0;
  const add = (
    name: string,
    use: RoomUse | 'mixed',
    members: readonly ProposalRoom[],
    reason: ProposalReason,
  ) => {
    if (members.length === 0) return;
    n += 1;
    const rooms = members.map((r) => ({
      expressId: r.expressId, name: label(r), area: r.area, reason,
    }));
    compartments.push({
      key: `${storeyName}.${n}`,
      name,
      fireExit: isEscapeRoute(use as RoomUse),
      use,
      rooms,
      area: totalArea(rooms),
    });
  };

  // The stair first, so it is compartment 1 on every storey: it is the piece
  // that has to be the same on every floor, and a reader comparing storeys
  // should not have to hunt for it.
  add(`${storeyName} Fluchttreppenhaus`, 'escape-stair',
    byUse.get('escape-stair') ?? [], 'escape-stair');
  add(`${storeyName} Fluchtkorridor`, 'escape-corridor',
    byUse.get('escape-corridor') ?? [], 'escape-corridor');

  const rest = byUse.get('ordinary') ?? [];
  if (rest.length === 0) {
    // nothing to add
  } else if (rest.length < MIN_ROOMS_TO_SPLIT
    || rest.reduce((s, r) => s + r.area, 0) < MIN_AREA_TO_SPLIT_M2) {
    add(`${storeyName} Nutzung`, 'mixed', rest, 'remainder-single');
  } else {
    const [a, b] = splitByPosition(rest);
    add(`${storeyName} Nutzung A`, 'mixed', a, 'remainder-split');
    add(`${storeyName} Nutzung B`, 'mixed', b, 'remainder-split');
  }

  return { compartments, skipped };
}

/** One line per compartment, for a toast or a report. */
export function describeProposal(proposal: CompartmentProposal): string[] {
  const lines = proposal.compartments.map((c) => (
    `${c.name}: ${c.rooms.length} Räume, ${c.area.toFixed(0)} m²`
    + `${c.fireExit ? ' · Fluchtweg' : ''}`
  ));
  if (proposal.skipped.length > 0) {
    lines.push(`${proposal.skipped.length} Räume ohne Lage — nicht zugeteilt`);
  }
  return lines;
}
